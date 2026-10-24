import type { GcsMemberDataHandler, GcsMemberDataNote } from "@gcs/core";
import { type PrismaClient, sql } from "@gcs/db";
import type { GcsBridgePlayers } from "./players";
import type { GcsBridgeStore } from "./store";

/**
 * Serverele de joc la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri §2, §4).
 *
 * - Ștergerea: identitățile de joc se dezleagă (rămân jucători fără cont, cu statisticile, ELO-ul și meciurile lor);
 *   intrările de admin, adminii afișați pe servere, codurile de legare și tichetele scrise de membru se șterg; în
 *   sancțiunile, acțiunile de admin și tichetele altora referința la cont se golește (numele din joc rămâne).
 * - Unirea: identitățile, intrările de admin (fără dubluri pe același server), adminii afișați, tichetele, sancțiunile și
 *   acțiunile date de pe site trec la țintă; legătura Steam a țintei se resincronizează (contul Steam mutat).
 *
 * Listele pluginurilor (admini, VIP) se reîmprospătează prin versiunea lor (`store.bumpVersion`).
 */
export function serverMemberData(deps: { db: PrismaClient; store: Pick<GcsBridgeStore, "bumpVersion">; players: Pick<GcsBridgePlayers, "syncSteam"> }): GcsMemberDataHandler {
  const { db, store, players } = deps;
  return {
    key: "servers",
    async summary(userId) {
      const [identities, admins, serverAdmins, tickets] = await Promise.all([
        db.gamePlayer.count({ where: { userId } }),
        db.gameAdmin.count({ where: { userId } }),
        db.gameServerAdmin.count({ where: { userId } }),
        db.gameTicket.count({ where: { authorId: userId } }),
      ]);
      return [
        { key: "servers.identities", count: identities },
        { key: "servers.admins", count: admins + serverAdmins },
        { key: "servers.tickets", count: tickets },
      ];
    },
    async deleteNotes(userId) {
      const notes: GcsMemberDataNote[] = [];
      const identities = await db.gamePlayer.count({ where: { userId } });
      if (identities > 0) notes.push({ key: "game_unlinked", level: "info", params: { count: identities } });
      return notes;
    },
    async erase({ userId }) {
      const n = await db.$transaction(async (tx) => {
        let n = 0;
        n += (await tx.gamePlayer.updateMany({ where: { userId }, data: { userId: null, linkSource: null, linkedAt: null } })).count;
        n += (await tx.gameAdmin.deleteMany({ where: { userId } })).count;
        n += (await tx.gameServerAdmin.deleteMany({ where: { userId } })).count;
        n += (await tx.gameLinkCode.deleteMany({ where: { userId } })).count;
        n += (await tx.gameTicket.deleteMany({ where: { authorId: userId } })).count;
        n += (await tx.gameTicket.updateMany({ where: { targetUserId: userId }, data: { targetUserId: null } })).count;
        n += (await tx.gameTicket.updateMany({ where: { assigneeId: userId }, data: { assigneeId: null } })).count;
        n += (await tx.gameTicketMessage.updateMany({ where: { authorId: userId }, data: { authorId: null } })).count;
        n += (await tx.gameSanction.updateMany({ where: { adminUserId: userId }, data: { adminUserId: null } })).count;
        n += (await tx.gameSanction.updateMany({ where: { unbannedById: userId }, data: { unbannedById: null } })).count;
        n += (await tx.gameAdminAction.updateMany({ where: { adminUserId: userId }, data: { adminUserId: null } })).count;
        return n;
      });
      if (n > 0) await store.bumpVersion();
      return n;
    },
    async merge({ sourceId, targetId }) {
      const n = await db.$transaction(async (tx) => {
        let n = 0;
        n += (await tx.gamePlayer.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        // O intrare de admin pe un server (sau pe toate) pe care ținta o are deja: rămâne a țintei.
        n += await tx.$executeRaw(sql`
          DELETE FROM game_admins s WHERE s."userId" = ${sourceId}
            AND EXISTS (SELECT 1 FROM game_admins t WHERE t."userId" = ${targetId} AND t."serverId" IS NOT DISTINCT FROM s."serverId")`);
        n += (await tx.gameAdmin.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        n += await tx.$executeRaw(sql`
          DELETE FROM game_server_admins s WHERE s."userId" = ${sourceId}
            AND EXISTS (SELECT 1 FROM game_server_admins t WHERE t."userId" = ${targetId} AND t."serverId" = s."serverId")`);
        n += (await tx.gameServerAdmin.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        n += (await tx.gameLinkCode.deleteMany({ where: { userId: sourceId } })).count;
        n += (await tx.gameTicket.updateMany({ where: { authorId: sourceId }, data: { authorId: targetId } })).count;
        n += (await tx.gameTicket.updateMany({ where: { targetUserId: sourceId }, data: { targetUserId: targetId } })).count;
        n += (await tx.gameTicket.updateMany({ where: { assigneeId: sourceId }, data: { assigneeId: targetId } })).count;
        n += (await tx.gameTicketMessage.updateMany({ where: { authorId: sourceId }, data: { authorId: targetId } })).count;
        n += (await tx.gameSanction.updateMany({ where: { adminUserId: sourceId }, data: { adminUserId: targetId } })).count;
        n += (await tx.gameSanction.updateMany({ where: { unbannedById: sourceId }, data: { unbannedById: targetId } })).count;
        n += (await tx.gameAdminAction.updateMany({ where: { adminUserId: sourceId }, data: { adminUserId: targetId } })).count;
        // O identitate Steam legată prin contul Steam al sursei, pe care ținta nu l-a primit (avea deja unul): rămâne a țintei,
        // ca legătură făcută de staff (altfel resincronizarea ar dezlega-o).
        const steam = (await tx.account.findMany({ where: { userId: targetId, providerId: "steam" }, select: { accountId: true } })).map((a) => a.accountId);
        n += (await tx.gamePlayer.updateMany({ where: { userId: targetId, kind: "STEAM", linkSource: "STEAM", value: { notIn: steam } }, data: { linkSource: "STAFF" } })).count;
        return n;
      });
      if (n > 0) {
        await store.bumpVersion();
        return n;
      }
      // Totul s-a mutat: contul Steam trecut în țintă (la confirmarea unirii) își leagă identitatea de joc. Idempotent.
      await players.syncSteam(targetId);
      return 0;
    },
  };
}
