import type { GcsMemberDataHandler, GcsMemberDataNote } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsVipService } from "./vip";

/**
 * VIP-ul la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri §2, §4): la ștergere abonamentele și
 * istoricul VIP dispar; la unire se păstrează abonamentul activ mai lung (vezi `GcsVipService.mergeAccounts`).
 */
export function vipMemberData(deps: { db: PrismaClient; vip: GcsVipService }): GcsMemberDataHandler {
  const { db, vip } = deps;
  const tier = async (groupId: number) => (await db.group.findUnique({ where: { id: groupId }, select: { name: true } }))?.name ?? "VIP";
  const until = (d: Date | null) => (d ? d.toISOString() : "");
  return {
    key: "vip",
    async summary(userId) {
      const [active, history] = await Promise.all([db.vipSubscription.count({ where: { userId, status: "ACTIVE" } }), db.vipLog.count({ where: { userId } })]);
      return [
        { key: "vip.active", count: active },
        { key: "vip.history", count: history },
      ];
    },
    async mergeNotes(sourceId, targetId) {
      const { outcome, source, target } = await vip.mergeOutcome(sourceId, targetId);
      const notes: GcsMemberDataNote[] = [];
      if (outcome === "moves" && source) {
        notes.push({ key: target ? "vip_source_longer" : "vip_moves", level: "info", params: { tier: await tier(source.groupId), until: until(source.expiresAt) } });
      } else if (outcome === "kept" && target) {
        notes.push({ key: "vip_target_kept", level: "info", params: { tier: await tier(target.groupId), until: until(target.expiresAt) } });
      }
      return notes;
    },
    erase: ({ userId }) => vip.purgeAccount(userId),
    merge: ({ sourceId, targetId }) => vip.mergeAccounts(sourceId, targetId),
  };
}
