import { createHash } from "node:crypto";
import type { GcsActor, GcsCache, GcsPermissionService, GcsSettingsService } from "@gcs/core";
import { DEFAULT_STREAMS, loadStreamsConfig } from "./streams";
import { Prisma, type PrismaClient, sql } from "@gcs/db";
import { forumContainer } from "../forums/posting";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { UNREAD_DAYS } from "../forums/readMarkers";
import { snippetOf } from "../profile/queries";
import type { GcsSocialService } from "../profile/social";
import { notBannedSql, pgTimestamp, profileAudience, profileVisibleSql } from "./sql";

export const GCS_ACTIVITY_FILTERS = ["all", "topics", "replies", "statuses"] as const;
export type GcsActivityFilter = (typeof GCS_ACTIVITY_FILTERS)[number];
export const ACTIVITY_PER_PAGE = 25;
const GUEST_TTL = 30;
const SNIPPET = 180;

type TopicRef = { id: number; title: string; slug: string };
type ForumRef = { id: number; name: string; slug: string };

/** Un eveniment din fluxul de activitate. `key` e unic în flux (pentru liste React). */
export type GcsStreamItem =
  | { kind: "topic" | "reply"; key: string; at: string; user: GcsUserRef | null; topic: TopicRef; forum: ForumRef; postId: number; snippet: string }
  | { kind: "status"; key: string; at: string; user: GcsUserRef | null; owner: GcsUserRef | null; statusId: number; snippet: string }
  | { kind: "member"; key: string; at: string; user: GcsUserRef };

/** `stream` = cheia unui flux propriu din ACP › Fluxuri (tab-ul lui de pe pagina Activitate). */
export type GcsActivityQuery = { filter?: GcsActivityFilter; unread?: boolean; before?: string | null; limit?: number; stream?: string | null };
export type GcsActivityPage = { items: GcsStreamItem[]; next: string | null };

/** Tipurile de evenimente; la același moment, ordinea (coloana `k` din cursor) e topic 4, răspuns 3, status 2, membru 1. */
type Kind = "topic" | "reply" | "status" | "member";
type Cursor = { at: string; k: number; ref: string };
type Row = { kind: Kind; k: number; ref: string; at: Date; atKey: string; userId: string | null; topicId: number | null; postId: number | null; ownerId: string | null };

/** Momentul din cursor e textul exact din bază (UTC, până la microsecunde), ca paginile să nu sară rânduri. */
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)_([1-4])_([A-Za-z0-9]{1,40})$/;

export function encodeActivityCursor(c: Cursor): string {
  return `${c.at}_${c.k}_${c.ref}`;
}

/** Cursorul din adresă (`?before=`); unul invalid e ignorat (fluxul începe de la cele mai noi). */
export function parseActivityCursor(raw: string | null | undefined): Cursor | null {
  const m = raw ? CURSOR_RE.exec(raw) : null;
  if (!m || Number.isNaN(Date.parse(`${m[1]}Z`))) return null;
  return { at: m[1]!, k: Number(m[2]), ref: m[3]! };
}

/**
 * Fluxul de activitate (`/activity`): topicuri noi, răspunsuri, statusuri de profil și membri noi, cele mai noi primele,
 * cu paginare pe cursor. Permisiunile sunt aceleași ca la căutare și la listele de topicuri:
 * - topicurile și răspunsurile vin doar din forumurile cu `forums.read` pentru viewer, doar postări `VISIBLE` în topicuri
 *   `VISIBLE` (nimic în așteptare sau ascuns, nici pentru moderatori: fluxul e public);
 * - statusurile (doar cele de pe primul nivel, `VISIBLE`) și membrii noi cer `core.view_public` și respectă regula de
 *   vizibilitate a profilului (PUBLIC; MEMBERS pentru membri; FOLLOWED dacă proprietarul îl urmărește; staff-ul tot);
 *   membrii banați nu apar;
 * - autorii ignorați de viewer (la postări) nu apar.
 * „Doar necitite” păstrează topicurile și răspunsurile necitite (regula indicatorului de necitit), fără propriile postări.
 * Fluxul vizitatorilor e cache-uit 30 s (tag `forums-tree`); al membrilor depinde de urmăriri, ignorări și necitite.
 */
export class GcsActivityStream {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; permissions: GcsPermissionService; social: Pick<GcsSocialService, "ignoredIds">; settings?: Pick<GcsSettingsService, "get"> }) {}

  async page(viewer: GcsActor, query: GcsActivityQuery = {}): Promise<GcsActivityPage> {
    const { db, cache, permissions, social } = this.deps;
    const filter = query.filter ?? "all";
    // ACP › Fluxuri: tipurile din „Tot”, forumurile excluse, elementele pe pagină și fluxul propriu ales.
    const cfg = this.deps.settings ? await loadStreamsConfig(this.deps.settings) : DEFAULT_STREAMS;
    const stream = query.stream ? (cfg.custom.find((s) => s.key === query.stream) ?? null) : null;
    const allowedKinds = new Set<Kind>(stream ? stream.kinds : cfg.kinds);
    const limit = Math.min(Math.max(query.limit ?? cfg.perPage ?? ACTIVITY_PER_PAGE, 1), 50);
    const unread = Boolean(query.unread && viewer.userId);
    const cursor = parseActivityCursor(query.before);

    const forums = await db.forum.findMany({ select: { id: true } });
    const readable = await permissions.filterContainers(viewer, "forums.read", forums.map((f) => forumContainer(f.id)));
    const excluded = new Set(cfg.excludeForumIds);
    const only = stream && stream.forumIds.length > 0 ? new Set(stream.forumIds) : null;
    const forumIds = [...readable].map(Number).filter((id) => !excluded.has(id) && (!only || only.has(id))).sort((a, b) => a - b);
    const publicProfiles = !viewer.isBanned && (await permissions.can(viewer, "core.view_public"));

    const guestKey = viewer.userId
      ? null
      : `activity:guest:${filter}:${limit}:${cursor ? encodeActivityCursor(cursor) : "first"}:${publicProfiles ? 1 : 0}:${createHash("sha1").update(`${forumIds.join(",")}|${[...allowedKinds].join(",")}`).digest("hex")}`;
    if (guestKey) {
      const cached = await cache.get<GcsActivityPage>(guestKey);
      if (cached) return cached;
    }

    const audience = await profileAudience(permissions, viewer);
    const ignored = await social.ignoredIds(viewer.userId, "posts");
    const cutoff = unread ? await this.unreadCutoff(viewer.userId!) : null;
    const wants = (k: Kind) =>
      allowedKinds.has(k) &&
      (filter === "all" || (filter === "topics" && k === "topic") || (filter === "replies" && k === "reply") || (filter === "statuses" && k === "status")) &&
      (!unread || k === "topic" || k === "reply") &&
      (k === "topic" || k === "reply" ? forumIds.length > 0 : publicProfiles);

    const take = limit + 1;
    // Cursorul: (momentul, tipul, id-ul) strict mai mic decât ultimul rând al paginii anterioare.
    const before = (col: Prisma.Sql, k: number, ref: Prisma.Sql) => {
      if (!cursor) return Prisma.empty;
      const at = cursor.at;
      return sql`AND ${col} <= ${at}::timestamp AND (${col}, ${Prisma.raw(String(k))}, ${ref}) < (${at}::timestamp, ${cursor.k}::int, ${cursor.ref}::text)`;
    };
    const notIgnored = (col: Prisma.Sql) => (ignored.length > 0 ? sql`AND (${col} IS NULL OR ${col} <> ALL(${ignored}))` : Prisma.empty);
    const profileVisible = (u: Prisma.Sql) => profileVisibleSql(u, audience, viewer.userId);
    const unreadJoin = (topic: Prisma.Sql) =>
      unread
        ? sql`LEFT JOIN read_markers m ON m."topicId" = ${topic}.id AND m."userId" = ${viewer.userId}
                     LEFT JOIN forum_read_marks fm ON fm."forumId" = ${topic}."forumId" AND fm."userId" = ${viewer.userId}`
        : Prisma.empty;
    const unreadWhere = (at: Prisma.Sql, postId: Prisma.Sql, author: Prisma.Sql) =>
      unread
        ? sql`AND ${at} > ${pgTimestamp(cutoff!)}::timestamp AND (fm."markedAt" IS NULL OR ${at} > fm."markedAt")
                     AND ${postId} > COALESCE(m."lastReadPostId", 0) AND ${author} IS DISTINCT FROM ${viewer.userId}`
        : Prisma.empty;

    const parts: Prisma.Sql[] = [];
    if (wants("topic")) {
      const ref = sql`lpad(t.id::text, 12, '0')`;
      parts.push(sql`(SELECT 'topic'::text AS kind, 4 AS k, ${ref} AS ref, t."createdAt" AS at, t."authorId" AS "userId",
          t.id AS "topicId", t."firstPostId" AS "postId", NULL::text AS "ownerId"
        FROM topics t ${unreadJoin(sql`t`)}
        WHERE t.visibility = 'VISIBLE' AND t."firstPostId" IS NOT NULL AND t."forumId" = ANY(${forumIds})
          ${notIgnored(sql`t."authorId"`)} ${before(sql`t."createdAt"`, 4, ref)}
          ${unreadWhere(sql`t."createdAt"`, sql`t."firstPostId"`, sql`t."authorId"`)}
        ORDER BY t."createdAt" DESC, t.id DESC LIMIT ${take})`);
    }
    if (wants("reply")) {
      const ref = sql`lpad(p.id::text, 12, '0')`;
      parts.push(sql`(SELECT 'reply'::text AS kind, 3 AS k, ${ref} AS ref, p."createdAt" AS at, p."authorId" AS "userId",
          t.id AS "topicId", p.id AS "postId", NULL::text AS "ownerId"
        FROM posts p JOIN topics t ON t.id = p."topicId" ${unreadJoin(sql`t`)}
        WHERE p.visibility = 'VISIBLE' AND t.visibility = 'VISIBLE' AND t."forumId" = ANY(${forumIds}) AND p.id IS DISTINCT FROM t."firstPostId"
          ${notIgnored(sql`p."authorId"`)} ${before(sql`p."createdAt"`, 3, ref)}
          ${unreadWhere(sql`p."createdAt"`, sql`p.id`, sql`p."authorId"`)}
        ORDER BY p."createdAt" DESC, p.id DESC LIMIT ${take})`);
    }
    if (wants("status")) {
      const ref = sql`lpad(s.id::text, 12, '0')`;
      parts.push(sql`(SELECT 'status'::text AS kind, 2 AS k, ${ref} AS ref, s."createdAt" AS at, s."authorId" AS "userId",
          NULL::int AS "topicId", s.id AS "postId", s."profileUserId" AS "ownerId"
        FROM status_updates s JOIN users o ON o.id = s."profileUserId"
        WHERE s."parentId" IS NULL AND s.visibility = 'VISIBLE' ${profileVisible(sql`o`)}
          ${notIgnored(sql`s."authorId"`)} ${before(sql`s."createdAt"`, 2, ref)}
        ORDER BY s."createdAt" DESC, s.id DESC LIMIT ${take})`);
    }
    if (wants("member") && filter === "all") {
      parts.push(sql`(SELECT 'member'::text AS kind, 1 AS k, u.id AS ref, u."createdAt" AS at, u.id AS "userId",
          NULL::int AS "topicId", NULL::int AS "postId", NULL::text AS "ownerId"
        FROM users u
        WHERE ${notBannedSql(sql`u`)} ${profileVisible(sql`u`)} ${before(sql`u."createdAt"`, 1, sql`u.id`)}
        ORDER BY u."createdAt" DESC, u.id DESC LIMIT ${take})`);
    }

    let result: GcsActivityPage = { items: [], next: null };
    if (parts.length > 0) {
      const rows = await db.$queryRaw<Row[]>(sql`
        SELECT x.*, to_char(x.at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "atKey" FROM (${Prisma.join(parts, " UNION ALL ")}) x
        ORDER BY x.at DESC, x.k DESC, x.ref DESC
        LIMIT ${take}`);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      result = {
        items: await this.hydrate(page),
        next: rows.length > limit && last ? encodeActivityCursor({ at: last.atKey, k: Number(last.k), ref: last.ref }) : null,
      };
    }
    if (guestKey) await cache.set(guestKey, result, { ttlSec: GUEST_TTL, tags: ["forums-tree", "activity"] });
    return result;
  }

  /** Momentul de dinaintea căruia totul e citit (ca la indicatorul de necitit): înregistrarea sau acum `UNREAD_DAYS` zile. */
  private async unreadCutoff(userId: string): Promise<Date> {
    const user = await this.deps.db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    const window = new Date(Date.now() - UNREAD_DAYS * 86_400_000);
    return user && user.createdAt > window ? user.createdAt : window;
  }

  /** Detaliile rândurilor (topicuri, forumuri, fragmente, useri), în câteva interogări. */
  private async hydrate(rows: Row[]): Promise<GcsStreamItem[]> {
    const { db } = this.deps;
    const ids = (kinds: Kind[], pick: (r: Row) => number | string | null) => [...new Set(rows.filter((r) => kinds.includes(r.kind)).map(pick).filter((v) => v !== null))];
    const topicIds = ids(["topic", "reply"], (r) => r.topicId) as number[];
    const postIds = ids(["topic", "reply"], (r) => r.postId) as number[];
    const statusIds = ids(["status"], (r) => r.postId) as number[];
    const userIds = [...new Set(rows.flatMap((r) => [r.userId, r.ownerId]).filter((id): id is string => id !== null))];
    const [topics, posts, statuses, users] = await Promise.all([
      topicIds.length ? db.topic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true, slug: true, forum: { select: { id: true, name: true, slug: true } } } }) : [],
      postIds.length ? db.post.findMany({ where: { id: { in: postIds } }, select: { id: true, contentHtml: true } }) : [],
      statusIds.length ? db.statusUpdate.findMany({ where: { id: { in: statusIds } }, select: { id: true, contentHtml: true } }) : [],
      userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: userRefSelect }) : [],
    ]);
    const topicMap = new Map(topics.map((t) => [t.id, t]));
    const postHtml = new Map(posts.map((p) => [p.id, p.contentHtml]));
    const statusHtml = new Map(statuses.map((s) => [s.id, s.contentHtml]));
    const userMap = new Map(users.map((u) => [u.id, toRef(u)]));
    const user = (id: string | null) => (id ? (userMap.get(id) ?? null) : null);
    return rows.flatMap((r): GcsStreamItem[] => {
      const at = new Date(r.at).toISOString();
      const key = `${r.kind}-${r.ref}`;
      if (r.kind === "topic" || r.kind === "reply") {
        const t = topicMap.get(r.topicId!);
        if (!t) return [];
        return [{ kind: r.kind, key, at, user: user(r.userId), topic: { id: t.id, title: t.title, slug: t.slug }, forum: t.forum, postId: r.postId!, snippet: snippetOf(postHtml.get(r.postId!) ?? "", SNIPPET) }];
      }
      if (r.kind === "status") {
        return [{ kind: "status", key, at, user: user(r.userId), owner: r.ownerId === r.userId ? null : user(r.ownerId), statusId: r.postId!, snippet: snippetOf(statusHtml.get(r.postId!) ?? "", SNIPPET) }];
      }
      const member = user(r.userId);
      return member ? [{ kind: "member", key, at, user: member }] : [];
    });
  }
}
