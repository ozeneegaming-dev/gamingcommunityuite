import { GcsForbidden, type GcsActor, type GcsCache, type GcsPermissionService, type GcsSettingsService } from "@gcs/core";
import { Prisma, type PrismaClient, sql, sqlIdent } from "@gcs/db";
import { secondsSinceMidnight } from "../chat-pro/period";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import type { GcsOnlineTime } from "./onlineTime";
import { notBannedSql, pgTimestamp, profileAudience, profileVisibleSql, type GcsProfileAudience } from "./sql";

/**
 * Măsurile clasamentului. `topics` = topicurile vizibile pornite; `online` = timpul online (secunde, din
 * `member_online_days`; Hero Cockpit).
 */
export const GCS_LEADERBOARD_METRICS = ["reputation", "posts", "topics", "online", "xp", "solutions"] as const;
export type GcsLeaderboardMetric = (typeof GCS_LEADERBOARD_METRICS)[number];
/** Perioadele: azi (de la miezul nopții, în fusul orar al site-ului), ultimele 7 / 30 / 365 de zile, tot timpul. */
export const GCS_LEADERBOARD_PERIODS = ["day", "week", "month", "year", "all"] as const;
export type GcsLeaderboardPeriod = (typeof GCS_LEADERBOARD_PERIODS)[number];
export const LEADERBOARD_SIZE = 50;
const TTL = 300;
/** „Azi” și timpul online se schimbă repede: cache scurt. */
const SHORT_TTL = 60;
const DAY = 86_400_000;
const PERIOD_DAYS: Record<"week" | "month" | "year", number> = { week: 7, month: 30, year: 365 };
/** Contorul userului folosit la „Tot timpul” (măsurile fără contor se calculează din tabele). */
const COUNTER: Partial<Record<GcsLeaderboardMetric, string>> = { reputation: "reputation", posts: "postsCount", xp: "points", solutions: "solutionsCount" };

/** Un loc în clasament: locul (egalitățile au același loc), valoarea, userul și grupul lui principal. */
export type GcsLeaderboardRow = { rank: number; value: number; user: GcsUserRef; group: { name: string; color: string | null; icon: string | null } };

/** Locul viewer-ului (rândul „Tu: locul X”); `null` = fără valoare în perioadă. */
export type GcsLeaderboardPlace = { rank: number; value: number };

const rowSelect = { ...userRefSelect, primaryGroup: { select: { key: true, name: true, title: true, color: true, icon: true } } } as const satisfies Prisma.UserSelect;

/**
 * Clasamentul (`/leaderboard`, widget-ul „Clasament”, panoul „Top” din consolă): primii 50 după reputație, postări,
 * topicuri, timp online, XP (realizări) sau soluții, pe zi, săptămână, lună, an sau tot timpul. Pe perioade, valorile se
 * calculează din ce s-a creat în perioadă (reacțiile primite, postările și topicurile vizibile, punctele din jurnalul
 * realizărilor, răspunsurile marcate soluție, zilele de timp online); „tot timpul” folosește contoarele. Doar valori
 * pozitive, fără membrii banați, cu regula de vizibilitate a profilului; la timpul online, fără cei cu statusul ascuns.
 * Accesul cere `core.members_list` (ca lista de membri). Cache pe (măsură, perioadă, public), tag `leaderboard`.
 */
export class GcsLeaderboard {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      permissions: GcsPermissionService;
      /** Fusul orar al site-ului pentru „azi” (fără setări: UTC). */
      settings?: GcsSettingsService;
      /** Timpul online pe zile (fără el, măsura `online` e goală). */
      onlineTime?: GcsOnlineTime;
    },
  ) {}

  private async guard(viewer: GcsActor): Promise<GcsProfileAudience> {
    const { permissions } = this.deps;
    if (viewer.isBanned || !(await permissions.can(viewer, "core.members_list"))) throw new GcsForbidden({ permission: "core.members_list" });
    return profileAudience(permissions, viewer);
  }

  async top(viewer: GcsActor, metric: GcsLeaderboardMetric, period: GcsLeaderboardPeriod, now = Date.now()): Promise<GcsLeaderboardRow[]> {
    const { cache } = this.deps;
    const audience = await this.guard(viewer);
    const key = `leaderboard:${metric}:${period}:${audience}`;
    const cached = await cache.get<GcsLeaderboardRow[]>(key);
    if (cached) return cached;
    const rows = await this.compute(metric, period, audience, now);
    const ttlSec = period === "day" || metric === "online" ? SHORT_TTL : TTL;
    await cache.set(key, rows, { ttlSec, tags: ["leaderboard", ...rows.map((r) => `user:${r.user.id}`)] });
    return rows;
  }

  /** Locul viewer-ului în clasament (același calcul, fără limita de 50); `null` pentru vizitatori sau fără valoare. */
  async place(viewer: GcsActor, metric: GcsLeaderboardMetric, period: GcsLeaderboardPeriod, now = Date.now()): Promise<GcsLeaderboardPlace | null> {
    const audience = await this.guard(viewer);
    if (!viewer.userId) return null;
    const values = await this.values(metric, period, now);
    const rows = await this.deps.db.$queryRaw<{ value: number; above: number }[]>(sql`
      WITH v AS (
        SELECT v.id, v.value::int AS value FROM (${values}) v
        JOIN users u ON u.id = v.id
        WHERE v.value > 0 AND ${notBannedSql(sql`u`)} ${profileVisibleSql(sql`u`, audience)} ${this.extraSql(metric)}
      )
      SELECT me.value, (SELECT count(*)::int FROM v WHERE v.value > me.value) AS above FROM v me WHERE me.id = ${viewer.userId}`);
    const me = rows[0];
    return me ? { rank: Number(me.above) + 1, value: Number(me.value) } : null;
  }

  /** Momentul de început al perioadei (pentru „azi”: miezul nopții în fusul orar al site-ului). */
  private async since(period: Exclude<GcsLeaderboardPeriod, "all">, now: number): Promise<Date> {
    if (period !== "day") return new Date(now - PERIOD_DAYS[period] * DAY);
    const tz = this.deps.settings ? await this.deps.settings.get<string>("site.timezone").catch(() => "UTC") : "UTC";
    return new Date(now - secondsSinceMidnight(new Date(now), tz) * 1000);
  }

  /** Condiții în plus pe măsură: timpul online nu arată membrii cu statusul ascuns. */
  private extraSql(metric: GcsLeaderboardMetric): Prisma.Sql {
    return metric === "online" ? sql`AND COALESCE(u.privacy->>'showOnline', 'true') <> 'false'` : Prisma.empty;
  }

  private async values(metric: GcsLeaderboardMetric, period: GcsLeaderboardPeriod, now: number): Promise<Prisma.Sql> {
    if (metric === "online") {
      if (!this.deps.onlineTime) return sql`SELECT NULL::text AS id, 0 AS value WHERE false`;
      return this.deps.onlineTime.valuesSql(period, now);
    }
    const counter = COUNTER[metric];
    if (period === "all" && counter) {
      const col = sqlIdent(counter);
      return sql`SELECT c.id, c.${col} AS value FROM users c WHERE c.${col} > 0`;
    }
    // „Tot timpul”: un început înaintea oricărei activități (MySQL nu are `-infinity`).
    const since = period === "all" ? sql`${"1970-01-01T00:00:00.000"}::timestamp` : sql`${pgTimestamp(await this.since(period, now))}::timestamp`;
    // `contentId` e text (orice tip de conținut): convertit doar când e un număr, în CASE (ordinea evaluării e garantată).
    const numericId = sql`(CASE WHEN cr."contentId" ~ '^[0-9]{1,9}$' THEN cr."contentId"::int END)`;
    switch (metric) {
      case "posts":
        return sql`SELECT p."authorId" AS id, count(*)::int AS value
          FROM posts p JOIN topics t ON t.id = p."topicId"
          WHERE p.visibility = 'VISIBLE' AND t.visibility = 'VISIBLE' AND p."createdAt" >= ${since} AND p."authorId" IS NOT NULL
          GROUP BY p."authorId"`;
      case "topics":
        return sql`SELECT t."authorId" AS id, count(*)::int AS value
          FROM topics t
          WHERE t.visibility = 'VISIBLE' AND t."createdAt" >= ${since} AND t."authorId" IS NOT NULL
          GROUP BY t."authorId"`;
      case "reputation":
        return sql`SELECT x.id, sum(x.weight)::int AS value FROM (
            SELECT p."authorId" AS id, r.weight FROM content_reactions cr
              JOIN reactions r ON r.id = cr."reactionId" JOIN posts p ON p.id = ${numericId}
              WHERE cr."contentType" = 'forums.post' AND cr."createdAt" >= ${since}
            UNION ALL
            SELECT s."authorId" AS id, r.weight FROM content_reactions cr
              JOIN reactions r ON r.id = cr."reactionId" JOIN status_updates s ON s.id = ${numericId}
              WHERE cr."contentType" = 'profile.status' AND cr."createdAt" >= ${since}
          ) x WHERE x.id IS NOT NULL GROUP BY x.id`;
      case "xp":
        return sql`SELECT a."userId" AS id, sum(a.points)::int AS value FROM achievement_log a WHERE a."createdAt" >= ${since} GROUP BY a."userId"`;
      case "solutions":
        return sql`SELECT p."authorId" AS id, count(*)::int AS value
          FROM topics t JOIN posts p ON p.id = t."solvedPostId"
          WHERE p."createdAt" >= ${since} AND p."authorId" IS NOT NULL
          GROUP BY p."authorId"`;
    }
  }

  private async compute(metric: GcsLeaderboardMetric, period: GcsLeaderboardPeriod, audience: GcsProfileAudience, now: number): Promise<GcsLeaderboardRow[]> {
    const { db } = this.deps;
    const top = await db.$queryRaw<{ id: string; value: number }[]>(sql`
      SELECT v.id, v.value::int AS value FROM (${await this.values(metric, period, now)}) v
      JOIN users u ON u.id = v.id
      WHERE v.value > 0 AND ${notBannedSql(sql`u`)} ${profileVisibleSql(sql`u`, audience)} ${this.extraSql(metric)}
      ORDER BY v.value DESC, u."createdAt" ASC, u.id ASC
      LIMIT ${LEADERBOARD_SIZE}`);
    if (top.length === 0) return [];
    const users = new Map((await db.user.findMany({ where: { id: { in: top.map((t) => t.id) } }, select: rowSelect })).map((u) => [u.id, u]));
    const rows: GcsLeaderboardRow[] = [];
    for (const [i, t] of top.entries()) {
      const u = users.get(t.id);
      if (!u) continue;
      const value = Number(t.value);
      // Clasament „olimpic”: egalitățile au același loc, următorul sare peste (1, 2, 2, 4).
      const rank = i > 0 && rows[rows.length - 1]?.value === value ? rows[rows.length - 1]!.rank : i + 1;
      rows.push({ rank, value, user: toRef(u), group: { name: u.primaryGroup.title ?? u.primaryGroup.name, color: u.primaryGroup.color, icon: u.primaryGroup.icon } });
    }
    return rows;
  }
}
