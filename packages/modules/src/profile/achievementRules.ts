import type { GcsAchievementEventDef, GcsAchievementOccurrence, GcsActor, GcsEventBus, GcsJobQueue, GcsModuleRegistry, GcsRealtime } from "@gcs/core";
import type { AchievementRule, Prisma, PrismaClient } from "@gcs/db";
import type { GcsMembership } from "./membership";

/**
 * Realizări v2: constructorul de reguli „Când → Și → Atunci” (ACP → Membri → Realizări → Reguli).
 * - **Când:** un eveniment din registrul `achievementEvents` al modulelor (doar cu aplicația lui pornită);
 * - **Și:** a n-a oară / la fiecare n / o valoare atinsă, pe anumite forumuri, servere sau grupuri, într-o fereastră;
 * - **Atunci:** puncte, badge, grup secundar (temporar sau permanent), zile VIP, stil de nume — separat pentru membru
 *   și pentru cealaltă parte (ex. cine a primit reacția și cine a dat-o).
 */

export const RULE_MODES = ["nth", "every", "reach"] as const;
export type GcsRuleMode = (typeof RULE_MODES)[number];

export type GcsRuleConditions = {
  mode: GcsRuleMode;
  n: number;
  forumIds: number[];
  serverIds: number[];
  groupIds: number[];
  /** Doar aparițiile din ultimele N zile (null = oricând). */
  windowDays: number | null;
};

export type GcsRuleReward = {
  points: number;
  badgeId: number | null;
  groupId: number | null;
  /** Zilele grupului secundar (null = permanent). */
  groupDays: number | null;
  vipGroupId: number | null;
  vipDays: number | null;
  nameStyleId: number | null;
};

export type GcsRuleRewards = { actor: GcsRuleReward; other: GcsRuleReward | null };

export const EMPTY_REWARD: GcsRuleReward = { points: 0, badgeId: null, groupId: null, groupDays: null, vipGroupId: null, vipDays: null, nameStyleId: null };

export const SETTING_EXCLUDED_GROUPS = "achievements.excluded_groups";
export const SETTING_RARE_PERCENT = "achievements.rare_percent";
export const RECALC_JOB = "achievements.recalculate";
export const RECALC_STATUS = "achievements.recalc_status";
export const GAME_SWEEP_JOB = "achievements.game_sweep";
/** Bus-ul generic: orice aplicație poate trimite o apariție a unui eveniment declarat (ex. „câștigă un clan war”). */
export const OCCURRENCE_EVENT = "achievements.occurrence";
/** Camera live a widget-ului „Ultimele realizări”. */
export const BADGE_FEED_ROOM = "feed:badges";
export const RULE_SOURCE = "achievements";

const MAX_N = 10_000_000;
const MAX_DAYS = 3650;
const BATCH = 200;

const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const ids = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x > 0))].slice(0, 100) : []);

/** Condițiile normalizate (valorile invalide devin implicite); `kind` decide modul permis. */
export function normalizeConditions(raw: unknown, kind: GcsAchievementEventDef["kind"] = "count"): GcsRuleConditions {
  const r = (raw ?? {}) as Record<string, unknown>;
  const mode: GcsRuleMode = kind === "value" ? "reach" : r.mode === "every" ? "every" : "nth";
  return {
    mode,
    n: int(r.n, 1, MAX_N) ?? 1,
    forumIds: ids(r.forumIds),
    serverIds: ids(r.serverIds),
    groupIds: ids(r.groupIds),
    windowDays: kind === "value" ? null : int(r.windowDays, 1, MAX_DAYS),
  };
}

export function normalizeReward(raw: unknown): GcsRuleReward {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pos = (v: unknown) => int(v, 1, 2_147_483_647);
  return {
    points: int(r.points, -1000, 1000) ?? 0,
    badgeId: pos(r.badgeId),
    groupId: pos(r.groupId),
    groupDays: int(r.groupDays, 1, MAX_DAYS),
    vipGroupId: pos(r.vipGroupId),
    vipDays: int(r.vipDays, 1, MAX_DAYS),
    nameStyleId: pos(r.nameStyleId),
  };
}

export const rewardEmpty = (r: GcsRuleReward) => r.points === 0 && r.badgeId === null && r.groupId === null && (r.vipGroupId === null || r.vipDays === null) && r.nameStyleId === null;

export function normalizeRewards(raw: unknown): GcsRuleRewards {
  const r = (raw ?? {}) as Record<string, unknown>;
  const other = r.other ? normalizeReward(r.other) : null;
  return { actor: normalizeReward(r.actor), other: other && !rewardEmpty(other) ? other : null };
}

/**
 * Decizia unei reguli pentru o apariție numărată: `count` = aparițiile (în fereastră) după cea de acum. „A n-a oară” se
 * acordă o singură dată (cheia regulii), „la fiecare n” la fiecare multiplu (cheia apariției).
 */
export function countDecision(c: Pick<GcsRuleConditions, "mode" | "n">, count: number): "once" | "repeat" | null {
  if (c.mode === "every") return count > 0 && count % c.n === 0 ? "repeat" : null;
  return count >= c.n ? "once" : null;
}

type V2Rule = AchievementRule & { cond: GcsRuleConditions; rew: GcsRuleRewards; def: GcsAchievementEventDef };

export type GcsRecalcStatus = { state: "idle" | "queued" | "running" | "done"; done: number; total: number; awarded: number; startedAt: string | null; finishedAt: string | null };

/** Ce s-a acordat într-o declanșare (pentru evenimentele de după commit). */
type Granted = { userId: string; badgeId: number | null; points: number; groups: number[]; vip: { groupId: number; days: number } | null };

export type GcsAchievementRuleDeps = {
  db: PrismaClient;
  bus: GcsEventBus;
  registry: GcsModuleRegistry;
  /** Aplicațiile pornite (`GcsAppService.enabledFilter`); fără el, toate sunt pornite (teste). */
  enabledFilter?: () => Promise<(key: string) => boolean>;
  setting?: <T>(key: string) => Promise<T>;
  membership: GcsMembership;
  realtime?: Pick<GcsRealtime, "publish"> | null;
  /** Zilele VIP (serviciul VIP, cu un actor de sistem). */
  grantVip?: (userId: string, groupId: number, days: number) => Promise<void>;
  /** Programează evaluarea pragurilor/rangului după o acordare. */
  schedule?: (userId: string) => Promise<void>;
  jobs?: GcsJobQueue | null;
};

export class GcsAchievementRules {
  constructor(private readonly deps: GcsAchievementRuleDeps) {}

  get registry(): GcsModuleRegistry {
    return this.deps.registry;
  }

  /** Evenimentele disponibile acum (aplicațiile pornite), cu modulul fiecăruia. */
  async availableEvents(): Promise<{ module: string; def: GcsAchievementEventDef }[]> {
    const on = (await this.deps.enabledFilter?.()) ?? (() => true);
    return this.deps.registry.achievementEvents().filter((e) => on(e.module));
  }

  private async eventDef(key: string): Promise<GcsAchievementEventDef | null> {
    return (await this.availableEvents()).find((e) => e.def.key === key)?.def ?? null;
  }

  private async excludedGroups(): Promise<number[]> {
    const v = await this.deps.setting?.<unknown>(SETTING_EXCLUDED_GROUPS).catch(() => []);
    return ids(v);
  }

  private async rulesFor(event: string, def: GcsAchievementEventDef): Promise<V2Rule[]> {
    const rows = await this.deps.db.achievementRule.findMany({ where: { trigger: "EVENT", event, enabled: true }, orderBy: [{ position: "asc" }, { id: "asc" }] });
    return rows.map((r) => ({ ...r, cond: normalizeConditions(r.conditions, def.kind), rew: normalizeRewards(r.rewards), def }));
  }

  private async groupsOf(userId: string): Promise<number[] | null> {
    const u = await this.deps.db.user.findUnique({ where: { id: userId }, select: { primaryGroupId: true, groups: { select: { groupId: true } } } });
    return u ? [u.primaryGroupId, ...u.groups.map((g) => g.groupId)] : null;
  }

  /** Ascultătorii: fiecare sursă a fiecărui eveniment din registru, plus evenimentul generic `achievements.occurrence`. */
  listen(bus: GcsEventBus): void {
    const byBusEvent = new Map<string, { def: GcsAchievementEventDef; map: NonNullable<GcsAchievementEventDef["sources"]>[number]["map"] }[]>();
    for (const { def } of this.deps.registry.achievementEvents()) {
      for (const s of def.sources ?? []) byBusEvent.set(s.event, [...(byBusEvent.get(s.event) ?? []), { def, map: s.map }]);
    }
    for (const [name, handlers] of byBusEvent) {
      bus.on(name, async (e) => {
        for (const h of handlers) {
          const occ = await h.map(e, { db: this.deps.db });
          for (const o of occ) await this.handle(h.def.key, o);
        }
      });
    }
    bus.on(OCCURRENCE_EVENT, async (e) => {
      const p = e.payload as Record<string, unknown>;
      if (typeof p.event !== "string" || typeof p.userId !== "string" || typeof p.ref !== "string") return;
      await this.handle(p.event, {
        userId: p.userId,
        ref: p.ref,
        otherUserId: typeof p.otherUserId === "string" ? p.otherUserId : null,
        ...(typeof p.value === "number" ? { value: p.value } : {}),
        forumId: typeof p.forumId === "number" ? p.forumId : null,
        serverId: typeof p.serverId === "number" ? p.serverId : null,
      });
    });
    // Widget-ul „Ultimele realizări”: orice badge nou (reguli, staff, perioade) ajunge live.
    bus.on("badge.awarded", async (e) => {
      await this.deps.realtime?.publish(BADGE_FEED_ROOM, "badge", { userId: e.payload.userId, badgeId: e.payload.badgeId });
    });
  }

  /** O apariție a unui eveniment: regulile lui, condițiile, apoi recompensele. Întoarce numărul de reguli declanșate. */
  async handle(event: string, occ: GcsAchievementOccurrence, now = new Date()): Promise<number> {
    const def = await this.eventDef(event);
    if (!def) return 0;
    const rules = await this.rulesFor(event, def);
    if (rules.length === 0) return 0;
    const [groups, excluded] = await Promise.all([this.groupsOf(occ.userId), this.excludedGroups()]);
    if (!groups || groups.some((g) => excluded.includes(g))) return 0;
    let fired = 0;
    for (const rule of rules) {
      const c = rule.cond;
      if (c.forumIds.length > 0 && (occ.forumId == null || !c.forumIds.includes(occ.forumId))) continue;
      if (c.serverIds.length > 0 && (occ.serverId == null || !c.serverIds.includes(occ.serverId))) continue;
      if (c.groupIds.length > 0 && !groups.some((g) => c.groupIds.includes(g))) continue;
      let key: string | null = null;
      if (def.kind === "value") {
        const value = occ.value ?? (def.current ? await def.current({ db: this.deps.db }, occ.userId, { forumIds: c.forumIds, serverIds: c.serverIds }) : 0);
        if (value >= c.n) key = `v2:${rule.id}`;
      } else {
        const { count: inserted } = await this.deps.db.achievementOccurrence.createMany({ data: [{ ruleId: rule.id, userId: occ.userId, ref: occ.ref, createdAt: now }], skipDuplicates: true });
        if (inserted === 0) continue;
        const since = c.windowDays ? new Date(now.getTime() - c.windowDays * 86_400_000) : null;
        const count = await this.deps.db.achievementOccurrence.count({ where: { ruleId: rule.id, userId: occ.userId, ...(since ? { createdAt: { gte: since } } : {}) } });
        const d = countDecision(c, count);
        if (d === "once") key = `v2:${rule.id}`;
        else if (d === "repeat") key = `v2:${rule.id}:o:${occ.ref}`;
      }
      if (key === null) continue;
      const other = occ.otherUserId && occ.otherUserId !== occ.userId && rule.rew.other && !(await this.isExcluded(occ.otherUserId, excluded)) ? occ.otherUserId : null;
      if (await this.fire(rule, occ.userId, other, key, occ.ref)) fired++;
    }
    return fired;
  }

  private async isExcluded(userId: string, excluded: number[]): Promise<boolean> {
    const g = await this.groupsOf(userId);
    return !g || g.some((x) => excluded.includes(x));
  }

  /** Acordă recompensele (o singură dată pe `key` și membru); întoarce `false` dacă regula se declanșase deja. */
  async fire(rule: Pick<V2Rule, "id" | "rew">, actorId: string, otherId: string | null, key: string, ref: string | null): Promise<boolean> {
    const { db } = this.deps;
    const granted = await db.$transaction(async (tx) => {
      const out: Granted[] = [];
      const one = await this.grant(tx, rule.id, actorId, rule.rew.actor, key, ref);
      if (!one) return null;
      out.push(one);
      if (otherId && rule.rew.other) {
        const two = await this.grant(tx, rule.id, otherId, rule.rew.other, `${key}:other:${actorId}:${ref ?? ""}`, ref);
        if (two) out.push(two);
      }
      return out;
    });
    if (!granted) return false;
    await this.after(granted);
    return true;
  }

  private async grant(tx: Prisma.TransactionClient, ruleId: number, userId: string, reward: GcsRuleReward, key: string, ref: string | null): Promise<Granted | null> {
    const { count } = await tx.achievementLog.createMany({ data: [{ userId, ruleId, points: reward.points, uniqueKey: key, contentRef: ref }], skipDuplicates: true });
    if (count === 0) return null;
    let points = reward.points;
    let badgeId: number | null = null;
    if (reward.badgeId !== null) {
      const badge = await tx.badge.findUnique({ where: { id: reward.badgeId }, select: { id: true, points: true } });
      if (badge) {
        const created = await tx.userBadge.createMany({ data: [{ userId, badgeId: badge.id, reason: `rule:${ruleId}` }], skipDuplicates: true });
        if (created.count > 0) {
          points += badge.points;
          badgeId = badge.id;
        }
      }
    }
    if (points !== 0) await tx.user.update({ where: { id: userId }, data: { points: { increment: points } } });
    const groups: number[] = [];
    if (reward.groupId !== null && (await tx.group.findUnique({ where: { id: reward.groupId }, select: { id: true } }))) {
      const expiresAt = reward.groupDays === null ? null : new Date(Date.now() + reward.groupDays * 86_400_000);
      const existing = await tx.userGroup.findUnique({ where: { userId_groupId: { userId, groupId: reward.groupId } } });
      if (!existing) {
        if (await this.deps.membership.addSecondary(tx, userId, reward.groupId, { source: RULE_SOURCE, expiresAt })) groups.push(reward.groupId);
      } else if (existing.expiresAt !== null && (expiresAt === null || expiresAt > existing.expiresAt)) {
        // Un grup temporar primit din nou se prelungește (sau devine permanent).
        await tx.userGroup.update({ where: { userId_groupId: { userId, groupId: reward.groupId } }, data: { expiresAt } });
        groups.push(reward.groupId);
      }
    }
    if (reward.nameStyleId !== null && (await tx.nameStyle.findUnique({ where: { id: reward.nameStyleId }, select: { id: true } }))) {
      await tx.user.update({ where: { id: userId }, data: { nameStyleId: reward.nameStyleId } });
    }
    const vip = reward.vipGroupId !== null && reward.vipDays !== null ? { groupId: reward.vipGroupId, days: reward.vipDays } : null;
    return { userId, badgeId, points, groups, vip };
  }

  private async after(granted: Granted[]): Promise<void> {
    const { bus } = this.deps;
    for (const g of granted) {
      if (g.badgeId !== null) await bus.emit({ name: "badge.awarded", payload: { userId: g.userId, badgeId: g.badgeId, byRule: true }, tags: [`user:${g.userId}`] });
      if (g.points !== 0) await bus.emit({ name: "points.changed", payload: { userId: g.userId, delta: g.points }, tags: [`user:${g.userId}`] });
      if (g.groups.length > 0) await this.deps.membership.notify(g.userId, g.groups);
      if (g.vip && this.deps.grantVip) await this.deps.grantVip(g.userId, g.vip.groupId, g.vip.days).catch((error: unknown) => console.error("[gcs] zilele VIP din regulă au eșuat", error));
      await this.deps.schedule?.(g.userId);
    }
  }

  // ─── Recalcularea (jobul din worker) ─────────────────────────────────────

  async recalcStatus(): Promise<GcsRecalcStatus> {
    const row = await this.deps.db.setting.findUnique({ where: { key: RECALC_STATUS } });
    const v = (row?.value ?? null) as Partial<GcsRecalcStatus> | null;
    return { state: v?.state ?? "idle", done: v?.done ?? 0, total: v?.total ?? 0, awarded: v?.awarded ?? 0, startedAt: v?.startedAt ?? null, finishedAt: v?.finishedAt ?? null };
  }

  private async writeStatus(s: GcsRecalcStatus): Promise<void> {
    const value = s as unknown as Prisma.InputJsonValue;
    await this.deps.db.setting.upsert({ where: { key: RECALC_STATUS }, create: { key: RECALC_STATUS, value }, update: { value } });
  }

  /** Pornește recalcularea în worker (sau pe loc, fără coadă). */
  async requestRecalc(): Promise<GcsRecalcStatus> {
    const status: GcsRecalcStatus = { state: "queued", done: 0, total: await this.deps.db.user.count(), awarded: 0, startedAt: new Date().toISOString(), finishedAt: null };
    await this.writeStatus(status);
    if (this.deps.jobs) await this.deps.jobs.enqueue(RECALC_JOB, {}, { jobId: `recalc-${Date.now()}` });
    else await this.recalculate();
    return this.recalcStatus();
  }

  /**
   * Recalcularea în fundal: fiecare membru, pe fiecare regulă cu o valoare citibilă (`current`). Evenimentele „valoare”
   * se acordă la prag; cele numărate, „a n-a oară” fără fereastră, după totalul de acum. „La fiecare n” și regulile
   * cu fereastră rămân live (istoricul aparițiilor nu se reconstruiește). Progresul se scrie la fiecare lot.
   * `evaluateLegacy` = regulile cu prag (puncte, postări…) și rangul.
   */
  async recalculate(evaluateLegacy?: (userId: string) => Promise<void>): Promise<number> {
    const { db } = this.deps;
    const events = await this.availableEvents();
    const rules: V2Rule[] = [];
    for (const { def } of events) {
      if (!def.current) continue;
      for (const r of await this.rulesFor(def.key, def)) if (def.kind === "value" || (r.cond.mode === "nth" && r.cond.windowDays === null)) rules.push(r);
    }
    const excluded = await this.excludedGroups();
    const status: GcsRecalcStatus = { state: "running", done: 0, total: await db.user.count(), awarded: 0, startedAt: new Date().toISOString(), finishedAt: null };
    await this.writeStatus(status);
    let cursor: string | undefined;
    for (;;) {
      const users = await db.user.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" }, select: { id: true, primaryGroupId: true, groups: { select: { groupId: true } } } });
      if (users.length === 0) break;
      for (const u of users) {
        const groups = [u.primaryGroupId, ...u.groups.map((g) => g.groupId)];
        if (!groups.some((g) => excluded.includes(g))) {
          for (const r of rules) {
            if (r.cond.groupIds.length > 0 && !groups.some((g) => r.cond.groupIds.includes(g))) continue;
            const value = await r.def.current!({ db }, u.id, { forumIds: r.cond.forumIds, serverIds: r.cond.serverIds });
            if (value >= r.cond.n && (await this.fire(r, u.id, null, `v2:${r.id}`, null))) status.awarded++;
          }
        }
        await evaluateLegacy?.(u.id);
      }
      status.done += users.length;
      cursor = users[users.length - 1]!.id;
      await this.writeStatus(status);
    }
    await this.writeStatus({ ...status, state: "done", finishedAt: new Date().toISOString(), total: Math.max(status.total, status.done) });
    return status.awarded;
  }

  /**
   * Evenimentele „valoare” ale unui membru (ex. ELO-ul, orele jucate): citite acum și verificate pe regulile lor. Rulat
   * din evaluarea membrului și din sweep-ul jucătorilor activi.
   */
  async evaluateValues(userId: string, modules?: string[]): Promise<number> {
    let fired = 0;
    for (const { module, def } of await this.availableEvents()) {
      if (def.kind !== "value" || !def.current || (modules && !modules.includes(module))) continue;
      if ((await this.deps.db.achievementRule.count({ where: { trigger: "EVENT", event: def.key, enabled: true } })) === 0) continue;
      fired += await this.handle(def.key, { userId, ref: "value" });
    }
    return fired;
  }

  /**
   * Jobul zilnic: vechimea (regulile `core.member_days`, membrii ajunși la prag fără acordare) și ziua de naștere
   * (o apariție pe an, pentru membrii născuți azi).
   */
  async dailySweep(now = new Date()): Promise<number> {
    const { db } = this.deps;
    let fired = 0;
    const on = await this.availableEvents();
    if (on.some((e) => e.def.key === "core.member_days")) {
      const rules = await db.achievementRule.findMany({ where: { trigger: "EVENT", event: "core.member_days", enabled: true } });
      for (const rule of rules) {
        const n = normalizeConditions(rule.conditions, "value").n;
        const users = await db.user.findMany({ where: { createdAt: { lte: new Date(now.getTime() - n * 86_400_000) }, achievementLog: { none: { uniqueKey: `v2:${rule.id}` } } }, select: { id: true }, take: 5000 });
        for (const u of users) fired += await this.handle("core.member_days", { userId: u.id, ref: "value" }, now);
      }
    }
    if (on.some((e) => e.def.key === "core.birthday") && (await db.achievementRule.count({ where: { trigger: "EVENT", event: "core.birthday", enabled: true } })) > 0) {
      const born = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE birthday IS NOT NULL
          AND EXTRACT(MONTH FROM birthday) = ${now.getUTCMonth() + 1} AND EXTRACT(DAY FROM birthday) = ${now.getUTCDate()}`;
      for (const u of born) fired += await this.handle("core.birthday", { userId: u.id, ref: `birthday:${now.getUTCFullYear()}` }, now);
    }
    return fired;
  }

  /** Sweep-ul jucătorilor activi (la 10 minute): valorile de pe servere (ucideri, ore, ELO) pentru cine a jucat recent. */
  async gameSweep(now = new Date()): Promise<number> {
    const { db } = this.deps;
    if (!(await this.availableEvents()).some((e) => e.module === "servers")) return 0;
    if ((await db.achievementRule.count({ where: { trigger: "EVENT", event: { startsWith: "servers." }, enabled: true } })) === 0) return 0;
    const players = await db.gamePlayer.findMany({ where: { userId: { not: null }, lastSeenAt: { gte: new Date(now.getTime() - 15 * 60_000) } }, select: { userId: true }, distinct: ["userId"], take: 2000 });
    let fired = 0;
    for (const p of players) fired += await this.evaluateValues(p.userId!, ["servers"]);
    return fired;
  }

  registerJobs(jobs: GcsJobQueue, evaluateLegacy?: (userId: string) => Promise<void>): void {
    jobs.register({ name: RECALC_JOB, handler: async () => void (await this.recalculate(evaluateLegacy)) });
    jobs.register({ name: GAME_SWEEP_JOB, pattern: "*/10 * * * *", handler: async () => void (await this.gameSweep()) });
  }

  // ─── „Câștigătorul zilei” (perioade) ─────────────────────────────────────

  /**
   * Insignele pe perioadă (ex. „Câștigătorul zilei” din clasamente): badge-ul după cheie, o singură dată pe perioadă
   * (`period`, ex. `day:2026-10-16`). Prima dată se acordă ca de obicei; apoi badge-ul își crește numărul de câștiguri
   * și urcă din nou în „Ultimele realizări”. Apoi evenimentul `achievements.period_winner` (reguli pe câștiguri).
   */
  async grantPeriodWinner(input: { userId: string; badgeKey: string; period: string; reason?: string; source?: string }): Promise<{ granted: boolean; wins: number }> {
    const { db, bus } = this.deps;
    const badge = await db.badge.findUnique({ where: { key: input.badgeKey } });
    if (!badge || !/^[a-z0-9_:.-]{1,60}$/i.test(input.period)) return { granted: false, wins: 0 };
    const result = await db.$transaction(async (tx) => {
      const { count } = await tx.achievementLog.createMany({ data: [{ userId: input.userId, points: badge.points, uniqueKey: `period:${badge.key}:${input.period}`, contentRef: input.source ?? null }], skipDuplicates: true });
      if (count === 0) return null;
      const now = new Date();
      const created = await tx.userBadge.createMany({ data: [{ userId: input.userId, badgeId: badge.id, reason: (input.reason ?? input.period).slice(0, 200), lastAwardedAt: now }], skipDuplicates: true });
      const row = created.count > 0 ? null : await tx.userBadge.update({ where: { userId_badgeId: { userId: input.userId, badgeId: badge.id } }, data: { timesAwarded: { increment: 1 }, lastAwardedAt: now } });
      if (badge.points !== 0) await tx.user.update({ where: { id: input.userId }, data: { points: { increment: badge.points } } });
      return { wins: row?.timesAwarded ?? 1 };
    });
    if (!result) return { granted: false, wins: (await db.userBadge.findUnique({ where: { userId_badgeId: { userId: input.userId, badgeId: badge.id } } }))?.timesAwarded ?? 0 };
    await bus.emit({ name: "badge.awarded", payload: { userId: input.userId, badgeId: badge.id, byRule: true, period: input.period, wins: result.wins }, tags: [`user:${input.userId}`] });
    await bus.emit({ name: "achievements.period_winner", payload: { userId: input.userId, badgeKey: badge.key, period: input.period, source: input.source ?? null, wins: result.wins }, tags: [`user:${input.userId}`] });
    await this.deps.schedule?.(input.userId);
    return { granted: true, wins: result.wins };
  }

  // ─── Widget-ul „Ultimele realizări” ──────────────────────────────────────

  /** Badge-urile rare: deținute de cel mult `rare_percent` % dintre membri. */
  async rareBadgeIds(): Promise<Set<number>> {
    const { db } = this.deps;
    const percent = Number((await this.deps.setting?.<number>(SETTING_RARE_PERCENT).catch(() => 5)) ?? 5);
    const [members, counts] = await Promise.all([db.user.count(), db.userBadge.groupBy({ by: ["badgeId"], _count: { _all: true } })]);
    const max = Math.max(1, (members * percent) / 100);
    return new Set(counts.filter((c) => c._count._all <= max).map((c) => c.badgeId));
  }

  async recent(opts: { limit: number; rareOnly?: boolean; groupId?: number | null }) {
    const { db } = this.deps;
    const rare = opts.rareOnly ? await this.rareBadgeIds() : null;
    const rows = await db.userBadge.findMany({
      where: {
        ...(rare ? { badgeId: { in: [...rare] } } : {}),
        ...(opts.groupId ? { user: { OR: [{ primaryGroupId: opts.groupId }, { groups: { some: { groupId: opts.groupId } } }] } } : {}),
      },
      orderBy: [{ lastAwardedAt: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(20, opts.limit)),
      select: {
        id: true,
        lastAwardedAt: true,
        timesAwarded: true,
        user: { select: { id: true, name: true } },
        badge: { select: { id: true, key: true, name: true, description: true, color: true, symbol: true, manual: true, artShape: true, artTier: true, artIcon: true, imageAttachmentId: true } },
      },
    });
    return rows;
  }
}

/** Un actor de sistem (grupul Root Admin) pentru acordările făcute de reguli (zilele VIP). */
export async function systemActor(db: PrismaClient): Promise<GcsActor> {
  const root = await db.group.findUnique({ where: { key: "root_admin" }, select: { id: true } });
  return { userId: null, groupIds: root ? [root.id] : [], primaryGroupId: root?.id ?? 0, isBanned: false, ip: "system" };
}
