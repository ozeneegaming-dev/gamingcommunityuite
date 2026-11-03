import {
  GcsForbidden,
  GcsRateLimited,
  GcsValidationError,
  normalizeUsername,
  searchBackend,
  type GcsActor,
  type GcsKv,
  type GcsPermissionService,
  type GcsRateLimiter,
  type GcsSettingsService,
} from "@gcs/core";
import { loadSearchConfig, logSearch } from "./searchConfig";
import type { PrismaClient } from "@gcs/db";
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


/**
 * Căutarea în forum (spec §2.1, §7): full-text prin `GcsSearchBackend` (PostgreSQL: configurația `gcs_ro`, fără
 * diacritice, cu flexiuni; MySQL: `FULLTEXT`).
 * Rulează doar pe forumurile citibile de actor și doar pe conținutul vizibil tuturor.
 */
export class GcsForumSearch {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      rateLimiter: GcsRateLimiter;
      /** Jurnalul anonim al termenilor (ACP › Căutare); fără el nu se notează nimic. */
      kv?: Pick<GcsKv, "listPush">;
    },
  ) {}

  async search(actor: GcsActor, input: GcsSearchInput): Promise<{ results: GcsSearchResult[]; pagination: GcsPagination }> {
    const { db, permissions, settings, rateLimiter } = this.deps;
    // ACP › Căutare: vizitatorii, lungimea minimă, limita pe minut, rezultatele pe pagină, vechimea maximă.
    const cfg = await loadSearchConfig(settings);
    if (!actor.userId && !cfg.guests) throw new GcsForbidden({ reason: "login_required" });
    const q = input.q.replace(/\s+/g, " ").trim();
    if (q.length < cfg.minLength || q.length > 200) throw new GcsValidationError({ q: "too_short" }, { min: String(cfg.minLength) });
    const limit = await rateLimiter.consume(`search:${actor.userId ?? actor.ip}`, { window: 60, max: cfg.perMinute });
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });

    const forums = await db.forum.findMany({ select: { id: true, parentId: true } });
    const readable = await permissions.filterContainers(actor, "forums.read", forums.map((f) => forumContainer(f.id)));
    let ids = forums.filter((f) => readable.has(String(f.id))).map((f) => f.id);
    if (input.forumId !== undefined) {
      const scope = [input.forumId];
      for (let i = 0; i < scope.length; i++) for (const f of forums) if (f.parentId === scope[i]) scope.push(f.id);
      ids = ids.filter((id) => scope.includes(id));
    }
    const perPage = cfg.perPage > 0 ? cfg.perPage : await settings.get<number>("forums.topics_per_page");
    const page = Math.max(1, input.page);
    if (ids.length === 0) return { results: [], pagination: { page, pages: 1, perPage, total: 0 } };

    let authorId: string | undefined;
    if (input.authorName) {
      const author = await db.user.findUnique({ where: { nameNormalized: normalizeUsername(input.authorName) }, select: { id: true } });
      if (!author) return { results: [], pagination: { page, pages: 1, perPage, total: 0 } };
      authorId = author.id;
    }
    const asked = input.since ? new Date(input.since) : null;
    const oldest = cfg.maxAgeDays > 0 ? new Date(Date.now() - cfg.maxAgeDays * 86_400_000) : null;
    const since = asked && !Number.isNaN(asked.getTime()) && (!oldest || asked > oldest) ? asked : oldest;
    const { total, hits: rows } = await searchBackend().search(db, {
      q,
      type: input.type,
      forumIds: ids,
      ...(authorId ? { authorId } : {}),
      ...(since && !Number.isNaN(since.getTime()) ? { since } : {}),
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    if (cfg.logTerms && this.deps.kv && page === 1) await logSearch(this.deps.kv, q, total).catch(() => {});

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
