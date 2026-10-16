import type { PrismaClient } from "@gcs/db";
import { writeAudit } from "../audit";
import { GcsConflict, GcsForbidden, GcsNotFound } from "../errors";
import type { GcsEventBus } from "../events";
import { staffGroupIds } from "../members/directory";
import type { GcsPermissionService } from "../permissions/service";
import type { GcsActor } from "../permissions/types";
import { optInBlocked } from "./service";

/** Un grup public (opt-in) văzut de un membru în Setări → Grupuri. */
export type GcsOptInGroup = {
  id: number;
  key: string;
  name: string;
  color: string | null;
  icon: string | null;
  title: string | null;
  /** Membrul e în grup (ca secundar). */
  joined: boolean;
  /** Membrul îl poate părăsi singur (s-a înscris singur); un grup dat de staff sau de o aplicație nu se părăsește de aici. */
  canLeave: boolean;
  /** E grupul principal al membrului (nu se poate înscrie / retrage). */
  primary: boolean;
};

/** Sursa unui grup secundar luat de membru singur. */
export const OPT_IN_SOURCE = "optin";

/**
 * Grupurile publice (Membri v2): un admin bifează „Membrii se pot înscrie singuri” pe un grup eligibil (nu staff, nu
 * VIP, nu un grup protejat), iar membrii intră / ies din Setări → Grupuri, ca grup secundar. Regulile:
 * - un vizitator sau un membru banat nu poate face nimic;
 * - grupul trebuie să fie public acum și tot eligibil (un grup devenit staff între timp nu mai primește membri);
 * - retragerea se poate doar dintr-un grup luat singur (sursa `optin`), nu dintr-unul dat de staff sau de magazin.
 */
export class GcsOptInGroups {
  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; permissions: GcsPermissionService }) {}

  async list(userId: string): Promise<GcsOptInGroup[]> {
    const { db } = this.deps;
    const [groups, user, staff] = await Promise.all([
      db.group.findMany({ where: { optIn: true }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, key: true, name: true, color: true, icon: true, title: true, isProtected: true, isVip: true } }),
      db.user.findUnique({ where: { id: userId }, select: { primaryGroupId: true, groups: { select: { groupId: true, source: true } } } }),
      staffGroupIds(db),
    ]);
    if (!user) return [];
    const mine = new Map(user.groups.map((g) => [g.groupId, g.source]));
    return groups
      .filter((g) => optInBlocked(g, staff) === null)
      .map(({ isProtected: _p, isVip: _v, ...g }) => ({
        ...g,
        joined: mine.has(g.id),
        canLeave: mine.get(g.id) === OPT_IN_SOURCE,
        primary: user.primaryGroupId === g.id,
      }));
  }

  private async eligible(actor: GcsActor, groupId: number) {
    if (!actor.userId || actor.isBanned) throw new GcsForbidden({ reason: "members_only" });
    const group = await this.deps.db.group.findUnique({ where: { id: groupId }, select: { id: true, optIn: true, isProtected: true, isVip: true } });
    if (!group) throw new GcsNotFound({ entity: "group" });
    if (!group.optIn || optInBlocked(group, await staffGroupIds(this.deps.db)) !== null) throw new GcsForbidden({ reason: "not_opt_in" });
    return { userId: actor.userId, group };
  }

  async join(actor: GcsActor, groupId: number): Promise<void> {
    const { userId } = await this.eligible(actor, groupId);
    const { db } = this.deps;
    await db.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { primaryGroupId: true } });
      if (user.primaryGroupId === groupId) throw new GcsConflict({ reason: "already_primary" });
      const { count } = await tx.userGroup.createMany({ data: [{ userId, groupId, source: OPT_IN_SOURCE, addedById: userId }], skipDuplicates: true });
      if (count === 0) throw new GcsConflict({ reason: "already_member" });
      await writeAudit(tx, { actorId: userId, action: "user.group_join", targetType: "user", targetId: userId, after: { groupId }, ip: actor.ip });
    });
    await this.changed(userId, groupId);
  }

  async leave(actor: GcsActor, groupId: number): Promise<void> {
    if (!actor.userId || actor.isBanned) throw new GcsForbidden({ reason: "members_only" });
    const userId = actor.userId;
    const { db } = this.deps;
    await db.$transaction(async (tx) => {
      const row = await tx.userGroup.findUnique({ where: { userId_groupId: { userId, groupId } }, select: { source: true } });
      if (!row) throw new GcsNotFound({ entity: "user_group" });
      if (row.source !== OPT_IN_SOURCE) throw new GcsForbidden({ reason: "assigned_group" });
      await tx.userGroup.delete({ where: { userId_groupId: { userId, groupId } } });
      await writeAudit(tx, { actorId: userId, action: "user.group_leave", targetType: "user", targetId: userId, before: { groupId }, ip: actor.ip });
    });
    await this.changed(userId, groupId);
  }

  private async changed(userId: string, groupId: number): Promise<void> {
    await this.deps.permissions.bumpVersion();
    await this.deps.bus.emit({ name: "group.updated", payload: { groupIds: [groupId] }, tags: [`group:${groupId}`, "name-styles", `user:${userId}`] });
    await this.deps.bus.emit({ name: "user.groups_changed", payload: { userId }, tags: [`user:${userId}`] });
  }
}
