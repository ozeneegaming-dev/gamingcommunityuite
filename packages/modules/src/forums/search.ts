import {
  GcsRateLimited,
  GcsValidationError,
  normalizeUsername,
  type GcsActor,
  type GcsPermissionService,
  type GcsRateLimiter,
  type GcsSettingsService,
} from "@gcs/core";
import { Prisma, type PrismaClient } from "@gcs/db";
import sanitizeHtml from "sanitize-html";
import { forumContainer } from "./posting";
import { toRef, userRefSelect, type GcsPagination, type GcsUserRef } from "./queries";

export type GcsSearchInput = {
  q: string;
  type: "topics" | "posts";
  page: number;
  /** Forumul (cu subforumurile lui). */
  forumId?: number;
  authorName?: string;
  /** ISO: doar conținutul de după această dată. */
  since?: string;
};

export type GcsSearchResult = {
  topicId: number;
  topicTitle: string;
  topicSlug: string;
  /** Postarea găsită (la căutarea în postări) sau prima postare a topicului. */
  postId: number;
  forumId: number;
  forumName: string;
  author: GcsUserRef | null;
  createdAt: string;
  /** Fragment din text, cu termenii găsiți în `<mark>`; e singurul HTML permis. */
  snippet: string;
};

const SEARCH_LIMIT = { window: 60, max: 20 };
const HEADLINE = "StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=12, MaxFragments=2, FragmentDelimiter= … ";

type Row = {
  topicId: number;
  topicTitle: string;
  topicSlug: string;
  postId: number;
  forumId: number;
  forumName: string;
  authorId: string | null;
  createdAt: Date;
  snippet: string;
};

/**
 * Căutarea în forum (spec §2.1, §7): full-text PostgreSQL cu configurația `gcs_ro` (fără diacritice, cu flexiuni).
 * Rulează doar pe forumurile citibile de actor și doar pe conținutul vizibil tuturor.
 */
export class GcsForumSearch {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      rateLimiter: GcsRateLimiter;
    },
  ) {}

  async search(actor: GcsActor, input: GcsSearchInput): Promise<{ results: GcsSearchResult[]; pagination: GcsPagination }> {
    const { db, permissions, settings, rateLimiter } = this.deps;
    const q = input.q.replace(/\s+/g, " ").trim();
    if (q.length < 2 || q.length > 200) throw new GcsValidationError({ q: "too_short" });
    const limit = await rateLimiter.consume(`search:${actor.userId ?? actor.ip}`, SEARCH_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });

    const forums = await db.forum.findMany({ select: { id: true, parentId: true } });
    const readable = await permissions.filterContainers(actor, "forums.read", forums.map((f) => forumContainer(f.id)));
    let ids = forums.filter((f) => readable.has(String(f.id))).map((f) => f.id);
    if (input.forumId !== undefined) {
      const scope = [input.forumId];
      for (let i = 0; i < scope.length; i++) for (const f of forums) if (f.parentId === scope[i]) scope.push(f.id);
      ids = ids.filter((id) => scope.includes(id));
    }
    const perPage = await settings.get<number>("forums.topics_per_page");
    const page = Math.max(1, input.page);
    if (ids.length === 0) return { results: [], pagination: { page, pages: 1, perPage, total: 0 } };

    const filters: Prisma.Sql[] = [];
    if (input.authorName) {
      const author = await db.user.findUnique({ where: { nameNormalized: normalizeUsername(input.authorName) }, select: { id: true } });
      if (!author) return { results: [], pagination: { page, pages: 1, perPage, total: 0 } };
      filters.push(Prisma.sql`AND p."authorId" = ${author.id}`);
    }
    if (input.since) {
      const since = new Date(input.since);
      if (!Number.isNaN(since.getTime())) filters.push(Prisma.sql`AND p."createdAt" >= ${since.toISOString().slice(0, -1)}::timestamp`);
    }
    const extra = filters.length > 0 ? Prisma.join(filters, " ") : Prisma.empty;
    const query = Prisma.sql`websearch_to_tsquery('gcs_ro', ${q})`;
    // La topicuri: titlul sau prima postare; la postări: orice postare vizibilă.
    const match =
      input.type === "topics"
        ? Prisma.sql`p.id = t."firstPostId" AND (t."searchVector" @@ ${query} OR p."searchVector" @@ ${query})`
        : Prisma.sql`p."searchVector" @@ ${query}`;
    const rank =
      input.type === "topics"
        ? Prisma.sql`ts_rank(coalesce(t."searchVector", ''::tsvector) || coalesce(p."searchVector", ''::tsvector), ${query})`
        : Prisma.sql`ts_rank(p."searchVector", ${query})`;
    const base = Prisma.sql`
      FROM posts p
      JOIN topics t ON t.id = p."topicId"
      JOIN forums f ON f.id = t."forumId"
      WHERE ${match}
        AND p.visibility = 'VISIBLE' AND t.visibility = 'VISIBLE'
        AND t."forumId" = ANY(${ids})
        ${extra}`;

    const [countRows, rows] = await Promise.all([
      db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${base}`,
      db.$queryRaw<Row[]>`
        SELECT t.id AS "topicId", t.title AS "topicTitle", t.slug AS "topicSlug", p.id AS "postId",
               f.id AS "forumId", f.name AS "forumName", p."authorId", p."createdAt",
               ts_headline('gcs_ro', regexp_replace(p."contentHtml", '<[^>]*>', ' ', 'g'), ${query}, ${HEADLINE}) AS snippet
        ${base}
        ORDER BY ${rank} DESC, p."createdAt" DESC
        LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
    ]);
    const total = Number(countRows[0]?.total ?? 0);

    const authorIds = [...new Set(rows.map((r) => r.authorId).filter((id): id is string => id !== null))];
    const users = authorIds.length
      ? await db.user.findMany({ where: { id: { in: authorIds } }, select: userRefSelect })
      : [];
    const byId = new Map(users.map((u) => [u.id, toRef(u)]));

    return {
      results: rows.map((r) => ({
        topicId: r.topicId,
        topicTitle: r.topicTitle,
        topicSlug: r.topicSlug,
        postId: r.postId,
        forumId: r.forumId,
        forumName: r.forumName,
        author: r.authorId ? (byId.get(r.authorId) ?? null) : null,
        createdAt: new Date(r.createdAt).toISOString(),
        // Textul vine din HTML-ul deja sanitizat (cu tag-urile scoase); sanitizarea finală lasă doar <mark>.
        snippet: sanitizeHtml(r.snippet, { allowedTags: ["mark"], allowedAttributes: {} }),
      })),
      pagination: { page, pages: Math.max(1, Math.ceil(total / perPage)), perPage, total },
    };
  }
}
