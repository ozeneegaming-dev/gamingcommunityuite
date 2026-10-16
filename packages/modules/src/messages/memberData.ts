import type { GcsAttachmentService, GcsMemberDataHandler } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { PM_CONTENT_TYPE } from "./conversations";

const BULK = 5000;

/**
 * Mesajele private la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri §2, §4).
 *
 * - Ștergerea: mesajele trimise de membru **se șterg** (implicit, GDPR) cu fișierele lor, iar contoarele conversațiilor
 *   (numărul, ultimul mesaj) se recalculează; cu „Păstrează mesajele private” rămân în conversațiile celorlalți, fără autor
 *   și fără IP. Membrul iese din toate conversațiile; o conversație fără niciun participant activ se șterge cu totul.
 * - Unirea: conversațiile sursei trec la țintă (un singur participant dacă ținta era deja acolo), mesajele au autorul ținta.
 */
export function messageMemberData(deps: { db: PrismaClient; attachments: Pick<GcsAttachmentService, "deleteFor"> }): GcsMemberDataHandler {
  const { db, attachments } = deps;

  /** Numărul de mesaje și ultimul mesaj ale conversațiilor date, din date. */
  async function recount(conversationIds: number[]): Promise<void> {
    if (conversationIds.length === 0) return;
    await db.$executeRaw`
      UPDATE conversations c SET
        "messagesCount" = (SELECT COUNT(*)::int FROM conversation_messages m WHERE m."conversationId" = c.id),
        "lastMessageId" = (SELECT MAX(m.id) FROM conversation_messages m WHERE m."conversationId" = c.id),
        "lastMessageAt" = COALESCE((SELECT MAX(m."createdAt") FROM conversation_messages m WHERE m."conversationId" = c.id), c."lastMessageAt")
      WHERE c.id = ANY(${conversationIds}::int[])`;
  }

  return {
    key: "messages",
    /** GDPR (Membri v2): conversațiile membrului (titlul) și mesajele scrise de el; mesajele celorlalți nu intră. */
    async export(userId) {
      const [conversations, messages] = await Promise.all([
        db.conversationParticipant.findMany({ where: { userId }, select: { conversation: { select: { id: true, title: true, createdAt: true } } } }),
        db.conversationMessage.findMany({ where: { authorId: userId }, orderBy: { id: "asc" }, select: { id: true, conversationId: true, contentHtml: true, createdAt: true, ip: true } }),
      ]);
      return { conversations: conversations.map((c) => c.conversation), messages };
    },
    async summary(userId) {
      const [conversations, messages] = await Promise.all([
        db.conversationParticipant.count({ where: { userId } }),
        db.conversationMessage.count({ where: { authorId: userId } }),
      ]);
      return [
        { key: "messages.conversations", count: conversations },
        { key: "messages.sent", count: messages },
      ];
    },
    async erase({ userId, mode, keepMessages, batchSize }) {
      if (keepMessages && mode === "KEEP_CONTENT") {
        const kept = await db.$executeRaw`UPDATE conversation_messages SET "authorId" = NULL, ip = NULL WHERE id IN (SELECT id FROM conversation_messages WHERE "authorId" = ${userId} LIMIT ${BULK})`;
        if (kept > 0) return kept;
      } else {
        const rows = await db.conversationMessage.findMany({ where: { authorId: userId }, take: batchSize * 10, select: { id: true, conversationId: true } });
        if (rows.length > 0) {
          await db.conversationMessage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
          await recount([...new Set(rows.map((r) => r.conversationId))]);
          await attachments.deleteFor(PM_CONTENT_TYPE, rows.map((r) => String(r.id)));
          return rows.length;
        }
      }
      // Membrul iese din conversații; una fără alt participant activ se șterge cu totul (cu fișierele mesajelor).
      const parts = await db.conversationParticipant.findMany({ where: { userId }, take: batchSize, select: { conversationId: true } });
      for (const { conversationId } of parts) {
        const others = await db.conversationParticipant.count({ where: { conversationId, userId: { not: userId }, leftAt: null } });
        if (others > 0) {
          await db.conversationParticipant.deleteMany({ where: { conversationId, userId } });
          continue;
        }
        const ids = (await db.conversationMessage.findMany({ where: { conversationId }, select: { id: true } })).map((m) => String(m.id));
        await db.conversation.deleteMany({ where: { id: conversationId } });
        await attachments.deleteFor(PM_CONTENT_TYPE, ids);
      }
      if (parts.length > 0) return parts.length;
      return (
        (await db.$executeRaw`UPDATE conversations SET "starterId" = NULL WHERE "starterId" = ${userId}`) +
        (await db.$executeRaw`UPDATE conversation_participants SET "invitedById" = NULL WHERE "invitedById" = ${userId}`)
      );
    },
    async merge({ sourceId, targetId }) {
      const messages = await db.$executeRaw`UPDATE conversation_messages SET "authorId" = ${targetId} WHERE id IN (SELECT id FROM conversation_messages WHERE "authorId" = ${sourceId} LIMIT ${BULK})`;
      if (messages > 0) return messages;
      return db.$transaction(async (tx) => {
        let n = 0;
        // Ținta era deja în conversație: rămâne participarea ei (redeschisă dacă sursa era încă activă acolo).
        n += await tx.$executeRaw`
          UPDATE conversation_participants t SET "leftAt" = NULL, "lastReadMessageId" = GREATEST(t."lastReadMessageId", s."lastReadMessageId")
          FROM conversation_participants s
          WHERE t."userId" = ${targetId} AND s."userId" = ${sourceId} AND s."conversationId" = t."conversationId" AND s."leftAt" IS NULL AND t."leftAt" IS NOT NULL`;
        n += await tx.$executeRaw`
          DELETE FROM conversation_participants s WHERE s."userId" = ${sourceId}
            AND EXISTS (SELECT 1 FROM conversation_participants t WHERE t."userId" = ${targetId} AND t."conversationId" = s."conversationId")`;
        n += (await tx.conversationParticipant.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        n += await tx.$executeRaw`UPDATE conversations SET "starterId" = ${targetId} WHERE "starterId" = ${sourceId}`;
        n += await tx.$executeRaw`UPDATE conversation_participants SET "invitedById" = ${targetId} WHERE "invitedById" = ${sourceId}`;
        return n;
      });
    },
  };
}
