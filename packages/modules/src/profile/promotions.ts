import { GcsNotFound, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsEventBus } from "@gcs/core";
import { type GroupPromotion, type PrismaClient, jsonInts } from "@gcs/db";
import type { GcsMembership } from "./membership";

export const PROMOTIONS_ACP_SECTION = "members.promotions";
/** Grupurile din care nu se promovează niciodată automat (staff, banat, vizitator). */
const NEVER_PROMOTED = new Set(["root_admin", "admin", "super_moderator", "moderator", "banned", "guest"]);
/** Promovările se pot înlănțui (Membru → Activ → Veteran); limităm numărul de pași pe evaluare. */
const MAX_STEPS = 5;

export type GcsPromotionInput = {
  name: string;
  fromGroupIds: number[];
  toGroupId: number;
  asPrimary: boolean;
  minPosts: number | null;
  minDays: number | null;
  minReputation: number | null;
  minPoints: number | null;
  enabled: boolean;
};

/**
 * Promovările automate de grup (spec §6.1, specul etapei 3 §9): „din grupurile X, cu toate pragurile atinse → grupul G”.
 * Evaluate de worker după activitate și zilnic (pentru vechime). Promovarea Membru nou → Membru din etapa 2 rămâne pe loc.
 */
export class GcsPromotionService {
  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; acp: GcsAcpRoleService; membership: GcsMembership }) {}

  async list(): Promise<(Omit<GroupPromotion, "fromGroupIds"> & { fromGroupIds: number[] })[]> {
    const rows = await this.deps.db.groupPromotion.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    return rows.map((r) => ({ ...r, fromGroupIds: jsonInts(r.fromGroupIds) }));
  }

  /** Aplică promovările potrivite unui user (cel mult `MAX_STEPS` în lanț). Întoarce câte s-au aplicat. */
  async evaluateUser(userId: string, now = new Date()): Promise<number> {
    let applied = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (!(await this.applyFirst(userId, now))) break;
      applied++;
    }
    return applied;
  }

  private async applyFirst(userId: string, now: Date): Promise<boolean> {
    const { db, bus, membership } = this.deps;
    const rules = (await this.list()).filter((r) => r.enabled);
    if (rules.length === 0) return false;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        primaryGroupId: true,
        previousPrimaryGroupId: true,
        postsCount: true,
        reputation: true,
        points: true,
        createdAt: true,
        primaryGroup: { select: { key: true, isVip: true } },
        groups: { select: { groupId: true } },
        vipSubscriptions: { where: { status: "ACTIVE", madePrimary: true }, select: { id: true } },
      },
    });
    if (!user || NEVER_PROMOTED.has(user.primaryGroup.key)) return false;
    const activeBan = await db.ban.count({
      where: { userId, liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    if (activeBan > 0) return false;

    // Cu VIP activ ca grup principal, „grupul de bază” e cel la care revine la expirare.
    const vipPrimary = user.vipSubscriptions.length > 0 && user.primaryGroup.isVip;
    const baseGroupId = vipPrimary ? (user.previousPrimaryGroupId ?? user.primaryGroupId) : user.primaryGroupId;
    const groups = new Set([baseGroupId, user.primaryGroupId, ...user.groups.map((g) => g.groupId)]);
    const days = Math.floor((now.getTime() - user.createdAt.getTime()) / 86_400_000);
    const ok = (min: number | null, value: number) => min === null || value >= min;

    const rule = rules.find(
      (r) =>
        r.fromGroupIds.some((id) => groups.has(id)) &&
        !(r.asPrimary ? baseGroupId === r.toGroupId : groups.has(r.toGroupId)) &&
        ok(r.minPosts, user.postsCount) &&
        ok(r.minDays, days) &&
        ok(r.minReputation, user.reputation) &&
        ok(r.minPoints, user.points),
    );
    if (!rule) return false;

    const changedGroups = await db.$transaction(async (tx) => {
      if (!rule.asPrimary) {
        return (await membership.addSecondary(tx, userId, rule.toGroupId, { source: "promotion" })) ? [rule.toGroupId] : [];
      }
      if (vipPrimary) {
        // Rămâne VIP; la expirare revine la grupul promovat.
        await tx.user.update({ where: { id: userId }, data: { previousPrimaryGroupId: rule.toGroupId } });
        await tx.userGroup.deleteMany({ where: { userId, groupId: rule.toGroupId } });
        return [rule.toGroupId];
      }
      const old = await membership.setPrimary(tx, userId, rule.toGroupId, { savePrevious: true });
      return old === null ? [] : [old, rule.toGroupId];
    });
    if (changedGroups.length === 0) return false;
    await writeAudit(db, {
      actorId: null,
      action: "group.promoted",
      targetType: "user",
      targetId: userId,
      before: { primaryGroupId: user.primaryGroupId },
      after: { ruleId: rule.id, toGroupId: rule.toGroupId, asPrimary: rule.asPrimary },
    });
    await membership.notify(userId, changedGroups);
    await bus.emit({ name: "group.promoted", payload: { userId, ruleId: rule.id, toGroupId: rule.toGroupId }, tags: [`user:${userId}`] });
    return true;
  }

  /** Zilnic: membrii care au atins vechimea unei reguli cu `minDays` (fără activitate nu ar fi evaluați altfel). */
  async dailySweep(now = new Date()): Promise<number> {
    const { db } = this.deps;
    const rules = (await this.list()).filter((r) => r.enabled && r.minDays !== null);
    const due = new Set<string>();
    for (const rule of rules) {
      const users = await db.user.findMany({
        where: {
          createdAt: { lte: new Date(now.getTime() - rule.minDays! * 86_400_000) },
          OR: [{ primaryGroupId: { in: rule.fromGroupIds } }, { groups: { some: { groupId: { in: rule.fromGroupIds } } } }, { previousPrimaryGroupId: { in: rule.fromGroupIds } }],
        },
        select: { id: true },
      });
      for (const u of users) due.add(u.id);
    }
    let applied = 0;
    for (const userId of due) applied += await this.evaluateUser(userId, now);
    return applied;
  }

  // ─── ACP ─────────────────────────────────────────────────────────────────

  private async validate(input: GcsPromotionInput): Promise<void> {
    const errors: Record<string, string> = {};
    const name = input.name.trim();
    if (name.length < 1 || name.length > 80) errors.name = "required";
    if (input.fromGroupIds.length === 0) errors.fromGroupIds = "required";
    if (input.fromGroupIds.includes(input.toGroupId)) errors.toGroupId = "same_group";
    for (const [k, v] of Object.entries({ minPosts: input.minPosts, minDays: input.minDays, minReputation: input.minReputation, minPoints: input.minPoints })) {
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > 10_000_000)) errors[k] = "invalid_range";
    }
    if ([input.minPosts, input.minDays, input.minReputation, input.minPoints].every((v) => v === null)) errors.minPosts = "one_required";
    const groups = await this.deps.db.group.findMany({ where: { id: { in: [...input.fromGroupIds, input.toGroupId] } }, select: { id: true, key: true } });
    const keys = new Map(groups.map((g) => [g.id, g.key]));
    if (!keys.has(input.toGroupId) || NEVER_PROMOTED.has(keys.get(input.toGroupId)!)) errors.toGroupId = "invalid_choice";
    if (input.fromGroupIds.some((id) => !keys.has(id))) errors.fromGroupIds = "invalid_choice";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
  }

  async save(actor: GcsActor, id: number | null, input: GcsPromotionInput): Promise<GroupPromotion> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, PROMOTIONS_ACP_SECTION, "edit");
    await this.validate(input);
    const data = { ...input, name: input.name.trim(), fromGroupIds: [...new Set(input.fromGroupIds)] };
    const row = await db.$transaction(async (tx) => {
      const before = id === null ? null : await tx.groupPromotion.findUnique({ where: { id } });
      if (id !== null && !before) throw new GcsNotFound();
      const saved =
        id === null
          ? await tx.groupPromotion.create({ data: { ...data, position: await tx.groupPromotion.count() } })
          : await tx.groupPromotion.update({ where: { id }, data });
      await writeAudit(tx, { actorId: actor.userId, action: id === null ? "promotion.create" : "promotion.update", targetType: "promotion", targetId: String(saved.id), before, after: saved, ip: actor.ip });
      return saved;
    });
    await bus.emit({ name: "promotions.updated", payload: { id: row.id }, tags: ["promotions"] });
    return row;
  }

  async delete(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, PROMOTIONS_ACP_SECTION, "delete");
    await db.$transaction(async (tx) => {
      const before = await tx.groupPromotion.findUnique({ where: { id } });
      if (!before) throw new GcsNotFound();
      await tx.groupPromotion.delete({ where: { id } });
      await writeAudit(tx, { actorId: actor.userId, action: "promotion.delete", targetType: "promotion", targetId: String(id), before, ip: actor.ip });
    });
    await bus.emit({ name: "promotions.updated", payload: { id }, tags: ["promotions"] });
  }
}
