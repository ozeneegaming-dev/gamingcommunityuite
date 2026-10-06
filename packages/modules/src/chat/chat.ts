import {
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsEventBus,
  type GcsJobQueue,
  type GcsPermissionService,
  type GcsRealtime,
  type GcsRedisRateLimiter,
  type GcsSettingsService,
} from "@gcs/core";
import type { ChatChannel, PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { CHAT_ACP_CHANNELS, CHAT_CONTAINER, defaultChannelPermissions } from "./index";
import { applyWordFilter, cleanChatText, renderChatText } from "./text";

export const CHAT_CLEANUP_JOB = "chat.cleanup";
const KEY_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const MAX_SLOW_MODE = 3600;
const MAX_RETENTION = 365;

export type GcsChatMessageView = { id: number; channel: string; author: GcsUserRef | null; body: string; html: string; createdAt: string };
export type GcsChatChannelInput = {
  key: string;
  name: string;
  description?: string;
  slowModeSeconds?: number;
  retentionDays?: number;
  enabled?: boolean;
  showOnHome?: boolean;
};

export const chatContainer = (key: string) => ({ type: CHAT_CONTAINER, id: key });

export function toChatView(m: { id: number; body: string; createdAt: Date; author: Parameters<typeof toRef>[0] | null }, channel: string): GcsChatMessageView {
  return { id: m.id, channel, author: m.author ? toRef(m.author) : null, body: m.body, html: renderChatText(m.body), createdAt: m.createdAt.toISOString() };
}

/**
 * Chat-ul (specul etapei 4 §3, §7): trimitere cu permisiuni, mute, slow mode, flood și filtru; moderare cu jurnal;
 * canale din ACP; retenție zilnică. Mesajele noi și ștergerile pleacă live în camera `chat:{cheie}`.
 */
export class GcsChatService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      rateLimiter: GcsRedisRateLimiter;
      realtime: GcsRealtime;
      acp: GcsAcpRoleService;
    },
  ) {}

  private async channel(key: string): Promise<ChatChannel> {
    const channel = typeof key === "string" ? await this.deps.db.chatChannel.findUnique({ where: { key } }) : null;
    if (!channel || !channel.enabled) throw new GcsNotFound();
    return channel;
  }

  async canModerate(actor: GcsActor): Promise<boolean> {
    return actor.userId !== null && !actor.isBanned && (await this.deps.permissions.can(actor, "chat.moderate"));
  }

  private async assertModerator(actor: GcsActor): Promise<void> {
    if (!(await this.canModerate(actor))) throw new GcsForbidden({ permission: "chat.moderate" });
  }

  /** Mute-ul activ al userului pe canal (sau pe toate canalele). */
  async activeMute(userId: string, channelId: number, now = new Date()) {
    return this.deps.db.chatMute.findFirst({
      where: { userId, OR: [{ channelId }, { channelId: null }], AND: [{ OR: [{ until: null }, { until: { gt: now } }] }] },
      orderBy: { until: { sort: "desc", nulls: "first" } },
    });
  }

  async send(actor: GcsActor, key: string, raw: unknown): Promise<GcsChatMessageView> {
    const { db, bus, permissions, settings, rateLimiter, realtime } = this.deps;
    const channel = await this.channel(key);
    if (!actor.userId || actor.isBanned || !(await permissions.can(actor, "chat.write", chatContainer(channel.key)))) {
      throw new GcsForbidden({ permission: "chat.write" });
    }
    const body = cleanChatText(typeof raw === "string" ? raw : "");
    if (!body) throw new GcsValidationError({ body: "required" });
    const mute = await this.activeMute(actor.userId, channel.id);
    if (mute) throw new GcsForbidden({ reason: "muted", ...(mute.until ? { until: mute.until.toISOString() } : {}) });

    const moderator = await this.canModerate(actor);
    if (channel.slowModeSeconds > 0 && !moderator) {
      const res = await rateLimiter.consume(`chat-slow:${channel.id}:${actor.userId}`, { window: channel.slowModeSeconds, max: 1 });
      if (!res.allowed) throw new GcsRateLimited({ retryAfter: String(res.retryAfter), reason: "slow_mode" });
    }
    const flood = await permissions.groupValue<number | boolean>(actor, "chat.flood_seconds");
    if (typeof flood === "number" && flood > 0) {
      const res = await rateLimiter.consume(`chat:${actor.userId}`, { window: flood, max: 1 });
      if (!res.allowed) throw new GcsRateLimited({ retryAfter: String(res.retryAfter) });
    }

    const words = await settings.get<string[]>("chat.word_filter");
    const filtered = applyWordFilter(body, Array.isArray(words) ? words : []);
    const message = await db.chatMessage.create({
      data: { channelId: channel.id, authorId: actor.userId, body: filtered },
      include: { author: { select: userRefSelect } },
    });
    const view = toChatView(message, channel.key);
    await bus.emit({ name: "chat.message", payload: { channelKey: channel.key, messageId: message.id, authorId: actor.userId }, tags: [`chat:${channel.key}`] });
    await realtime.publish(`chat:${channel.key}`, "message", view);
    return view;
  }

  /** Ștergere (moderator): mesajul rămâne în bază, ascuns, și dispare live din canal. */
  async delete(actor: GcsActor, messageId: number): Promise<void> {
    const { db, bus, realtime } = this.deps;
    await this.assertModerator(actor);
    const message = await db.chatMessage.findUnique({ where: { id: messageId }, include: { channel: { select: { key: true } } } });
    if (!message || message.deletedAt) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), deletedById: actor.userId } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "chat.message.delete",
        targetType: "chat_message",
        targetId: String(messageId),
        before: { channel: message.channel.key, authorId: message.authorId, body: message.body },
        ip: actor.ip,
      });
    });
    await bus.emit({ name: "chat.deleted", payload: { channelKey: message.channel.key, messageId }, tags: [`chat:${message.channel.key}`] });
    await realtime.publish(`chat:${message.channel.key}`, "deleted", { id: messageId });
  }

  /** Mute pe un canal (`channelKey`) sau pe toate (`null`); `minutes: null` = permanent. */
  async mute(actor: GcsActor, userId: string, input: { channelKey: string | null; minutes: number | null; reason: string }): Promise<{ id: number }> {
    const { db, permissions } = this.deps;
    await this.assertModerator(actor);
    if (userId === actor.userId) throw new GcsValidationError({ userId: "self" });
    const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, primaryGroupId: true, groups: { select: { groupId: true } } } });
    if (!target) throw new GcsNotFound();
    // Un moderator nu poate da mute altui membru al staff-ului.
    const targetActor: GcsActor = { userId, groupIds: [target.primaryGroupId, ...target.groups.map((g) => g.groupId)], primaryGroupId: target.primaryGroupId, isBanned: false, ip: "" };
    if (await permissions.can(targetActor, "chat.moderate")) throw new GcsForbidden({ reason: "target_is_staff" });
    if (input.minutes !== null && (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 525_600)) {
      throw new GcsValidationError({ minutes: "invalid_range" });
    }
    const channel = input.channelKey === null ? null : await this.channel(input.channelKey);
    const reason = input.reason.trim().slice(0, 200);
    const until = input.minutes === null ? null : new Date(Date.now() + input.minutes * 60_000);
    const mute = await db.$transaction(async (tx) => {
      const row = await tx.chatMute.create({ data: { userId, channelId: channel?.id ?? null, until, reason, createdById: actor.userId } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.mute", targetType: "user", targetId: userId, after: { channel: channel?.key ?? null, until, reason }, ip: actor.ip });
      return row;
    });
    await this.deps.bus.emit({ name: "chat.muted", payload: { userId, channelKey: channel?.key ?? null }, tags: [`user:${userId}`] });
    return { id: mute.id };
  }

  async unmute(actor: GcsActor, muteId: number): Promise<void> {
    const { db } = this.deps;
    await this.assertModerator(actor);
    const mute = await db.chatMute.findUnique({ where: { id: muteId } });
    if (!mute) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.chatMute.delete({ where: { id: muteId } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.unmute", targetType: "user", targetId: mute.userId, before: mute, ip: actor.ip });
    });
  }

  async setSlowMode(actor: GcsActor, key: string, seconds: number): Promise<void> {
    await this.assertModerator(actor);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_SLOW_MODE) throw new GcsValidationError({ slowModeSeconds: "invalid_range" });
    const channel = await this.channel(key);
    await this.deps.db.$transaction(async (tx) => {
      await tx.chatChannel.update({ where: { id: channel.id }, data: { slowModeSeconds: seconds } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.slow_mode", targetType: "chat_channel", targetId: channel.key, before: { slowModeSeconds: channel.slowModeSeconds }, after: { slowModeSeconds: seconds }, ip: actor.ip });
    });
    await this.deps.realtime.publish(`chat:${channel.key}`, "channel", { slowModeSeconds: seconds });
  }

  // ─── Canale (ACP) ─────────────────────────────────────────────────────────

  private validate(input: Partial<GcsChatChannelInput>): void {
    const errors: Record<string, string> = {};
    if (input.key !== undefined && !KEY_RE.test(input.key)) errors.key = "invalid_key";
    if (input.name !== undefined && (input.name.trim().length < 1 || input.name.trim().length > 50)) errors.name = "invalid_length";
    if (input.description !== undefined && input.description.length > 200) errors.description = "too_long";
    if (input.slowModeSeconds !== undefined && (!Number.isInteger(input.slowModeSeconds) || input.slowModeSeconds < 0 || input.slowModeSeconds > MAX_SLOW_MODE)) {
      errors.slowModeSeconds = "invalid_range";
    }
    if (input.retentionDays !== undefined && (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > MAX_RETENTION)) {
      errors.retentionDays = "invalid_range";
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
  }

  async createChannel(actor: GcsActor, input: GcsChatChannelInput): Promise<ChatChannel> {
    const { db, acp, permissions } = this.deps;
    await acp.assert(actor, CHAT_ACP_CHANNELS, "edit");
    this.validate(input);
    if (await db.chatChannel.findUnique({ where: { key: input.key } })) throw new GcsValidationError({ key: "taken" });
    const channel = await db.$transaction(async (tx) => {
      const last = await tx.chatChannel.findFirst({ orderBy: { position: "desc" } });
      const row = await tx.chatChannel.create({
        data: {
          key: input.key,
          name: input.name.trim(),
          description: input.description?.trim() ?? "",
          slowModeSeconds: input.slowModeSeconds ?? 0,
          retentionDays: input.retentionDays ?? 7,
          enabled: input.enabled ?? true,
          showOnHome: input.showOnHome ?? false,
          position: last ? last.position + 1 : 0,
        },
      });
      const groups = new Map((await tx.group.findMany({ select: { id: true, key: true } })).map((g) => [g.key, g.id]));
      await tx.containerPermission.createMany({ data: defaultChannelPermissions(groups, row.key), skipDuplicates: true });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.channel.create", targetType: "chat_channel", targetId: row.key, after: row, ip: actor.ip });
      return row;
    });
    await permissions.bumpVersion();
    return channel;
  }

  /** Cheia nu se schimbă (e id-ul containerului de permisiuni). */
  async updateChannel(actor: GcsActor, key: string, patch: Partial<Omit<GcsChatChannelInput, "key">>): Promise<ChatChannel> {
    const { db, acp, realtime } = this.deps;
    await acp.assert(actor, CHAT_ACP_CHANNELS, "edit");
    this.validate(patch);
    const before = await db.chatChannel.findUnique({ where: { key } });
    if (!before) throw new GcsNotFound();
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.chatChannel.update({
        where: { key },
        data: {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
          ...(patch.slowModeSeconds !== undefined ? { slowModeSeconds: patch.slowModeSeconds } : {}),
          ...(patch.retentionDays !== undefined ? { retentionDays: patch.retentionDays } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.showOnHome !== undefined ? { showOnHome: patch.showOnHome } : {}),
        },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.channel.update", targetType: "chat_channel", targetId: key, before, after: row, ip: actor.ip });
      return row;
    });
    await realtime.publish(`chat:${key}`, "channel", { slowModeSeconds: updated.slowModeSeconds, enabled: updated.enabled });
    return updated;
  }

  async deleteChannel(actor: GcsActor, key: string): Promise<void> {
    const { db, acp, permissions } = this.deps;
    await acp.assert(actor, CHAT_ACP_CHANNELS, "delete");
    const channel = await db.chatChannel.findUnique({ where: { key } });
    if (!channel) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.chatChannel.delete({ where: { id: channel.id } });
      await tx.containerPermission.deleteMany({ where: { containerType: CHAT_CONTAINER, containerId: key } });
      await tx.containerInherit.deleteMany({ where: { containerType: CHAT_CONTAINER, containerId: key } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.channel.delete", targetType: "chat_channel", targetId: key, before: channel, ip: actor.ip });
    });
    await permissions.bumpVersion();
  }

  async reorderChannels(actor: GcsActor, keys: string[]): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CHAT_ACP_CHANNELS, "edit");
    const all = await db.chatChannel.findMany({ select: { key: true } });
    if (keys.length !== all.length || new Set(keys).size !== keys.length || !all.every((c) => keys.includes(c.key))) {
      throw new GcsValidationError({ order: "incomplete" });
    }
    await db.$transaction(keys.map((key, position) => db.chatChannel.update({ where: { key }, data: { position } })));
  }

  /** Retenția: șterge mesajele mai vechi decât `retentionDays` al canalului lor (job zilnic). */
  async cleanup(now = new Date()): Promise<number> {
    const { db } = this.deps;
    let removed = 0;
    for (const channel of await db.chatChannel.findMany({ select: { id: true, retentionDays: true } })) {
      const { count } = await db.chatMessage.deleteMany({
        where: { channelId: channel.id, createdAt: { lt: new Date(now.getTime() - channel.retentionDays * 86_400_000) } },
      });
      removed += count;
    }
    // Mute-urile expirate nu mai contează.
    await db.chatMute.deleteMany({ where: { until: { lt: now } } });
    return removed;
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({ name: CHAT_CLEANUP_JOB, everyMs: 24 * 3600_000, handler: async () => void (await this.cleanup()) });
  }
}
