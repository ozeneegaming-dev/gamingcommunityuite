import { GcsForbidden, GcsNotFound, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsEventBus, type GcsJobQueue, type GcsSettingsService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { FORUMS_ACP_SECTION } from "./forums";
import type { GcsForumPosting } from "./posting";

/** Secțiunea ACP a arhivării automate (ACP → Comunitate → Forumuri → Arhivare). */
export const ARCHIVE_ACP_SECTION = FORUMS_ACP_SECTION;
export const ARCHIVE_JOB = "forums.archive";
export const AUTO_CLOSE_JOB = "forums.auto_close";

/** Un filtru cu trei stări: oricum, doar da, doar nu. */
export type GcsTriState = "any" | "yes" | "no";
const TRI: readonly GcsTriState[] = ["any", "yes", "no"];

/**
 * Condițiile unei reguli de arhivare (toate trebuie îndeplinite): ultima postare mai veche de N zile, în forumurile
 * alese (gol = toate), fixat / blocat / ascuns / cu sondaj, mai puțin de N răspunsuri / vizualizări, nota sub N,
 * pornit de anumiți membri.
 */
export type GcsArchiveConditions = {
  lastPostDays: number;
  forumIds: number[];
  pinned: GcsTriState;
  locked: GcsTriState;
  hidden: GcsTriState;
  poll: GcsTriState;
  repliesBelow: number | null;
  viewsBelow: number | null;
  ratingBelow: number | null;
  starterIds: string[];
};

/** „Dar nu când”: excepțiile (oricare scoate topicul din arhivare). */
export type GcsArchiveExclusions = {
  forumIds: number[];
  pinned: boolean;
  locked: boolean;
  poll: boolean;
  repliesAtLeast: number | null;
  viewsAtLeast: number | null;
  ratingAtLeast: number | null;
  starterIds: string[];
};

export type GcsArchiveRuleInput = { id?: number; name: string; enabled: boolean; conditions: GcsArchiveConditions; exclusions: GcsArchiveExclusions };
export type GcsArchiveRuleView = GcsArchiveRuleInput & { id: number; lastRunAt: string | null; lastCount: number };

const BATCH = 500;

const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const ids = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is number => Number.isSafeInteger(x) && x > 0))].slice(0, 200) : []);
const userIds = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x)))].slice(0, 100) : []);
const tri = (v: unknown): GcsTriState => (TRI.includes(v as GcsTriState) ? (v as GcsTriState) : "any");

/** Condițiile salvate / trimise, normalizate (valorile lipsă sau greșite devin cele implicite). */
export function normalizeArchiveConditions(raw: unknown): GcsArchiveConditions {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    lastPostDays: int(r.lastPostDays, 1, 36_500) ?? 365,
    forumIds: ids(r.forumIds),
    pinned: tri(r.pinned),
    locked: tri(r.locked),
    hidden: tri(r.hidden),
    poll: tri(r.poll),
    repliesBelow: int(r.repliesBelow, 1, 10_000_000),
    viewsBelow: int(r.viewsBelow, 1, 1_000_000_000),
    ratingBelow: typeof r.ratingBelow === "number" && r.ratingBelow > 0 && r.ratingBelow <= 5 ? r.ratingBelow : null,
    starterIds: userIds(r.starterIds),
  };
}

export function normalizeExclusions(raw: unknown): GcsArchiveExclusions {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    forumIds: ids(r.forumIds),
    pinned: r.pinned === true,
    locked: r.locked === true,
    poll: r.poll === true,
    repliesAtLeast: int(r.repliesAtLeast, 1, 10_000_000),
    viewsAtLeast: int(r.viewsAtLeast, 1, 1_000_000_000),
    ratingAtLeast: typeof r.ratingAtLeast === "number" && r.ratingAtLeast > 0 && r.ratingAtLeast <= 5 ? r.ratingAtLeast : null,
    starterIds: userIds(r.starterIds),
  };
}

const triWhere = (state: GcsTriState, yes: Prisma.TopicWhereInput, no: Prisma.TopicWhereInput): Prisma.TopicWhereInput[] => (state === "yes" ? [yes] : state === "no" ? [no] : []);

/**
 * Topicurile pe care le arhivează o regulă (pur, testat): neahivate, cu ultima postare mai veche de N zile, plus
 * condițiile, minus excepțiile.
 */
export function archiveWhere(c: GcsArchiveConditions, x: GcsArchiveExclusions, now: Date): Prisma.TopicWhereInput {
  const and: Prisma.TopicWhereInput[] = [{ archivedAt: null }, { lastPostAt: { lt: new Date(now.getTime() - c.lastPostDays * 86_400_000) } }];
  if (c.forumIds.length > 0) and.push({ forumId: { in: c.forumIds } });
  and.push(...triWhere(c.pinned, { pinned: true }, { pinned: false }));
  and.push(...triWhere(c.locked, { locked: true }, { locked: false }));
  and.push(...triWhere(c.hidden, { visibility: "HIDDEN" }, { visibility: { not: "HIDDEN" } }));
  and.push(...triWhere(c.poll, { poll: { isNot: null } }, { poll: { is: null } }));
  if (c.repliesBelow !== null) and.push({ repliesCount: { lt: c.repliesBelow } });
  if (c.viewsBelow !== null) and.push({ viewsCount: { lt: c.viewsBelow } });
  if (c.ratingBelow !== null) and.push({ ratingAvg: { lt: c.ratingBelow } });
  if (c.starterIds.length > 0) and.push({ authorId: { in: c.starterIds } });

  const not: Prisma.TopicWhereInput[] = [];
  if (x.forumIds.length > 0) not.push({ forumId: { in: x.forumIds } });
  if (x.pinned) not.push({ pinned: true });
  if (x.locked) not.push({ locked: true });
  if (x.poll) not.push({ poll: { isNot: null } });
  if (x.repliesAtLeast !== null) not.push({ repliesCount: { gte: x.repliesAtLeast } });
  if (x.viewsAtLeast !== null) not.push({ viewsCount: { gte: x.viewsAtLeast } });
  if (x.ratingAtLeast !== null) not.push({ ratingAvg: { gte: x.ratingAtLeast } });
  if (x.starterIds.length > 0) not.push({ authorId: { in: x.starterIds } });
  return not.length > 0 ? { AND: and, NOT: not } : { AND: and };
}

/**
 * Arhivarea (Forum v2): regulile automate din ACP (rulate de `gcs-worker`, cu comutatorul `forums.archive_enabled`),
 * arhivarea și restaurarea manuală de către moderatori, și închiderea automată după N zile (opțiunea forumului).
 * Un topic arhivat rămâne în listă, doar de citit (fără răspunsuri, editări, voturi); se poate restaura oricând.
 */
export class GcsArchiveService {
  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; acp: GcsAcpRoleService; settings: GcsSettingsService; posting: GcsForumPosting }) {}

  async list(actor: GcsActor): Promise<GcsArchiveRuleView[]> {
    await this.deps.acp.assert(actor, ARCHIVE_ACP_SECTION, "view");
    const rows = await this.deps.db.archiveRule.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      conditions: normalizeArchiveConditions(r.conditions),
      exclusions: normalizeExclusions(r.exclusions),
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      lastCount: r.lastCount,
    }));
  }

  private validate(input: GcsArchiveRuleInput): { name: string; conditions: GcsArchiveConditions; exclusions: GcsArchiveExclusions } {
    const name = input.name.trim();
    if (!name || name.length > 80) throw new GcsValidationError({ name: name ? "too_long" : "required" });
    return { name, conditions: normalizeArchiveConditions(input.conditions), exclusions: normalizeExclusions(input.exclusions) };
  }

  /** Câte topicuri ar arhiva acum regula (previzualizarea din ACP). */
  async preview(actor: GcsActor, input: GcsArchiveRuleInput, now = new Date()): Promise<number> {
    await this.deps.acp.assert(actor, ARCHIVE_ACP_SECTION, "view");
    const v = this.validate(input);
    return this.deps.db.topic.count({ where: archiveWhere(v.conditions, v.exclusions, now) });
  }

  async save(actor: GcsActor, input: GcsArchiveRuleInput): Promise<number> {
    await this.deps.acp.assert(actor, ARCHIVE_ACP_SECTION, "edit");
    const v = this.validate(input);
    const data = { name: v.name, enabled: input.enabled, conditions: v.conditions as unknown as Prisma.InputJsonValue, exclusions: v.exclusions as unknown as Prisma.InputJsonValue };
    return this.deps.db.$transaction(async (tx) => {
      if (input.id !== undefined && !(await tx.archiveRule.findUnique({ where: { id: input.id }, select: { id: true } }))) throw new GcsNotFound();
      const row = input.id !== undefined ? await tx.archiveRule.update({ where: { id: input.id }, data }) : await tx.archiveRule.create({ data });
      await writeAudit(tx, { actorId: actor.userId, action: input.id !== undefined ? "forum.archive_rule.update" : "forum.archive_rule.create", targetType: "archive_rule", targetId: String(row.id), after: data, ip: actor.ip });
      return row.id;
    });
  }

  async delete(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, ARCHIVE_ACP_SECTION, "delete");
    await this.deps.db.$transaction(async (tx) => {
      const row = await tx.archiveRule.findUnique({ where: { id } });
      if (!row) throw new GcsNotFound();
      await tx.archiveRule.delete({ where: { id } });
      await writeAudit(tx, { actorId: actor.userId, action: "forum.archive_rule.delete", targetType: "archive_rule", targetId: String(id), before: row, ip: actor.ip });
    });
  }

  /** Rulează regulile pornite (jobul `forums.archive`); întoarce câte topicuri a arhivat fiecare regulă. */
  async run(now = new Date(), opts: { force?: boolean; ruleId?: number } = {}): Promise<Record<number, number>> {
    const { db } = this.deps;
    if (!opts.force && !(await this.deps.settings.get<boolean>("forums.archive_enabled"))) return {};
    const rules = await db.archiveRule.findMany({ where: { enabled: true, ...(opts.ruleId ? { id: opts.ruleId } : {}) }, orderBy: [{ position: "asc" }, { id: "asc" }] });
    const out: Record<number, number> = {};
    const touched = new Set<number>();
    const forums = new Set<number>();
    for (const rule of rules) {
      const where = archiveWhere(normalizeArchiveConditions(rule.conditions), normalizeExclusions(rule.exclusions), now);
      let count = 0;
      for (;;) {
        const batch = await db.topic.findMany({ where, select: { id: true, forumId: true }, take: BATCH });
        if (batch.length === 0) break;
        await db.topic.updateMany({ where: { id: { in: batch.map((t) => t.id) } }, data: { archivedAt: now, archivedById: null } });
        for (const t of batch) {
          touched.add(t.id);
          forums.add(t.forumId);
        }
        count += batch.length;
        if (batch.length < BATCH) break;
      }
      await db.archiveRule.update({ where: { id: rule.id }, data: { lastRunAt: now, lastCount: count } });
      if (count > 0) await writeAudit(db, { actorId: null, action: "forum.archive.auto", targetType: "archive_rule", targetId: String(rule.id), after: { count }, ip: null });
      out[rule.id] = count;
    }
    if (touched.size > 0) await this.changed([...touched], forums);
    return out;
  }

  /** Arhivarea sau restaurarea manuală (moderatorii cu puterea `lock` pe forumul fiecărui topic). */
  async setArchived(actor: GcsActor, topicIds: number[], archived: boolean): Promise<void> {
    const { db } = this.deps;
    const list = [...new Set(topicIds)];
    const topics = await db.topic.findMany({ where: { id: { in: list } }, select: { id: true, forumId: true, archivedAt: true } });
    if (topics.length !== list.length || list.length === 0) throw new GcsNotFound();
    for (const forumId of new Set(topics.map((t) => t.forumId))) {
      if (!(await this.deps.posting.isModerator(actor, "lock", forumId))) throw new GcsForbidden({ power: "lock" });
    }
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.topic.updateMany({ where: { id: { in: list } }, data: archived ? { archivedAt: now, archivedById: actor.userId } : { archivedAt: null, archivedById: null } });
      for (const t of topics) {
        await writeAudit(tx, { actorId: actor.userId, action: archived ? "mod.topic.archive" : "mod.topic.unarchive", targetType: "topic", targetId: String(t.id), before: { archivedAt: t.archivedAt }, after: { archived }, ip: actor.ip });
      }
    });
    await this.changed(list, new Set(topics.map((t) => t.forumId)));
  }

  /** Închiderea automată (opțiunea forumului „după N zile fără răspuns”): blochează topicurile vechi (jobul zilnic). */
  async autoClose(now = new Date()): Promise<number> {
    const { db } = this.deps;
    const forums = await db.forum.findMany({ where: { autoCloseDays: { gt: 0 } }, select: { id: true, autoCloseDays: true } });
    let total = 0;
    const touched: number[] = [];
    for (const f of forums) {
      const old = await db.topic.findMany({ where: { forumId: f.id, locked: false, archivedAt: null, pinned: false, lastPostAt: { lt: new Date(now.getTime() - f.autoCloseDays * 86_400_000) } }, select: { id: true }, take: 5000 });
      if (old.length === 0) continue;
      await db.topic.updateMany({ where: { id: { in: old.map((t) => t.id) } }, data: { locked: true } });
      await writeAudit(db, { actorId: null, action: "forum.auto_close", targetType: "forum", targetId: String(f.id), after: { count: old.length, days: f.autoCloseDays }, ip: null });
      total += old.length;
      touched.push(...old.map((t) => t.id));
    }
    if (touched.length > 0) await this.changed(touched, new Set(forums.map((f) => f.id)));
    return total;
  }

  registerJobs(jobs: GcsJobQueue): void {
    // Arhivarea automată: o rundă pe oră (regulile lucrează pe zile, deci ora e suficientă).
    jobs.register({ name: ARCHIVE_JOB, everyMs: 3600_000, handler: async () => void (await this.run()) });
    jobs.register({ name: AUTO_CLOSE_JOB, everyMs: 6 * 3600_000, handler: async () => void (await this.autoClose()) });
  }

  private async changed(topicIds: number[], forumIds: Iterable<number>): Promise<void> {
    await this.deps.bus.emit({
      name: "topic.moderated",
      payload: { topicIds: topicIds.slice(0, 1000) },
      tags: ["forums-tree", ...[...forumIds].map((id) => `forum:${id}`), ...topicIds.slice(0, 500).map((id) => `topic:${id}`)],
    });
  }
}
