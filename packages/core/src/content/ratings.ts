import type { Prisma, PrismaClient } from "@gcs/db";
import { writeAudit } from "../audit";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsActor } from "../permissions/types";
import { GCS_RATING_MAX } from "./ratingStars";

export * from "./ratingStars";

/**
 * Nota cu stele (Forum v2, macheta TopicRating): un serviciu generic `contentRating` pe `(contentType, contentId)`, pe
 * care îl folosesc aplicațiile (topicurile forumului acum; fișierele, galeria, paginile mai târziu). Un vot pe membru și
 * conținut, 1–5 stele; media (cu jumătăți de stea la afișare) și numărul voturilor stau în `content_rating_summaries`.
 *
 * Regulile (cine poate nota, dacă își poate schimba votul) le dă aplicația, prin politica tipului de conținut.
 */

export type GcsRatingSummary = { avg: number; count: number };
export type GcsRatingView = GcsRatingSummary & { mine: number | null; canRate: boolean; reason: string | null; canChange: boolean };

/** De ce nu poate nota un membru (cheile `rating.reasons.<cod>`). */
export type GcsRatingDenial = "guest" | "own_content" | "no_permission" | "account_too_new" | "not_enough_posts" | "disabled" | "already_rated";

/** Politica unui tip de conținut: cine îl poate nota, cine îl moderează, schimbarea votului și ce se actualizează. */
export type GcsRatingPolicy = {
  /** Conținutul există și actorul îl vede (altfel 404). */
  canView: (actor: GcsActor, contentId: string) => Promise<boolean>;
  /** `null` = actorul poate nota; altfel motivul. */
  check: (actor: GcsActor, contentId: string) => Promise<GcsRatingDenial | null>;
  /** Membrul își poate schimba votul (setarea aplicației). */
  changeVote: () => Promise<boolean>;
  /** Moderarea notelor (resetarea, scoaterea voturilor abuzive). */
  canModerate: (actor: GcsActor, contentId: string) => Promise<boolean>;
  /** După fiecare schimbare, în aceeași tranzacție (ex. coloanele `ratingAvg` / `ratingCount` ale topicului). */
  onChange?: (tx: Prisma.TransactionClient, contentId: string, summary: GcsRatingSummary) => Promise<void>;
  /** Tag-urile de cache invalidate la o schimbare. */
  tags?: (contentId: string) => Promise<string[]> | string[];
};

export class GcsContentRatingService {
  private readonly policies = new Map<string, GcsRatingPolicy>();

  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus }) {}

  /** O aplicație își înregistrează tipul de conținut (ex. `forums.topic`). */
  register(contentType: string, policy: GcsRatingPolicy): void {
    this.policies.set(contentType, policy);
  }

  private policy(contentType: string): GcsRatingPolicy {
    const p = this.policies.get(contentType);
    if (!p) throw new GcsNotFound();
    return p;
  }

  /** Media și numărul voturilor pentru mai multe conținuturi (cele fără voturi: `{ avg: 0, count: 0 }`). */
  async summaries(contentType: string, ids: string[]): Promise<Record<string, GcsRatingSummary>> {
    if (ids.length === 0) return {};
    const rows = await this.deps.db.contentRatingSummary.findMany({ where: { contentType, contentId: { in: ids } }, select: { contentId: true, avg: true, count: true } });
    const out: Record<string, GcsRatingSummary> = Object.fromEntries(ids.map((id) => [id, { avg: 0, count: 0 }]));
    for (const r of rows) out[r.contentId] = { avg: r.avg, count: r.count };
    return out;
  }

  /** Nota, votul vizitatorului și dacă poate nota (antetul conținutului). */
  async view(actor: GcsActor, contentType: string, contentId: string): Promise<GcsRatingView> {
    const policy = this.policy(contentType);
    const [summary, mine, reason, change] = await Promise.all([
      this.summaries(contentType, [contentId]).then((s) => s[contentId]!),
      actor.userId ? this.deps.db.contentRating.findUnique({ where: { contentType_contentId_userId: { contentType, contentId, userId: actor.userId } }, select: { value: true } }) : null,
      policy.check(actor, contentId),
      policy.changeVote(),
    ]);
    const voted = mine?.value ?? null;
    const denial = reason ?? (voted !== null && !change ? "already_rated" : null);
    return { ...summary, mine: voted, canRate: denial === null, reason: denial, canChange: change };
  }

  /** Distribuția voturilor: câte voturi are fiecare notă, de la 5★ la 1★. */
  async distribution(contentType: string, contentId: string): Promise<{ stars: number; count: number }[]> {
    const rows = await this.deps.db.contentRating.groupBy({ by: ["value"], where: { contentType, contentId }, _count: { _all: true } });
    const by = new Map(rows.map((r) => [r.value, r._count._all]));
    return [5, 4, 3, 2, 1].map((stars) => ({ stars, count: by.get(stars) ?? 0 }));
  }

  /** Pune sau schimbă nota actorului (1–5). Întoarce noua medie. */
  async rate(actor: GcsActor, contentType: string, contentId: string, value: number): Promise<GcsRatingSummary> {
    const policy = this.policy(contentType);
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (!Number.isInteger(value) || value < 1 || value > GCS_RATING_MAX) throw new GcsValidationError({ value: "invalid_range" });
    if (!(await policy.canView(actor, contentId))) throw new GcsNotFound();
    const reason = await policy.check(actor, contentId);
    if (reason) throw new GcsForbidden({ reason });
    const userId = actor.userId;
    const key = { contentType_contentId_userId: { contentType, contentId, userId } };
    const summary = await this.deps.db.$transaction(async (tx) => {
      const existing = await tx.contentRating.findUnique({ where: key, select: { value: true } });
      if (existing && existing.value !== value && !(await policy.changeVote())) throw new GcsConflict({ reason: "already_rated" });
      if (existing?.value === value) return this.recount(tx, contentType, contentId, policy);
      await tx.contentRating.upsert({ where: key, create: { contentType, contentId, userId, value }, update: { value } });
      return this.recount(tx, contentType, contentId, policy);
    });
    await this.changed(contentType, contentId, policy);
    return summary;
  }

  /** Retrage nota actorului (doar dacă își poate schimba votul). */
  async unrate(actor: GcsActor, contentType: string, contentId: string): Promise<GcsRatingSummary> {
    const policy = this.policy(contentType);
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (!(await policy.canView(actor, contentId))) throw new GcsNotFound();
    if (!(await policy.changeVote())) throw new GcsConflict({ reason: "already_rated" });
    const userId = actor.userId;
    const summary = await this.deps.db.$transaction(async (tx) => {
      await tx.contentRating.deleteMany({ where: { contentType, contentId, userId } });
      return this.recount(tx, contentType, contentId, policy);
    });
    await this.changed(contentType, contentId, policy);
    return summary;
  }

  /** Voturile unui conținut (moderarea: cine a votat ce), cele mai noi primele. */
  async votes(actor: GcsActor, contentType: string, contentId: string): Promise<{ userId: string; name: string; value: number; at: string }[]> {
    const policy = this.policy(contentType);
    if (!(await policy.canModerate(actor, contentId))) throw new GcsForbidden({ permission: "rating.moderate" });
    const rows = await this.deps.db.contentRating.findMany({
      where: { contentType, contentId },
      orderBy: { updatedAt: "desc" },
      take: 500,
      select: { userId: true, value: true, updatedAt: true, user: { select: { name: true } } },
    });
    return rows.map((r) => ({ userId: r.userId, name: r.user.name, value: r.value, at: r.updatedAt.toISOString() }));
  }

  /** Moderarea: scoate votul unui membru (abuziv) sau toate voturile (`userId: null`, resetarea notei). */
  async removeVotes(actor: GcsActor, contentType: string, contentId: string, userId: string | null): Promise<GcsRatingSummary> {
    const policy = this.policy(contentType);
    if (!(await policy.canModerate(actor, contentId))) throw new GcsForbidden({ permission: "rating.moderate" });
    const summary = await this.deps.db.$transaction(async (tx) => {
      const removed = await tx.contentRating.deleteMany({ where: { contentType, contentId, ...(userId ? { userId } : {}) } });
      const s = await this.recount(tx, contentType, contentId, policy);
      await writeAudit(tx, {
        actorId: actor.userId,
        action: userId ? "rating.vote.remove" : "rating.reset",
        targetType: contentType,
        targetId: contentId,
        after: { userId, removed: removed.count, ...s },
        ip: actor.ip,
      });
      return s;
    });
    await this.changed(contentType, contentId, policy);
    return summary;
  }

  /** Cele mai bine notate conținuturi ale unui tip (cu cel puțin `minVotes` voturi), dintr-o listă de id-uri permise. */
  async top(contentType: string, opts: { ids?: string[]; minVotes?: number; limit: number; since?: Date }): Promise<{ contentId: string; avg: number; count: number }[]> {
    const rows = await this.deps.db.contentRatingSummary.findMany({
      where: {
        contentType,
        count: { gte: Math.max(1, opts.minVotes ?? 1) },
        ...(opts.ids ? { contentId: { in: opts.ids } } : {}),
        ...(opts.since ? { updatedAt: { gte: opts.since } } : {}),
      },
      orderBy: [{ avg: "desc" }, { count: "desc" }],
      take: opts.limit,
      select: { contentId: true, avg: true, count: true },
    });
    return rows;
  }

  private async recount(tx: Prisma.TransactionClient, contentType: string, contentId: string, policy: GcsRatingPolicy): Promise<GcsRatingSummary> {
    const agg = await tx.contentRating.aggregate({ where: { contentType, contentId }, _count: { _all: true }, _sum: { value: true } });
    const count = agg._count._all;
    const sum = agg._sum.value ?? 0;
    const avg = count === 0 ? 0 : Math.round((sum / count) * 100) / 100;
    await tx.contentRatingSummary.upsert({
      where: { contentType_contentId: { contentType, contentId } },
      create: { contentType, contentId, count, sum, avg },
      update: { count, sum, avg },
    });
    await policy.onChange?.(tx, contentId, { avg, count });
    return { avg, count };
  }

  private async changed(contentType: string, contentId: string, policy: GcsRatingPolicy): Promise<void> {
    const tags = (await policy.tags?.(contentId)) ?? [];
    await this.deps.bus.emit({ name: "rating.changed", payload: { contentType, contentId }, tags });
  }
}
