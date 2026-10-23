import type { PrismaClient } from "@gcs/db";
import type { GcsAttachmentService } from "../../content/files/attachments";
import type { GcsReactionService } from "../../content/reactions";
import type { GcsMemberDataHandler, GcsMemberDataNote } from "./types";

/** Tipul urmăririlor de membri (`follows.contentType`), ca în aplicația Profil. */
const USER_FOLLOW = "user";

type ReactionRow = { id: number; contentType: string; contentId: string; weight: number };

/**
 * Reacțiile date de membru (serviciul comun de reacții). Ștergerea: fiecare reacție dispare, iar reputația autorului
 * conținutului scade cu greutatea ei. Unirea, în trei faze (cursorul pasului): (A) reacțiile sursei trec la țintă, în afară
 * de cele pe conținutul țintei (ar fi reacții la propriul conținut) și de cele pe un conținut la care ținta reacționase
 * deja (unicitatea); (B) reacțiile țintei pe conținutul sursei se șterg (după unire ar fi tot ale ei); (C) reputația rămasă
 * a sursei trece la țintă. Fiecare reacție ștearsă corectează reputația autorului.
 */
export function reactionDataHandler(deps: { db: PrismaClient; reactions: Pick<GcsReactionService, "authorOf"> }): GcsMemberDataHandler {
  const { db, reactions } = deps;

  const batchOf = (where: { userId: string; afterId?: number }, take: number) =>
    db.contentReaction.findMany({
      where: { userId: where.userId, ...(where.afterId !== undefined ? { id: { gt: where.afterId } } : {}) },
      orderBy: { id: "asc" },
      take,
      select: { id: true, contentType: true, contentId: true, reaction: { select: { weight: true } } },
    });
  const rowsOf = (rows: Awaited<ReturnType<typeof batchOf>>): ReactionRow[] => rows.map((r) => ({ id: r.id, contentType: r.contentType, contentId: r.contentId, weight: r.reaction.weight }));

  async function drop(r: ReactionRow, author: string | null): Promise<void> {
    await db.$transaction(async (tx) => {
      const { count } = await tx.contentReaction.deleteMany({ where: { id: r.id } });
      if (count > 0 && author && r.weight !== 0) await tx.user.updateMany({ where: { id: author }, data: { reputation: { decrement: r.weight } } });
    });
  }

  return {
    key: "reactions",
    async summary(userId) {
      return [{ key: "reactions.given", count: await db.contentReaction.count({ where: { userId } }) }];
    },
    async erase({ userId, batchSize }) {
      const rows = rowsOf(await batchOf({ userId }, batchSize));
      for (const r of rows) {
        const author = await reactions.authorOf(r.contentType, r.contentId);
        await drop(r, author === userId ? null : author);
      }
      return rows.length;
    },
    async merge({ sourceId, targetId, batchSize, cursor }) {
      const phase = cursor.value ?? "A";
      if (phase === "A") {
        const rows = rowsOf(await batchOf({ userId: sourceId }, batchSize));
        for (const r of rows) {
          const author = await reactions.authorOf(r.contentType, r.contentId);
          const duplicate = await db.contentReaction.count({ where: { contentType: r.contentType, contentId: r.contentId, userId: targetId } });
          if (author === targetId || duplicate > 0) await drop(r, author);
          else await db.contentReaction.updateMany({ where: { id: r.id, userId: sourceId }, data: { userId: targetId } });
        }
        if (rows.length > 0) return rows.length;
        cursor.value = "B:0";
      }
      if (cursor.value?.startsWith("B:")) {
        const afterId = Number(cursor.value.slice(2)) || 0;
        const rows = rowsOf(await batchOf({ userId: targetId, afterId }, batchSize * 5));
        for (const r of rows) {
          if ((await reactions.authorOf(r.contentType, r.contentId)) === sourceId) await drop(r, sourceId);
        }
        if (rows.length > 0) {
          cursor.value = `B:${rows[rows.length - 1]!.id}`;
          return rows.length;
        }
        cursor.value = "C";
      }
      if (cursor.value === "C") {
        // Reputația primită de sursă (pe conținutul care trece la țintă): adăugată țintei și golită la sursă, deodată.
        await db.$transaction(async (tx) => {
          const source = await tx.user.findUnique({ where: { id: sourceId }, select: { reputation: true } });
          if (!source || source.reputation === 0) return;
          await tx.user.update({ where: { id: targetId }, data: { reputation: { increment: source.reputation } } });
          await tx.user.update({ where: { id: sourceId }, data: { reputation: 0 } });
        });
        cursor.value = "done";
      }
      return 0;
    },
  };
}

/**
 * Urmăririle (tabelul comun `follows`: topicuri, forumuri, membri…). Ștergerea: urmăririle membrului (cu `followersCount`
 * al membrilor urmăriți scăzut) și urmăritorii lui. Unirea: urmăririle sursei trec la țintă și urmăritorii sursei devin ai
 * țintei, fără dubluri și fără ca ținta să se urmărească pe ea; `followersCount` se recalculează.
 */
export function followDataHandler(deps: { db: PrismaClient }): GcsMemberDataHandler {
  const { db } = deps;
  return {
    key: "follows",
    async summary(userId) {
      const [following, followers] = await Promise.all([
        db.follow.count({ where: { userId } }),
        db.follow.count({ where: { contentType: USER_FOLLOW, contentId: userId } }),
      ]);
      return [
        { key: "follows.following", count: following },
        { key: "follows.followers", count: followers },
      ];
    },
    async erase({ userId, batchSize }) {
      return db.$transaction(async (tx) => {
        const removed = await tx.$queryRaw<{ contentType: string; contentId: string }[]>`
          DELETE FROM follows WHERE id IN (SELECT id FROM follows WHERE "userId" = ${userId} ORDER BY id LIMIT ${batchSize * 10})
          RETURNING "contentType", "contentId"`;
        const followed = removed.filter((r) => r.contentType === USER_FOLLOW).map((r) => r.contentId);
        if (followed.length > 0) {
          await tx.$executeRaw`
            UPDATE users u SET "followersCount" = GREATEST(0, u."followersCount" - c.n)
            FROM (SELECT id, COUNT(*)::int AS n FROM unnest(${followed}::text[]) AS id GROUP BY id) c WHERE u.id = c.id`;
        }
        const followers = await tx.follow.deleteMany({ where: { contentType: USER_FOLLOW, contentId: userId } });
        return removed.length + followers.count;
      });
    },
    async merge({ sourceId, targetId }) {
      return db.$transaction(async (tx) => {
        // Urmăririle sursei: dublurile și „ținta se urmărește pe ea” se șterg, restul trec la țintă.
        const dup = await tx.$executeRaw`
          DELETE FROM follows s WHERE s."userId" = ${sourceId}
            AND (EXISTS (SELECT 1 FROM follows t WHERE t."userId" = ${targetId} AND t."contentType" = s."contentType" AND t."contentId" = s."contentId")
                 OR (s."contentType" = ${USER_FOLLOW} AND s."contentId" = ${targetId}))`;
        const moved = await tx.follow.updateMany({ where: { userId: sourceId }, data: { userId: targetId } });
        // Urmăritorii sursei: ținta însăși și cei care urmăreau deja ținta se șterg, restul o urmăresc pe țintă.
        const dupFollowers = await tx.$executeRaw`
          DELETE FROM follows f WHERE f."contentType" = ${USER_FOLLOW} AND f."contentId" = ${sourceId}
            AND (f."userId" = ${targetId}
                 OR EXISTS (SELECT 1 FROM follows g WHERE g."userId" = f."userId" AND g."contentType" = ${USER_FOLLOW} AND g."contentId" = ${targetId}))`;
        const movedFollowers = await tx.follow.updateMany({ where: { contentType: USER_FOLLOW, contentId: sourceId }, data: { contentId: targetId } });
        const changed = dup + moved.count + dupFollowers + movedFollowers.count;
        if (changed > 0) {
          await tx.$executeRaw`
            UPDATE users u SET "followersCount" = (SELECT COUNT(*)::int FROM follows f WHERE f."contentType" = ${USER_FOLLOW} AND f."contentId" = u.id)
            WHERE u.id IN (${sourceId}, ${targetId})
               OR u.id IN (SELECT "contentId" FROM follows WHERE "userId" = ${targetId} AND "contentType" = ${USER_FOLLOW})`;
        }
        return changed;
      });
    },
  };
}

/**
 * Notificările membrului și preferințele lor. La unire trec la țintă; o notificare necitită care s-ar suprapune cu una a
 * țintei (același grup, indexul unic parțial al necititelor) se șterge.
 */
export function notificationDataHandler(deps: { db: PrismaClient }): GcsMemberDataHandler {
  const { db } = deps;
  return {
    key: "notifications",
    async summary(userId) {
      return [{ key: "notifications.all", count: await db.notification.count({ where: { userId } }) }];
    },
    async erase({ userId, batchSize }) {
      const removed = await db.$executeRaw`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE "userId" = ${userId} LIMIT ${batchSize * 20})`;
      if (removed > 0) return removed;
      const prefs = await db.notificationPreference.deleteMany({ where: { userId } });
      // Notificări v2: dispozitivele web push și setările de livrare.
      const push = await db.pushSubscription.deleteMany({ where: { userId } });
      const member = await db.notificationMember.deleteMany({ where: { userId } });
      return prefs.count + push.count + member.count;
    },
    async merge({ sourceId, targetId }) {
      return db.$transaction(async (tx) => {
        const clash = await tx.$executeRaw`
          DELETE FROM notifications s WHERE s."userId" = ${sourceId} AND s."readAt" IS NULL
            AND EXISTS (SELECT 1 FROM notifications t WHERE t."userId" = ${targetId} AND t."readAt" IS NULL AND t."groupKey" = s."groupKey")`;
        const moved = await tx.notification.updateMany({ where: { userId: sourceId }, data: { userId: targetId } });
        return clash + moved.count;
      });
    },
  };
}

/**
 * Datele de cont ținute de nucleu: bannurile, avertismentele, rapoartele trimise, jurnalul ACP, rolurile de staff.
 * Ștergerea: bannurile pe email / IP rămân (fără legătura cu contul), IP-urile din jurnal se golesc; bannul de cont,
 * avertismentele, rolurile ACP și moderarea pe containere dispar cu rândul userului. Unirea: avertismentele și bannurile
 * (primite și date) și rapoartele trec la țintă; rolurile de staff ale sursei nu se transferă.
 */
export function accountDataHandler(deps: { db: PrismaClient }): GcsMemberDataHandler {
  const { db } = deps;
  const staffCount = async (userId: string) => {
    const [roles, moderators, permissions] = await Promise.all([
      db.acpRoleAssignment.count({ where: { userId } }),
      db.moderator.count({ where: { userId } }),
      db.userPermission.count({ where: { userId } }),
    ]);
    return roles + moderators + permissions;
  };
  return {
    key: "account",
    async summary(userId) {
      const [warnings, bans, reports, staff] = await Promise.all([
        db.warning.count({ where: { userId } }),
        db.ban.count({ where: { userId } }),
        db.report.count({ where: { reporterId: userId } }),
        staffCount(userId),
      ]);
      return [
        { key: "account.warnings", count: warnings },
        { key: "account.bans", count: bans },
        { key: "account.reports", count: reports },
        { key: "account.staff", count: staff },
      ];
    },
    async deleteNotes(userId) {
      const notes: GcsMemberDataNote[] = [];
      const kept = await db.ban.count({ where: { userId, type: { not: "ACCOUNT" }, liftedAt: null } });
      if (kept > 0) notes.push({ key: "bans_kept", level: "info", params: { count: kept } });
      return notes;
    },
    async mergeNotes(sourceId) {
      const notes: GcsMemberDataNote[] = [];
      const now = new Date();
      const banned = await db.ban.count({ where: { userId: sourceId, type: "ACCOUNT", liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
      if (banned > 0) notes.push({ key: "ban_moves", level: "warn" });
      const staff = await staffCount(sourceId);
      if (staff > 0) notes.push({ key: "staff_dropped", level: "warn", params: { count: staff } });
      return notes;
    },
    async erase({ userId }) {
      const bans = await db.ban.updateMany({ where: { userId, type: { not: "ACCOUNT" } }, data: { userId: null } });
      const audit = await db.auditLog.updateMany({ where: { actorId: userId, ip: { not: null } }, data: { ip: null } });
      return bans.count + audit.count;
    },
    async merge({ sourceId, targetId }) {
      return db.$transaction(async (tx) => {
        let n = 0;
        n += (await tx.warning.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        n += (await tx.warning.updateMany({ where: { issuedById: sourceId }, data: { issuedById: targetId } })).count;
        // Bannul de cont are ca valoare id-ul contului.
        n += (await tx.ban.updateMany({ where: { userId: sourceId, type: "ACCOUNT" }, data: { userId: targetId, value: targetId } })).count;
        n += (await tx.ban.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        n += (await tx.ban.updateMany({ where: { createdById: sourceId }, data: { createdById: targetId } })).count;
        n += (await tx.report.updateMany({ where: { reporterId: sourceId }, data: { reporterId: targetId } })).count;
        n += (await tx.report.updateMany({ where: { handledById: sourceId }, data: { handledById: targetId } })).count;
        return n;
      });
    },
    /** GDPR: contul (fără parola și secretele 2FA), grupurile, sesiunile, dispozitivele, IP-urile, avertismentele și bannurile. */
    async export(userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          locale: true,
          timezone: true,
          twoFactorEnabled: true,
          createdAt: true,
          lastActiveAt: true,
          lastIp: true,
          registrationIp: true,
          bio: true,
          customTitle: true,
          birthday: true,
          privacy: true,
          prefs: true,
          postsCount: true,
          reputation: true,
          points: true,
          primaryGroup: { select: { name: true } },
          groups: { select: { source: true, expiresAt: true, addedAt: true, group: { select: { name: true } } } },
          accounts: { select: { providerId: true, createdAt: true } },
          sessions: { select: { ipAddress: true, userAgent: true, createdAt: true, expiresAt: true } },
          devices: { select: { browser: true, os: true, method: true, ip: true, location: true, firstSeenAt: true, lastSeenAt: true } },
          warnings: { select: { points: true, reason: true, createdAt: true, expiresAt: true } },
          bans: { select: { type: true, reason: true, createdAt: true, expiresAt: true, liftedAt: true } },
          donations: { select: { amount: true, currency: true, method: true, status: true, anonymous: true, reference: true, note: true, donatedAt: true, createdAt: true } },
        },
      });
      if (!user) return null;
      const { groups, primaryGroup, ...rest } = user;
      return {
        ...rest,
        primaryGroup: primaryGroup.name,
        secondaryGroups: groups.map((g) => ({ name: g.group.name, source: g.source, expiresAt: g.expiresAt, addedAt: g.addedAt })),
        reports: await db.report.findMany({ where: { reporterId: userId }, select: { contentType: true, contentId: true, reason: true, createdAt: true } }),
      };
    },
  };
}

/**
 * Fișierele încărcate de membru. Ștergerea: avatarul și coperta (din store), fișierele nelegate de niciun conținut; cele
 * legate de conținutul păstrat sau de alte entități (logo-ul unui clan) rămân, fără proprietar. Unirea: proprietarul devine
 * ținta; avatarul și coperta sursei se șterg (ținta își păstrează profilul).
 */
export function fileDataHandler(deps: { db: PrismaClient; attachments: Pick<GcsAttachmentService, "deleteProfileImage" | "deleteUnattachedOf"> }): GcsMemberDataHandler {
  const { db, attachments } = deps;
  async function dropProfileImages(userId: string): Promise<number> {
    const count = await db.attachment.count({ where: { contentType: { in: ["user.avatar", "user.cover"] }, contentId: userId } });
    if (count === 0) return 0;
    await attachments.deleteProfileImage(userId, "avatar");
    await attachments.deleteProfileImage(userId, "cover");
    await db.user.updateMany({ where: { id: userId }, data: { image: null, coverAttachmentId: null } });
    return count;
  }
  return {
    key: "files",
    async summary(userId) {
      return [{ key: "files.owned", count: await db.attachment.count({ where: { ownerId: userId } }) }];
    },
    async erase({ userId, batchSize }) {
      const images = await dropProfileImages(userId);
      if (images > 0) return images;
      const loose = await attachments.deleteUnattachedOf(userId, batchSize);
      if (loose > 0) return loose;
      return (await db.attachment.updateMany({ where: { ownerId: userId }, data: { ownerId: null } })).count;
    },
    async merge({ sourceId, targetId }) {
      const images = await dropProfileImages(sourceId);
      const moved = await db.attachment.updateMany({ where: { ownerId: sourceId }, data: { ownerId: targetId } });
      return images + moved.count;
    },
  };
}
