import {
  debouncedJobId,
  GcsConflict,
  GcsNotFound,
  GcsValidationError,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsEventBus,
  type GcsJobQueue,
} from "@gcs/core";
import type { AchievementTrigger, PrismaClient, Rank } from "@gcs/db";
import type { GcsModuleRegistry, GcsRealtime } from "@gcs/core";
import type { GcsMembership } from "./membership";
import { applyRankPerks, rankEmblemArt, rankMetrics, rankQualifies, usedMetrics, type GcsLadderRankV2, type GcsRankStats } from "./rankLadder";
import { badgeArtSrc } from "@gcs/ui/badge-art";

export const ACHIEVEMENTS_JOB = "achievements.evaluate";
export const RANKS_RECOMPUTE_JOB = "achievements.recompute_ranks";
export const MEMBERS_DAILY_JOB = "members.daily";
export const BACKFILL_JOB = "achievements.backfill";
/** Marcajul evaluării inițiale (site-urile actualizate din etapele anterioare sau importate). */
const BACKFILL_DONE = "achievements.backfill_done";
export const BADGES_ACP_SECTION = "members.badges";

/** Evenimentele unui user din aceeași fereastră de 2 s produc o singură evaluare (specul etapei 3, §5). */
const EVALUATE_WINDOW_MS = 2000;
/** Regulile pe puncte se pot declanșa în lanț (un badge dă puncte); limităm numărul de treceri. */
const MAX_PASSES = 5;
const BATCH = 500;

type EachTrigger = Extract<AchievementTrigger, "EACH_POST" | "EACH_REACTION_RECEIVED" | "EACH_SOLUTION">;
export type GcsThresholdTrigger = Exclude<AchievementTrigger, EachTrigger | "EVENT">;
type ThresholdTrigger = GcsThresholdTrigger;
export const THRESHOLD_TRIGGERS: ThresholdTrigger[] = ["POSTS_COUNT", "REPUTATION", "POINTS", "MEMBER_DAYS", "SOLUTIONS_COUNT", "IS_VIP"];

export type GcsUserStats = { postsCount: number; reputation: number; points: number; solutionsCount: number; memberDays: number; isVip: boolean };

const userTags = (id: string) => [`user:${id}`];

/** Dependențele rangurilor moderne (metricile aplicațiilor, avantajele, toast-ul live). */
export type GcsRankingDeps = {
  registry: GcsModuleRegistry;
  enabledFilter?: () => Promise<(key: string) => boolean>;
  membership: GcsMembership;
  realtime?: Pick<GcsRealtime, "publish"> | null;
};

/** Valoarea unui user pentru un trigger cu prag. */
export function statFor(trigger: ThresholdTrigger, s: GcsUserStats): number {
  switch (trigger) {
    case "POSTS_COUNT":
      return s.postsCount;
    case "REPUTATION":
      return s.reputation;
    case "POINTS":
      return s.points;
    case "MEMBER_DAYS":
      return s.memberDays;
    case "SOLUTIONS_COUNT":
      return s.solutionsCount;
    case "IS_VIP":
      return s.isVip ? 1 : 0;
  }
}

/**
 * Cel mai înalt rang (ultimul după `position`) cu pragurile atinse (toate sau oricare, după `match`, inclusiv criteriile
 * aplicațiilor din `metrics`); `null` dacă niciunul.
 */
export function pickRank(ranks: GcsLadderRankV2[], s: GcsRankStats): number | null {
  let best: { id: number; position: number } | null = null;
  for (const r of ranks) {
    if (rankQualifies(r, s)) {
      if (!best || r.position > best.position || (r.position === best.position && r.id > best.id)) best = r;
    }
  }
  return best?.id ?? null;
}

/** Valorile unui user pentru regulile cu prag (și progresul badge-urilor blocate de pe profil). */
export async function userStats(db: PrismaClient, userId: string, now = new Date()): Promise<GcsUserStats | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      postsCount: true,
      reputation: true,
      points: true,
      solutionsCount: true,
      createdAt: true,
      primaryGroup: { select: { isVip: true } },
      groups: { select: { group: { select: { isVip: true } } } },
    },
  });
  if (!user) return null;
  return {
    postsCount: user.postsCount,
    reputation: user.reputation,
    points: user.points,
    solutionsCount: user.solutionsCount,
    memberDays: Math.floor((now.getTime() - user.createdAt.getTime()) / 86_400_000),
    isVip: user.primaryGroup.isVip || user.groups.some((g) => g.group.isVip),
  };
}

/**
 * Puncte, reguli de realizări, badge-uri și ranguri (specul etapei 3, §4, §5).
 * - Punctele pe acțiune (`EACH_*`) se acordă imediat, cu o cheie unică pe eveniment (un eveniment repetat nu dublează).
 * - Regulile cu prag, rangul și promovările se evaluează în worker (`achievements.evaluate`), o dată pe regulă și user.
 */
export class GcsAchievementService {
  /** Rulate după fiecare evaluare (ex. promovările de grup, Task 7). */
  private readonly afterEvaluate: ((userId: string) => Promise<void>)[] = [];

  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; acp: GcsAcpRoleService; jobs: GcsJobQueue | null }) {}

  /** Rulate în jobul zilnic, după sweep-ul regulilor (ex. promovările pe vechime). */
  private readonly daily: ((now: Date) => Promise<unknown>)[] = [];

  onEvaluated(fn: (userId: string) => Promise<void>): void {
    this.afterEvaluate.push(fn);
  }

  onDaily(fn: (now: Date) => Promise<unknown>): void {
    this.daily.push(fn);
  }

  /** Programează evaluarea unui user (deduplicată pe fereastra de 2 s). Fără coadă (teste), nu face nimic. */
  async schedule(userId: string): Promise<void> {
    await this.deps.jobs?.enqueue(ACHIEVEMENTS_JOB, { userId }, { jobId: debouncedJobId(`ach-${userId}`, EVALUATE_WINDOW_MS), delayMs: EVALUATE_WINDOW_MS });
  }

  /** Punctele unei acțiuni (`EACH_*`), o singură dată pe `ref` (ex. `post:120`). Întoarce punctele acordate. */
  async awardEach(userId: string, trigger: EachTrigger, ref: string): Promise<number> {
    const { db, bus } = this.deps;
    const rules = await db.achievementRule.findMany({ where: { trigger, enabled: true, points: { not: 0 } } });
    if (rules.length === 0) return 0;
    const total = await db.$transaction(async (tx) => {
      let sum = 0;
      for (const rule of rules) {
        const { count } = await tx.achievementLog.createMany({
          data: [{ userId, ruleId: rule.id, points: rule.points, uniqueKey: `each:${rule.id}:${ref}`, contentRef: ref }],
          skipDuplicates: true,
        });
        if (count > 0) sum += rule.points;
      }
      if (sum !== 0) await tx.user.update({ where: { id: userId }, data: { points: { increment: sum } } });
      return sum;
    });
    if (total !== 0) await bus.emit({ name: "points.changed", payload: { userId, delta: total }, tags: userTags(userId) });
    return total;
  }

  async stats(userId: string, now = new Date()): Promise<GcsUserStats | null> {
    return userStats(this.deps.db, userId, now);
  }

  /**
   * Evaluează regulile cu prag (badge + puncte, o singură dată pe regulă, chiar cu rulări paralele),
   * apoi rangul și promovările. Idempotent.
   */
  async evaluate(userId: string, now = new Date()): Promise<void> {
    const { db, bus } = this.deps;
    const rules = await db.achievementRule.findMany({
      where: { enabled: true, trigger: { in: THRESHOLD_TRIGGERS } },
      include: { badge: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const stats = await this.stats(userId, now);
      if (!stats) return;
      const due = rules.filter((r) => statFor(r.trigger as ThresholdTrigger, stats) >= Math.max(r.threshold, r.trigger === "IS_VIP" ? 1 : 0));
      if (due.length === 0) break;
      const awarded = await db.$transaction(async (tx) => {
        const out: { badgeId: number | null; points: number }[] = [];
        for (const rule of due) {
          const { count } = await tx.achievementLog.createMany({
            data: [{ userId, ruleId: rule.id, points: rule.points, uniqueKey: `rule:${rule.id}` }],
            skipDuplicates: true,
          });
          if (count === 0) continue;
          let points = rule.points;
          let badgeId: number | null = null;
          if (rule.badge) {
            const created = await tx.userBadge.createMany({ data: [{ userId, badgeId: rule.badge.id }], skipDuplicates: true });
            if (created.count > 0) {
              points += rule.badge.points;
              badgeId = rule.badge.id;
            }
          }
          if (points !== 0) await tx.user.update({ where: { id: userId }, data: { points: { increment: points } } });
          out.push({ badgeId, points });
        }
        return out;
      });
      if (awarded.length === 0) break;
      for (const a of awarded) {
        if (a.badgeId !== null) await bus.emit({ name: "badge.awarded", payload: { userId, badgeId: a.badgeId, byRule: true }, tags: userTags(userId) });
      }
      const delta = awarded.reduce((s, a) => s + a.points, 0);
      if (delta !== 0) await bus.emit({ name: "points.changed", payload: { userId, delta }, tags: userTags(userId) });
      // Doar regulile pe puncte pot deveni îndeplinite după acordare; altfel o trecere ajunge.
      if (!rules.some((r) => r.trigger === "POINTS")) break;
    }
    await this.recomputeRank(userId);
    for (const fn of this.afterEvaluate) await fn(userId);
  }

  /** Rangurile moderne: metricile aplicațiilor, avantajele (grupuri secundare) și toast-ul live de urcare. */
  private ranking: GcsRankingDeps | null = null;

  configureRanks(ranking: GcsRankingDeps): void {
    this.ranking = ranking;
  }

  /** Metricile aplicațiilor cerute de criteriile rangurilor, pentru un membru. */
  async rankMetricsFor(userId: string, ranks: Pick<Rank, "criteria">[]): Promise<Record<string, number>> {
    const keys = usedMetrics(ranks);
    if (!this.ranking || keys.length === 0) return {};
    const enabled = (await this.ranking.enabledFilter?.()) ?? (() => true);
    return rankMetrics({ db: this.deps.db, registry: this.ranking.registry, enabled }, userId, keys);
  }

  /** Schimbă rangul unui membru: avantajele (în tranzacție), apoi evenimentele și, la urcare, toast-ul live. */
  private async changeRank(userId: string, list: Rank[], previousRankId: number | null, rankId: number | null): Promise<void> {
    const { db, bus } = this.deps;
    const prev = list.find((r) => r.id === previousRankId) ?? null;
    const next = list.find((r) => r.id === rankId) ?? null;
    // Două evaluări simultane ale aceluiași membru: doar cea care schimbă efectiv rangul (de la cel vechi) continuă,
    // ca avantajele, notificarea și toast-ul să apară o singură dată.
    const perks = await db.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({ where: { id: userId, rankId: previousRankId }, data: { rankId } });
      if (count === 0) return null;
      return this.ranking ? applyRankPerks(tx, this.ranking.membership, userId, prev, next) : { groups: [], badgeId: null, revokedBadgeId: null };
    });
    if (!perks) return;
    if (perks.groups.length > 0 && this.ranking) await this.ranking.membership.notify(userId, perks.groups);
    if (perks.revokedBadgeId !== null) await bus.emit({ name: "badge.revoked", payload: { userId, badgeId: perks.revokedBadgeId }, tags: userTags(userId) });
    if (perks.badgeId !== null) await bus.emit({ name: "badge.awarded", payload: { userId, badgeId: perks.badgeId, byRule: true }, tags: userTags(userId) });
    const up = next !== null && (prev === null || next.position > prev.position || (next.position === prev.position && next.id > prev.id));
    await bus.emit({ name: "rank.changed", payload: { userId, rankId, previousRankId, up }, tags: userTags(userId) });
    if (up && next && this.ranking?.realtime) {
      const sorted = [...list].sort((a, b) => a.position - b.position || a.id - b.id);
      const level = sorted.findIndex((r) => r.id === next.id) + 1;
      await this.ranking.realtime.publish(`user:${userId}`, "rank-up", { rankId: next.id, name: next.name, level, art: badgeArtSrc(rankEmblemArt(next, level - 1)), animated: next.animated });
    }
  }

  async recomputeRank(userId: string, ranks?: Rank[]): Promise<number | null> {
    const { db } = this.deps;
    const list = ranks ?? (await db.rank.findMany());
    const user = await db.user.findUnique({ where: { id: userId }, select: { rankId: true, postsCount: true, points: true, reputation: true } });
    if (!user) return null;
    const rankId = pickRank(list, { ...user, metrics: await this.rankMetricsFor(userId, list) });
    if (rankId !== user.rankId) await this.changeRank(userId, list, user.rankId, rankId);
    return rankId;
  }

  /** Recalculează rangurile tuturor (după editarea rangurilor în ACP), în loturi. */
  async recomputeAllRanks(): Promise<number> {
    const { db, bus } = this.deps;
    const ranks = await db.rank.findMany();
    const withMetrics = usedMetrics(ranks).length > 0;
    const withPerks = ranks.some((r) => r.perkGroupId !== null || r.perkBadgeId !== null || r.perkNameStyleId !== null);
    let cursor: string | undefined;
    let changed = 0;
    for (;;) {
      const users = await db.user.findMany({
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, rankId: true, postsCount: true, points: true, reputation: true },
      });
      if (users.length === 0) break;
      const byRank = new Map<number | null, string[]>();
      for (const u of users) {
        const rankId = pickRank(ranks, { ...u, ...(withMetrics ? { metrics: await this.rankMetricsFor(u.id, ranks) } : {}) });
        if (rankId === u.rankId) continue;
        changed++;
        // Cu avantaje, fiecare schimbare trece prin grupuri / badge-uri; altfel, actualizarea în lot.
        if (withPerks) await this.changeRank(u.id, ranks, u.rankId, rankId);
        else byRank.set(rankId, [...(byRank.get(rankId) ?? []), u.id]);
      }
      for (const [rankId, ids] of byRank) await db.user.updateMany({ where: { id: { in: ids } }, data: { rankId } });
      cursor = users[users.length - 1]!.id;
    }
    await bus.emit({ name: "ranks.recomputed", payload: { changed }, tags: ["ranks"] });
    return changed;
  }

  /** Jobul zilnic: membrii care au atins o vechime cerută de o regulă `MEMBER_DAYS` și n-au primit-o încă. */
  async dailySweep(now = new Date()): Promise<number> {
    const { db } = this.deps;
    const rules = await db.achievementRule.findMany({ where: { enabled: true, trigger: "MEMBER_DAYS" }, select: { id: true, threshold: true } });
    const due = new Set<string>();
    for (const rule of rules) {
      const before = new Date(now.getTime() - rule.threshold * 86_400_000);
      const users = await db.user.findMany({
        where: { createdAt: { lte: before }, achievementLog: { none: { uniqueKey: `rule:${rule.id}` } } },
        select: { id: true },
      });
      for (const u of users) due.add(u.id);
    }
    for (const userId of due) await this.evaluate(userId, now);
    return due.size;
  }

  /**
   * Evaluarea inițială, o singură dată: membrii existenți dinaintea regulilor (site actualizat, import) primesc
   * rangul, badge-urile și punctele pentru pragurile deja atinse. Rulează în worker, în loturi; apoi pune un marcaj.
   */
  async backfill(): Promise<number> {
    const { db } = this.deps;
    if (await db.setting.findUnique({ where: { key: BACKFILL_DONE } })) return 0;
    let cursor: string | undefined;
    let count = 0;
    for (;;) {
      const users = await db.user.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" }, select: { id: true } });
      if (users.length === 0) break;
      for (const u of users) await this.evaluate(u.id);
      count += users.length;
      cursor = users[users.length - 1]!.id;
    }
    await db.setting.upsert({ where: { key: BACKFILL_DONE }, create: { key: BACKFILL_DONE, value: true }, update: { value: true } });
    return count;
  }

  // ─── Badge-uri manuale (staff) ───────────────────────────────────────────

  async awardBadge(actor: GcsActor, userId: string, badgeId: number, reason: string): Promise<void> {
    const { db, bus, acp } = this.deps;
    await acp.assert(actor, BADGES_ACP_SECTION, "edit");
    const [badge, user] = await Promise.all([db.badge.findUnique({ where: { id: badgeId } }), db.user.findUnique({ where: { id: userId }, select: { id: true } })]);
    if (!badge || !user) throw new GcsNotFound();
    const clean = reason.trim().slice(0, 200);
    if (clean === "") throw new GcsValidationError({ reason: "required" });
    await db.$transaction(async (tx) => {
      const { count } = await tx.userBadge.createMany({ data: [{ userId, badgeId, awardedById: actor.userId, reason: clean }], skipDuplicates: true });
      if (count === 0) throw new GcsConflict({ reason: "already_awarded" });
      if (badge.points !== 0) await tx.user.update({ where: { id: userId }, data: { points: { increment: badge.points } } });
      await writeAudit(tx, { actorId: actor.userId, action: "badge.award", targetType: "user", targetId: userId, after: { badge: badge.key, reason: clean }, ip: actor.ip });
    });
    await bus.emit({ name: "badge.awarded", payload: { userId, badgeId, byRule: false }, tags: userTags(userId) });
    await this.schedule(userId);
  }

  /**
   * Acordarea automată a unui badge de către o aplicație (ex. câștigătorul clasamentului Chat Pro), fără drept ACP:
   * badge-ul după cheie, o singură dată pe membru (cu punctele lui), apoi evenimentul `badge.awarded`. Întoarce `false`
   * dacă membrul îl avea deja sau badge-ul nu există.
   */
  async grantSystemBadge(userId: string, badgeKey: string, reason: string): Promise<boolean> {
    const { db, bus } = this.deps;
    const badge = await db.badge.findUnique({ where: { key: badgeKey } });
    if (!badge) return false;
    const granted = await db.$transaction(async (tx) => {
      const { count } = await tx.userBadge.createMany({ data: [{ userId, badgeId: badge.id, awardedById: null, reason: reason.slice(0, 200) }], skipDuplicates: true });
      if (count === 0) return false;
      if (badge.points !== 0) await tx.user.update({ where: { id: userId }, data: { points: { increment: badge.points } } });
      await writeAudit(tx, { actorId: null, action: "badge.award", targetType: "user", targetId: userId, after: { badge: badge.key, reason, system: true }, ip: null });
      return true;
    });
    if (!granted) return false;
    await bus.emit({ name: "badge.awarded", payload: { userId, badgeId: badge.id, byRule: true }, tags: userTags(userId) });
    await this.schedule(userId);
    return true;
  }

  /** Retrage un badge (punctele primite rămân; o regulă nu-l mai acordă din nou, pentru că a rulat deja). */
  async revokeBadge(actor: GcsActor, userId: string, badgeId: number): Promise<void> {
    const { db, bus, acp } = this.deps;
    await acp.assert(actor, BADGES_ACP_SECTION, "edit");
    const row = await db.userBadge.findUnique({ where: { userId_badgeId: { userId, badgeId } }, include: { badge: true } });
    if (!row) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.userBadge.delete({ where: { id: row.id } });
      await writeAudit(tx, { actorId: actor.userId, action: "badge.revoke", targetType: "user", targetId: userId, before: { badge: row.badge.key }, ip: actor.ip });
    });
    await bus.emit({ name: "badge.revoked", payload: { userId, badgeId }, tags: userTags(userId) });
  }

  /**
   * Ascultătorii care leagă forumul, reacțiile și VIP-ul de reguli: punctele pe acțiune pe loc,
   * apoi evaluarea programată în worker.
   */
  listen(bus: GcsEventBus): void {
    const each = async (userId: unknown, trigger: EachTrigger, ref: string) => {
      if (typeof userId !== "string") return;
      await this.awardEach(userId, trigger, ref);
      await this.schedule(userId);
    };
    bus.on("post.created", async (e) => {
      if (!e.payload.pending) await each(e.payload.authorId, "EACH_POST", `post:${String(e.payload.postId)}`);
    });
    bus.on("topic.created", async (e) => {
      if (!e.payload.pending) await each(e.payload.authorId, "EACH_POST", `post:${String(e.payload.postId)}`);
    });
    bus.on("post.approved", async (e) => {
      for (const p of (e.payload.posts as { postId: number; authorId: string | null }[]) ?? []) {
        await each(p.authorId, "EACH_POST", `post:${p.postId}`);
      }
    });
    bus.on("reaction.changed", async (e) => {
      const { authorId, reactionId, contentType, contentId, userId } = e.payload as Record<string, unknown>;
      if (typeof authorId !== "string" || authorId === userId) return;
      if (typeof reactionId === "number") {
        const reaction = await this.deps.db.reaction.findUnique({ where: { id: reactionId }, select: { weight: true } });
        if (reaction && reaction.weight > 0) {
          await this.awardEach(authorId, "EACH_REACTION_RECEIVED", `reaction:${String(contentType)}:${String(contentId)}:${String(userId)}`);
        }
      }
      await this.schedule(authorId);
    });
    bus.on("topic.solved", async (e) => {
      const { solverId, previousSolverId, topicId, postId } = e.payload as Record<string, unknown>;
      if (typeof solverId === "string") await each(solverId, "EACH_SOLUTION", `solution:${String(topicId)}:${String(postId)}`);
      if (typeof previousSolverId === "string") await this.schedule(previousSolverId);
    });
    for (const name of ["vip.granted", "vip.expired", "vip.revoked", "group.promoted"]) {
      bus.on(name, async (e) => {
        if (typeof e.payload.userId === "string") await this.schedule(e.payload.userId);
      });
    }
  }

  /** Joburile din worker: evaluarea unui user, recalcularea rangurilor și sweep-ul zilnic (04:00). */
  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({
      name: ACHIEVEMENTS_JOB,
      handler: async (data) => {
        if (typeof data.userId === "string") await this.evaluate(data.userId);
      },
    });
    jobs.register({ name: RANKS_RECOMPUTE_JOB, handler: async () => void (await this.recomputeAllRanks()) });
    jobs.register({ name: BACKFILL_JOB, handler: async () => void (await this.backfill()) });
    jobs.register({
      name: MEMBERS_DAILY_JOB,
      pattern: "0 4 * * *",
      handler: async () => {
        const now = new Date();
        await this.dailySweep(now);
        for (const fn of this.daily) await fn(now);
      },
    });
  }
}
