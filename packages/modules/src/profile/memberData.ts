import type { GcsMemberDataHandler, GcsMemberDataNote } from "@gcs/core";
import { type PrismaClient, sql } from "@gcs/db";
import { STATUS_CONTENT_TYPE } from "./social";

const BULK = 5000;

/**
 * Datele aplicației Profil la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri §2, §4).
 *
 * - Ștergerea: peretele propriului profil se șterge; statusurile scrise pe alte profiluri rămân ca „Membru șters” (fără IP)
 *   sau, în modul „Șterge și conținutul”, se șterg (cu răspunsurile lor; contorul părintelui scade). Câmpurile, insignele,
 *   realizările, ignorările și aspectul dispar odată cu rândul userului (cascadă).
 * - Unirea: peretele și statusurile trec la țintă; ignorările, insignele și realizările trec fără dubluri; punctele (XP)
 *   sursei se adaugă țintei, minus cele ale dublurilor; profilul țintei (câmpuri, semnătură, aspect) rămâne neschimbat.
 */
export function profileMemberData(deps: { db: PrismaClient; evaluate?: (userId: string) => Promise<void> }): GcsMemberDataHandler {
  const { db } = deps;
  return {
    key: "profile",
    /** GDPR (Membri v2): câmpurile profilului, statusurile scrise, insignele, ignorările și semnătura. */
    async export(userId) {
      const [fields, statuses, badges, ignores, user] = await Promise.all([
        db.profileFieldValue.findMany({ where: { userId }, select: { value: true, field: { select: { key: true, label: true } } } }),
        db.statusUpdate.findMany({ where: { authorId: userId }, orderBy: { id: "asc" }, select: { id: true, profileUserId: true, contentHtml: true, createdAt: true } }),
        db.userBadge.findMany({ where: { userId }, select: { createdAt: true, badge: { select: { name: true } } } }),
        db.userIgnore.findMany({ where: { userId }, select: { ignoredId: true, posts: true, messages: true, createdAt: true } }),
        db.user.findUnique({ where: { id: userId }, select: { signatureHtml: true, accentColor: true } }),
      ]);
      return {
        fields: fields.map((f) => ({ key: f.field.key, label: f.field.label, value: f.value })),
        statuses,
        badges: badges.map((b) => ({ name: b.badge.name, awardedAt: b.createdAt })),
        ignores,
        signatureHtml: user?.signatureHtml ?? "",
        accentColor: user?.accentColor ?? null,
      };
    },
    async summary(userId) {
      const [statuses, wall, badges, fields, ignores] = await Promise.all([
        db.statusUpdate.count({ where: { authorId: userId, NOT: { profileUserId: userId } } }),
        db.statusUpdate.count({ where: { profileUserId: userId } }),
        db.userBadge.count({ where: { userId } }),
        db.profileFieldValue.count({ where: { userId } }),
        db.userIgnore.count({ where: { userId } }),
      ]);
      return [
        { key: "profile.statuses", count: statuses },
        { key: "profile.wall", count: wall },
        { key: "profile.badges", count: badges },
        { key: "profile.fields", count: fields },
        { key: "profile.ignores", count: ignores },
      ];
    },
    async mergeNotes(sourceId) {
      const notes: GcsMemberDataNote[] = [];
      const fields = await db.profileFieldValue.count({ where: { userId: sourceId } });
      if (fields > 0) notes.push({ key: "profile_kept", level: "info" });
      return notes;
    },
    async erase({ userId, mode, batchSize }) {
      // Peretele propriului profil (cu răspunsurile, în cascadă).
      const wall = await db.$executeRaw(sql`DELETE FROM status_updates WHERE id IN (SELECT id FROM status_updates WHERE "profileUserId" = ${userId} AND "parentId" IS NULL LIMIT ${batchSize * 10})`);
      if (wall > 0) return wall;
      if (mode === "DELETE_CONTENT") {
        const rows = await db.statusUpdate.findMany({ where: { authorId: userId }, take: batchSize, orderBy: { id: "asc" }, select: { id: true, parentId: true, visibility: true } });
        for (const s of rows) {
          await db.$transaction(async (tx) => {
            const replies = await tx.statusUpdate.findMany({ where: { parentId: s.id }, select: { id: true } });
            const { count } = await tx.statusUpdate.deleteMany({ where: { id: s.id } });
            if (count > 0 && s.parentId !== null && s.visibility !== "HIDDEN") {
              await tx.$executeRaw(sql`UPDATE status_updates SET "repliesCount" = GREATEST(0, "repliesCount" - 1) WHERE id = ${s.parentId}`);
            }
            await tx.contentReaction.deleteMany({ where: { contentType: STATUS_CONTENT_TYPE, contentId: { in: [s.id, ...replies.map((r) => r.id)].map(String) } } });
          });
        }
        return rows.length;
      }
      return db.$executeRaw(sql`UPDATE status_updates SET "authorId" = NULL, ip = NULL WHERE id IN (SELECT id FROM status_updates WHERE "authorId" = ${userId} LIMIT ${BULK})`);
    },
    async merge({ sourceId, targetId }) {
      const wall = await db.$executeRaw(sql`UPDATE status_updates SET "profileUserId" = ${targetId} WHERE id IN (SELECT id FROM status_updates WHERE "profileUserId" = ${sourceId} LIMIT ${BULK})`);
      if (wall > 0) return wall;
      const statuses = await db.$executeRaw(sql`UPDATE status_updates SET "authorId" = ${targetId} WHERE id IN (SELECT id FROM status_updates WHERE "authorId" = ${sourceId} LIMIT ${BULK})`);
      if (statuses > 0) return statuses;
      const moved = await db.$transaction(async (tx) => {
        let n = 0;
        // Ignorările sursei: dublurile și „ținta se ignoră pe ea” dispar; ignorările altora față de sursă trec pe țintă.
        n += await tx.$executeRaw(sql`
          DELETE FROM user_ignores s WHERE s."userId" = ${sourceId}
            AND (s."ignoredId" = ${targetId} OR EXISTS (SELECT 1 FROM user_ignores t WHERE t."userId" = ${targetId} AND t."ignoredId" = s."ignoredId"))`);
        n += (await tx.userIgnore.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        n += await tx.$executeRaw(sql`
          DELETE FROM user_ignores s WHERE s."ignoredId" = ${sourceId}
            AND (s."userId" = ${targetId} OR EXISTS (SELECT 1 FROM user_ignores t WHERE t."ignoredId" = ${targetId} AND t."userId" = s."userId"))`);
        n += (await tx.userIgnore.updateMany({ where: { ignoredId: sourceId }, data: { ignoredId: targetId } })).count;

        // Insignele și realizările, fără dubluri; punctele dublurilor nu se adaugă țintei.
        const targetBadges = (await tx.userBadge.findMany({ where: { userId: targetId }, select: { badgeId: true } })).map((b) => b.badgeId);
        const dupBadges = await tx.userBadge.findMany({ where: { userId: sourceId, badgeId: { in: targetBadges } }, select: { badgeId: true, badge: { select: { points: true } } } });
        await tx.userBadge.deleteMany({ where: { userId: sourceId, badgeId: { in: dupBadges.map((b) => b.badgeId) } } });
        const badgePoints = dupBadges.map((b) => ({ points: b.badge.points }));
        n += badgePoints.length;
        n += (await tx.userBadge.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        const targetKeys = (await tx.achievementLog.findMany({ where: { userId: targetId, uniqueKey: { not: null } }, select: { uniqueKey: true } })).map((l) => l.uniqueKey!);
        const dupLogs = await tx.achievementLog.findMany({ where: { userId: sourceId, uniqueKey: { in: targetKeys } }, select: { id: true, points: true } });
        await tx.achievementLog.deleteMany({ where: { id: { in: dupLogs.map((l) => l.id) } } });
        const logPoints = dupLogs.map((l) => ({ points: l.points }));
        n += logPoints.length;
        n += (await tx.achievementLog.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;

        const source = await tx.user.findUnique({ where: { id: sourceId }, select: { points: true } });
        const dropped = [...badgePoints, ...logPoints].reduce((s, r) => s + r.points, 0);
        const points = (source?.points ?? 0) - dropped;
        if (source && source.points !== 0) {
          n++;
          await tx.user.update({ where: { id: sourceId }, data: { points: 0 } });
          if (points !== 0) await tx.user.update({ where: { id: targetId }, data: { points: { increment: points } } });
        }
        return n;
      });
      if (moved > 0) return moved;
      // Rangul și regulile țintei, după punctele și contoarele noi.
      await deps.evaluate?.(targetId);
      return 0;
    },
  };
}
