import type { GcsEventBus, GcsPermissionService } from "@gcs/core";
import type { Prisma } from "@gcs/db";

type Tx = Prisma.TransactionClient;

/**
 * Schimbările de grup făcute de sistem (promovări, VIP), fără verificarea drepturilor ACP.
 * Operațiile rulează în tranzacția apelantului; `notify` se apelează după commit.
 */
export class GcsMembership {
  constructor(private readonly deps: { bus: GcsEventBus; permissions: GcsPermissionService }) {}

  /** Grupul principal devine `groupId`; cel vechi se păstrează în `previousPrimaryGroupId` dacă `savePrevious`. */
  async setPrimary(tx: Tx, userId: string, groupId: number, opts: { savePrevious: boolean }): Promise<number | null> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { primaryGroupId: true } });
    if (!user || user.primaryGroupId === groupId) return null;
    await tx.user.update({
      where: { id: userId },
      data: { primaryGroupId: groupId, ...(opts.savePrevious ? { previousPrimaryGroupId: user.primaryGroupId } : {}) },
    });
    // Un grup nu e în același timp principal și secundar.
    await tx.userGroup.deleteMany({ where: { userId, groupId } });
    return user.primaryGroupId;
  }

  /** Membri v2: `source` (ex. `promotion`, `vip`, `store`, `servers`) și expirarea opțională apar în ACP la grupul secundar. */
  async addSecondary(tx: Tx, userId: string, groupId: number, opts: { source?: string; expiresAt?: Date | null } = {}): Promise<boolean> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { primaryGroupId: true } });
    if (!user || user.primaryGroupId === groupId) return false;
    const { count } = await tx.userGroup.createMany({ data: [{ userId, groupId, source: opts.source ?? "manual", expiresAt: opts.expiresAt ?? null }], skipDuplicates: true });
    return count > 0;
  }

  async removeSecondary(tx: Tx, userId: string, groupId: number): Promise<boolean> {
    const { count } = await tx.userGroup.deleteMany({ where: { userId, groupId } });
    return count > 0;
  }

  /** După commit: permisiunile noi se văd la următorul request, iar modulele reacționează (cosmetice, reguli). */
  async notify(userId: string, groupIds: number[]): Promise<void> {
    await this.deps.permissions.bumpVersion();
    await this.deps.bus.emit({ name: "group.updated", payload: { groupIds }, tags: [...groupIds.map((id) => `group:${id}`), `user:${userId}`] });
    await this.deps.bus.emit({ name: "user.groups_changed", payload: { userId }, tags: [`user:${userId}`] });
  }
}
