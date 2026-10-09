import type { GcsAttachmentService, GcsMemberDataHandler } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { CHAT_FILE_CONTENT_TYPE } from "./chat";

const BULK = 5000;

/**
 * Chat-ul la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri §2, §4).
 *
 * - Ștergerea: mesajele rămân ca „Membru șters” sau, în modul „Șterge și conținutul”, se șterg cu fișierele lor; camerele
 *   private ale membrului rămân fără proprietar; reacțiile, mute-urile și locurile în camere dispar odată cu rândul userului.
 * - Unirea: mesajele, reacțiile, camerele (membru, proprietar) și mute-urile trec la țintă, fără dubluri.
 */
export function chatMemberData(deps: { db: PrismaClient; attachments?: Pick<GcsAttachmentService, "deleteFor"> }): GcsMemberDataHandler {
  const { db } = deps;
  return {
    key: "chat",
    async summary(userId) {
      const [messages, rooms] = await Promise.all([db.chatMessage.count({ where: { authorId: userId } }), db.chatChannel.count({ where: { ownerId: userId } })]);
      return [
        { key: "chat.messages", count: messages },
        { key: "chat.rooms", count: rooms },
      ];
    },
    async erase({ userId, mode, batchSize }) {
      if (mode === "DELETE_CONTENT") {
        const rows = await db.chatMessage.findMany({ where: { authorId: userId }, take: batchSize * 10, select: { id: true } });
        if (rows.length > 0) {
          await db.chatMessage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
          await deps.attachments?.deleteFor(CHAT_FILE_CONTENT_TYPE, rows.map((r) => String(r.id)));
          return rows.length;
        }
      } else {
        const kept = await db.$executeRaw`UPDATE chat_messages SET "authorId" = NULL WHERE id IN (SELECT id FROM chat_messages WHERE "authorId" = ${userId} LIMIT ${BULK})`;
        if (kept > 0) return kept;
      }
      return (
        (await db.$executeRaw`UPDATE chat_messages SET "deletedById" = NULL WHERE "deletedById" = ${userId}`) +
        (await db.$executeRaw`UPDATE chat_mutes SET "createdById" = NULL WHERE "createdById" = ${userId}`) +
        (await db.$executeRaw`UPDATE chat_announcements SET "createdById" = NULL WHERE "createdById" = ${userId}`) +
        (await db.$executeRaw`UPDATE chat_room_members SET "invitedById" = NULL WHERE "invitedById" = ${userId}`)
      );
    },
    async merge({ sourceId, targetId }) {
      const messages = await db.$executeRaw`UPDATE chat_messages SET "authorId" = ${targetId} WHERE id IN (SELECT id FROM chat_messages WHERE "authorId" = ${sourceId} LIMIT ${BULK})`;
      if (messages > 0) return messages;
      return db.$transaction(async (tx) => {
        let n = 0;
        n += await tx.$executeRaw`
          DELETE FROM chat_message_reactions s WHERE s."userId" = ${sourceId}
            AND EXISTS (SELECT 1 FROM chat_message_reactions t WHERE t."userId" = ${targetId} AND t."messageId" = s."messageId" AND t."reactionId" = s."reactionId")`;
        n += (await tx.chatMessageReaction.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        n += await tx.$executeRaw`
          DELETE FROM chat_room_members s WHERE s."userId" = ${sourceId}
            AND EXISTS (SELECT 1 FROM chat_room_members t WHERE t."userId" = ${targetId} AND t."channelId" = s."channelId")`;
        n += (await tx.chatRoomMember.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        n += (await tx.chatChannel.updateMany({ where: { ownerId: sourceId }, data: { ownerId: targetId } })).count;
        n += (await tx.chatMute.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        n += await tx.$executeRaw`UPDATE chat_messages SET "deletedById" = ${targetId} WHERE "deletedById" = ${sourceId}`;
        n += await tx.$executeRaw`UPDATE chat_mutes SET "createdById" = ${targetId} WHERE "createdById" = ${sourceId}`;
        n += await tx.$executeRaw`UPDATE chat_room_members SET "invitedById" = ${targetId} WHERE "invitedById" = ${sourceId}`;
        return n;
      });
    },
  };
}
