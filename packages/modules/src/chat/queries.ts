import { GcsForbidden, GcsNotFound, type GcsActor, type GcsPermissionService } from "@gcs/core";
import type { ChatChannel, ChatRoomType, PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { chatContainer, toChatView, type GcsChatMessageView } from "./chat";
import type { GcsChatExtensions } from "./extensions";

const PAGE = 30;

export type GcsChatChannelView = Pick<ChatChannel, "key" | "name" | "description" | "slowModeSeconds" | "showOnHome"> & {
  canWrite: boolean;
  /** Etapa 5: camerele create de membri (publice sau private, cu invitați). */
  type: ChatRoomType;
  ownerId: string | null;
};
export type GcsChatMuteView = { id: number; user: GcsUserRef; channel: string | null; until: string | null; reason: string; createdAt: string };
export type GcsChatAnnouncementView = { id: number; body: string; expiresAt: string | null; createdAt: string };

/**
 * Citirile chat-ului: canalele vizibile, ultimele mesaje (cu reacții), istoricul cu cursor, anunțurile și mute-urile.
 * O cameră privată există doar pentru membrii ei (invitați și creator): pentru restul e „nu există”.
 */
export class GcsChatQueries {
  constructor(private readonly deps: { db: PrismaClient; permissions: GcsPermissionService; extensions?: GcsChatExtensions }) {}

  /** Vederile completate de extensii (Chat Pro), dacă sunt. */
  private decorate<T extends GcsChatMessageView[]>(views: T): Promise<T> {
    return this.deps.extensions ? this.deps.extensions.decorate(views) : Promise.resolve(views);
  }

  private async isMember(userId: string | null, channelId: number): Promise<boolean> {
    if (!userId) return false;
    return (await this.deps.db.chatRoomMember.findUnique({ where: { channelId_userId: { channelId, userId } }, select: { userId: true } })) !== null;
  }

  /** Poate citi canalul: activ, permisiunea `chat.read` și, la camerele private, membru al camerei. */
  async canRead(viewer: GcsActor, key: string): Promise<boolean> {
    if (viewer.isBanned || typeof key !== "string") return false;
    const channel = await this.deps.db.chatChannel.findUnique({ where: { key }, select: { id: true, enabled: true, type: true } });
    if (channel?.enabled !== true) return false;
    if (channel.type === "PRIVATE" && !(await this.isMember(viewer.userId, channel.id))) return false;
    return this.deps.permissions.can(viewer, "chat.read", chatContainer(key));
  }

  /** Canalele pe care viewer-ul le poate citi, în ordine; `homeOnly` = doar cele de pe pagina principală. */
  async channels(viewer: GcsActor, opts: { homeOnly?: boolean } = {}): Promise<GcsChatChannelView[]> {
    const { db, permissions } = this.deps;
    if (viewer.isBanned) return [];
    const memberOf = viewer.userId ? (await db.chatRoomMember.findMany({ where: { userId: viewer.userId }, select: { channelId: true } })).map((m) => m.channelId) : [];
    const rows = await db.chatChannel.findMany({
      where: {
        enabled: true,
        ...(opts.homeOnly ? { showOnHome: true } : {}),
        OR: [{ type: "PUBLIC" }, { id: { in: memberOf } }],
      },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    const refs = rows.map((c) => chatContainer(c.key));
    const [readable, writable] = await Promise.all([permissions.filterContainers(viewer, "chat.read", refs), permissions.filterContainers(viewer, "chat.write", refs)]);
    return rows
      .filter((c) => readable.has(c.key))
      .map((c) => ({
        key: c.key,
        name: c.name,
        description: c.description,
        slowModeSeconds: c.slowModeSeconds,
        showOnHome: c.showOnHome,
        canWrite: viewer.userId !== null && writable.has(c.key),
        type: c.type,
        ownerId: c.ownerId,
      }));
  }

  private async assertRead(viewer: GcsActor, key: string): Promise<ChatChannel> {
    const channel = await this.deps.db.chatChannel.findUnique({ where: { key } });
    if (!channel || !channel.enabled) throw new GcsNotFound();
    // O cameră privată nu-și dezvăluie existența celor din afară.
    if (channel.type === "PRIVATE" && !(await this.isMember(viewer.userId, channel.id))) throw new GcsNotFound();
    if (viewer.isBanned || !(await this.deps.permissions.can(viewer, "chat.read", chatContainer(key)))) throw new GcsForbidden({ permission: "chat.read" });
    return channel;
  }

  /** Ultimele mesaje (cele mai vechi primele), fără cele șterse. */
  async recent(viewer: GcsActor, key: string, limit = PAGE): Promise<GcsChatMessageView[]> {
    return this.history(viewer, key, null, limit);
  }

  /** Mesajele dinaintea lui `beforeId` (derularea în sus), cele mai vechi primele, cu reacțiile lor. */
  async history(viewer: GcsActor, key: string, beforeId: number | null, limit = PAGE): Promise<GcsChatMessageView[]> {
    const channel = await this.assertRead(viewer, key);
    const rows = await this.deps.db.chatMessage.findMany({
      where: { channelId: channel.id, deletedAt: null, ...(beforeId ? { id: { lt: beforeId } } : {}) },
      orderBy: { id: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      include: { author: { select: userRefSelect }, reactions: { select: { userId: true, reactionId: true } } },
    });
    return this.decorate(rows.reverse().map((m) => toChatView(m, channel.key, viewer.userId)));
  }

  /** Mesajul fixat al camerei (sau `null`). */
  async pinned(viewer: GcsActor, key: string): Promise<GcsChatMessageView | null> {
    const channel = await this.assertRead(viewer, key);
    if (!channel.pinnedMessageId) return null;
    const m = await this.deps.db.chatMessage.findUnique({
      where: { id: channel.pinnedMessageId },
      include: { author: { select: userRefSelect }, reactions: { select: { userId: true, reactionId: true } } },
    });
    if (!m || m.deletedAt) return null;
    const [view] = await this.decorate([toChatView(m, channel.key, viewer.userId)]);
    return view ?? null;
  }

  /** Anunțurile globale active (apar în toate camerele). */
  async announcements(now = new Date()): Promise<GcsChatAnnouncementView[]> {
    const rows = await this.deps.db.chatAnnouncement.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { id: "desc" },
      take: 5,
    });
    return rows.map((a) => ({ id: a.id, body: a.body, expiresAt: a.expiresAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString() }));
  }

  /** Membrii unei camere private (lista din antetul camerei). */
  async roomMembers(viewer: GcsActor, key: string): Promise<GcsUserRef[]> {
    const channel = await this.assertRead(viewer, key);
    if (channel.type !== "PRIVATE") return [];
    const rows = await this.deps.db.chatRoomMember.findMany({ where: { channelId: channel.id }, orderBy: { joinedAt: "asc" }, include: { user: { select: userRefSelect } } });
    return rows.map((r) => toRef(r.user));
  }

  /** Mute-urile active (ACP și unelte de moderare). */
  async activeMutes(now = new Date()): Promise<GcsChatMuteView[]> {
    const rows = await this.deps.db.chatMute.findMany({
      where: { OR: [{ until: null }, { until: { gt: now } }] },
      orderBy: { createdAt: "desc" },
      include: { user: { select: userRefSelect }, channel: { select: { key: true } } },
      take: 200,
    });
    return rows.map((m) => ({
      id: m.id,
      user: toRef(m.user),
      channel: m.channel?.key ?? null,
      until: m.until?.toISOString() ?? null,
      reason: m.reason,
      createdAt: m.createdAt.toISOString(),
    }));
  }
}
