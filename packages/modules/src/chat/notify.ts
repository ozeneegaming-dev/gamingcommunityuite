import type { GcsActorResolver, GcsEventBus, GcsNotificationService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsChatQueries } from "./queries";

/**
 * Notificările chat-ului (etapa 5): `chat.mention` pentru cei menționați într-un mesaj. Ținta e mesajul;
 * cine nu mai poate citi camera (ex. a ieșit dintr-o cameră privată) nu mai vede notificarea.
 */
export function registerChatNotifications(deps: { db: PrismaClient; bus: GcsEventBus; notifications: GcsNotificationService; chatQueries: GcsChatQueries; actors: GcsActorResolver }): void {
  const { db, bus, notifications, chatQueries, actors } = deps;
  const channelOf = (id: string) =>
    db.chatMessage.findUnique({ where: { id: Number(id) }, select: { body: true, deletedAt: true, channel: { select: { key: true, name: true } } } });
  notifications.registerTarget("chat.message", {
    canView: async (userId, id) => {
      const m = await channelOf(id);
      return m !== null && m.deletedAt === null && (await chatQueries.canRead(await actors.forUser(userId, ""), m.channel.key));
    },
    describe: async (id) => {
      const m = await channelOf(id);
      return m ? { title: m.channel.name, href: `/chat?c=${m.channel.key}`, snippet: m.body.slice(0, 140) } : null;
    },
  });
  bus.on("chat.mention", async (e) => {
    const { messageId, authorId, userIds } = e.payload as { messageId?: number; authorId?: string; userIds?: string[] };
    if (!messageId || !Array.isArray(userIds) || userIds.length === 0) return;
    await notifications.notify({ userIds, type: "chat.mention", targetType: "chat.message", targetId: String(messageId), actorId: authorId ?? null });
  });
}
