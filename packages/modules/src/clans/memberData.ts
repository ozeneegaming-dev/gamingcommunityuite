import type { GcsMemberDataHandler, GcsMemberDataNote } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsClanService } from "./service";

/**
 * Clanurile la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri §2, §4). Observațiile arată dinainte
 * cine preia fiecare clan condus de membru (sau că rămâne gol și se arhivează) și, la unire, ce clanuri rămân.
 */
export function clanMemberData(deps: { db: PrismaClient; clans: GcsClanService }): GcsMemberDataHandler {
  const { db, clans } = deps;

  async function leaderNotes(userId: string, prefer: string | null): Promise<GcsMemberDataNote[]> {
    return (await clans.successions(userId, prefer)).map(
      (s): GcsMemberDataNote =>
        s.successor
          ? { key: "clan_successor", level: "warn", params: { tag: s.tag, clan: s.name, name: s.successor.name } }
          : { key: "clan_archived", level: "warn", params: { tag: s.tag, clan: s.name } },
    );
  }

  return {
    key: "clans",
    async summary(userId) {
      const [memberships, leader, requests] = await Promise.all([
        db.clanMember.count({ where: { userId } }),
        db.clanMember.count({ where: { userId, role: "LEADER" } }),
        db.clanRequest.count({ where: { userId, status: "PENDING" } }),
      ]);
      return [
        { key: "clans.memberships", count: memberships },
        { key: "clans.leader", count: leader },
        { key: "clans.requests", count: requests },
      ];
    },
    deleteNotes: (userId) => leaderNotes(userId, null),
    async mergeNotes(sourceId, targetId) {
      const [source, target] = await Promise.all([
        db.clanMember.findMany({ where: { userId: sourceId }, select: { clan: { select: { tag: true } } } }),
        db.clanMember.findMany({ where: { userId: targetId }, select: { clan: { select: { tag: true } } } }),
      ]);
      if (source.length === 0) return [];
      if (target.length === 0) return [{ key: "clans_move", level: "info", params: { tags: source.map((m) => m.clan.tag).join(", ") } }];
      return [
        { key: "clans_target_kept", level: "warn", params: { tags: target.map((m) => m.clan.tag).join(", "), dropped: source.map((m) => m.clan.tag).join(", ") } },
        ...(await leaderNotes(sourceId, targetId)),
      ];
    },
    erase: ({ userId }) => clans.accountLeave(userId),
    merge: ({ sourceId, targetId }) => clans.accountMerge(sourceId, targetId),
  };
}
