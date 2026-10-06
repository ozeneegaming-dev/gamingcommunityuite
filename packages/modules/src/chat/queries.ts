import { GcsForbidden, GcsNotFound, type GcsActor, type GcsPermissionService } from "@gcs/core";
import type { ChatChannel, PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { chatContainer, toChatView, type GcsChatMessageView } from "./chat";

const PAGE = 30;

export type GcsChatChannelView = Pick<ChatChannel, "key" | "name" | "description" | "slowModeSeconds" | "showOnHome"> & { canWrite: boolean };
export type GcsChatMuteView = { id: number; user: GcsUserRef; channel: string | null; until: string | null; reason: string; createdAt: string };

/** Citirile chat-ului: canalele vizibile, ultimele mesaje, istoricul cu cursor și mute-urile active. */
export class GcsChatQueries {
  constructor(private readonly deps: { db: PrismaClient; permissions: GcsPermissionService }) {}

  async canRead(viewer: GcsActor, key: string): Promise<boolean> {
    if (viewer.isBanned) return false;
    const channel = await this.deps.db.chatChannel.findUnique({ where: { key }, select: { enabled: true } });
    return channel?.enabled === true && (await this.deps.permissions.can(viewer, "chat.read", chatContainer(key)));
  }

  /** Canalele pe care viewer-ul le poate citi, în ordine; `homeOnly` = doar cele de pe pagina principală. */
  async channels(viewer: GcsActor, opts: { homeOnly?: boolean } = {}): Promise<GcsChatChannelView[]> {
    const { db, permissions } = this.deps;
    if (viewer.isBanned) return [];
    const rows = await db.chatChannel.findMany({ where: { enabled: true, ...(opts.homeOnly ? { showOnHome: true } : {}) }, orderBy: [{ position: "asc" }, { id: "asc" }] });
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
      }));
  }

  private async assertRead(viewer: GcsActor, key: string): Promise<ChatChannel> {
    const channel = await this.deps.db.chatChannel.findUnique({ where: { key } });
    if (!channel || !channel.enabled) throw new GcsNotFound();
    if (viewer.isBanned || !(await this.deps.permissions.can(viewer, "chat.read", chatContainer(key)))) throw new GcsForbidden({ permission: "chat.read" });
    return channel;
  }

  /** Ultimele mesaje (cele mai vechi primele), fără cele șterse. */
  async recent(viewer: GcsActor, key: string, limit = PAGE): Promise<GcsChatMessageView[]> {
    return this.history(viewer, key, null, limit);
  }

  /** Mesajele dinaintea lui `beforeId` (derularea în sus), cele mai vechi primele. */
  async history(viewer: GcsActor, key: string, beforeId: number | null, limit = PAGE): Promise<GcsChatMessageView[]> {
    const channel = await this.assertRead(viewer, key);
    const rows = await this.deps.db.chatMessage.findMany({
      where: { channelId: channel.id, deletedAt: null, ...(beforeId ? { id: { lt: beforeId } } : {}) },
      orderBy: { id: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      include: { author: { select: userRefSelect } },
    });
    return rows.reverse().map((m) => toChatView(m, channel.key));
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
