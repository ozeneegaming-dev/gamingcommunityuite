import {
  GCS_RICH_FIELDS,
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  richFieldHtml,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsAttachmentService,
  type GcsEventBus,
  type GcsJobQueue,
  type GcsPermissionService,
  type GcsRealtime,
  type GcsRedisRateLimiter,
  type GcsSettingsService,
} from "@gcs/core";
import { normalizeUsername } from "@gcs/core";
import type { ChatChannel, ChatRoomType, Prisma, PrismaClient } from "@gcs/db";
import type { GcsChatProMessage } from "../chat-pro/types";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { GcsChatExtensions } from "./extensions";
import { CHAT_ACP_CHANNELS, CHAT_CONTAINER, defaultChannelPermissions } from "./index";
import { applyWordFilter, chatEmbeds, cleanChatText, countEmoji, renderChatText, type GcsChatEmbed } from "./text";

export const CHAT_CLEANUP_JOB = "chat.cleanup";
const KEY_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const MAX_SLOW_MODE = 3600;
const MAX_RETENTION = 365;
/** Autorul își poate edita mesajul 5 minute (specul etapei 5). */
export const CHAT_EDIT_WINDOW_MS = 5 * 60_000;
const MAX_OWNED_ROOMS = 10;
const MAX_INVITES = 50;
const MAX_MENTIONS = 10;
const MENTION_RE = /(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.-]{2,40})/gu;
/** Atașamentele mesajelor de chat (imagini și mesaje vocale). */
export const CHAT_FILE_CONTENT_TYPE = "chat.message";
const MAX_FILES = 4;

export type GcsChatReactionCount = { reactionId: number; count: number };
/** Un fișier al mesajului: imagine sau mesaj vocal (`/files/{id}`). */
export type GcsChatFile = { id: string; kind: "image" | "audio"; width: number | null; height: number | null };
/** Setările de afișare și limitele chat-ului, trimise clientului (fără cheia GIPHY). */
export type GcsChatConfig = {
  timeFormat: "24h" | "12h";
  newestOnTop: boolean;
  /** Regulile, ca HTML sanitizat (formatate în editor sau textul vechi ca paragrafe); `""` = fără butonul „Reguli”. */
  rulesHtml: string;
  hideAvatars: boolean;
  minHeight: number;
  hideEnterMobile: boolean;
  pageSize: number;
  pollSeconds: number;
  maxLength: number;
  maxEmoticons: number;
  allowImages: boolean;
  allowYoutube: boolean;
  giphy: boolean;
  voice: boolean;
  voiceMaxSeconds: number;
};
export type GcsChatMessageView = {
  id: number;
  channel: string;
  author: GcsUserRef | null;
  body: string;
  html: string;
  createdAt: string;
  editedAt: string | null;
  reactions: GcsChatReactionCount[];
  /** Reacțiile viewer-ului la mesaj. */
  mine: number[];
  files: GcsChatFile[];
  /** Imaginile și clipurile YouTube din linkuri (afișate după setări). */
  embeds: GcsChatEmbed[];
  /** Mesajul la care răspunde (Chat Pro); `null` = niciunul sau șters. */
  replyToId: number | null;
  /** Datele adăugate de Chat Pro (porecla, insignele, citatul, rezultatul unei comenzi); lipsesc în chat-ul standard. */
  pro?: GcsChatProMessage;
};
export type GcsChatRoomInput = { name: string; type: ChatRoomType; invite?: string[] };
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

type ChatMessageRow = {
  id: number;
  body: string;
  createdAt: Date;
  editedAt?: Date | null;
  author: Parameters<typeof toRef>[0] | null;
  reactions?: { userId: string; reactionId: number }[];
  files?: unknown;
  replyToId?: number | null;
};

const isChatFile = (f: unknown): f is GcsChatFile =>
  typeof f === "object" && f !== null && typeof (f as GcsChatFile).id === "string" && ((f as GcsChatFile).kind === "image" || (f as GcsChatFile).kind === "audio");

/** Reacțiile unui mesaj, numărate pe tip (ordinea primei apariții). */
function countReactions(rows: { reactionId: number }[]): GcsChatReactionCount[] {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.reactionId, (counts.get(r.reactionId) ?? 0) + 1);
  return [...counts].map(([reactionId, count]) => ({ reactionId, count }));
}

export function toChatView(m: ChatMessageRow, channel: string, viewerId: string | null = null): GcsChatMessageView {
  const reactions = m.reactions ?? [];
  return {
    id: m.id,
    channel,
    author: m.author ? toRef(m.author) : null,
    body: m.body,
    html: renderChatText(m.body),
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    reactions: countReactions(reactions),
    mine: viewerId ? reactions.filter((r) => r.userId === viewerId).map((r) => r.reactionId) : [],
    files: Array.isArray(m.files) ? m.files.filter(isChatFile) : [],
    embeds: chatEmbeds(m.body),
    replyToId: m.replyToId ?? null,
  };
}

/** Cheia unei camere create de un membru: din nume, plus un sufix aleator (unică). */
function roomKey(name: string): string {
  const base = normalizeUsername(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return `${base || "camera"}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ultimele reguli randate: `config()` se cere la fiecare încărcare a chat-ului, iar setarea se schimbă rar. */
let rulesMemo: { key: string; html: string } | null = null;

/** HTML-ul regulilor (documentul din editor sau textul vechi, convertit la citire: un paragraf pe rând). */
function rulesHtml(value: unknown): string {
  const key = JSON.stringify(value ?? "");
  if (rulesMemo?.key !== key) rulesMemo = { key, html: richFieldHtml(value, GCS_RICH_FIELDS.chatRules) };
  return rulesMemo.html;
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
      /** Imaginile și mesajele vocale (opțional în testele care nu le folosesc). */
      attachments?: GcsAttachmentService;
      /** Punctele de extensie (Chat Pro); fără ele, chat-ul standard. */
      extensions?: GcsChatExtensions;
    },
  ) {
    deps.attachments?.registerAccess(CHAT_FILE_CONTENT_TYPE, (actor, id) => this.canReadMessage(actor, Number(id)));
  }

  /** Fișierul unui mesaj se descarcă doar de cine poate citi camera mesajului. */
  private async canReadMessage(actor: GcsActor, messageId: number): Promise<boolean> {
    if (!Number.isInteger(messageId)) return false;
    const message = await this.deps.db.chatMessage.findUnique({ where: { id: messageId }, select: { deletedAt: true, channel: { select: { key: true } } } });
    if (!message || message.deletedAt) return false;
    return this.accessible(actor, message.channel.key).then(
      () => true,
      () => false,
    );
  }

  /** Setările chat-ului pentru client (cheia GIPHY rămâne pe server). */
  async config(): Promise<GcsChatConfig> {
    const s = this.deps.settings;
    const [timeFormat, newestOnTop, showRules, rules, hideAvatars, minHeight, hideEnterMobile, pageSize, pollSeconds, maxLength, maxEmoticons, allowImages, allowYoutube, giphyKey, voice, voiceMaxSeconds] =
      await Promise.all([
        s.get<string>("chat.time_format"),
        s.get<boolean>("chat.newest_on_top"),
        s.get<boolean>("chat.show_rules"),
        s.get<unknown>("chat.rules"),
        s.get<boolean>("chat.hide_avatars"),
        s.get<number>("chat.min_height"),
        s.get<boolean>("chat.hide_enter_mobile"),
        s.get<number>("chat.messages_to_display"),
        s.get<number>("chat.poll_interval"),
        s.get<number>("chat.max_length"),
        s.get<number>("chat.max_emoticons"),
        s.get<boolean>("chat.allow_images"),
        s.get<boolean>("chat.allow_youtube"),
        s.get<string>("chat.giphy_key"),
        s.get<boolean>("chat.voice_enabled"),
        s.get<number>("chat.voice_max_seconds"),
      ]);
    return {
      timeFormat: timeFormat === "12h" ? "12h" : "24h",
      newestOnTop,
      // Linkul „Reguli” se poate ascunde din ACP fără să se piardă textul.
      rulesHtml: showRules === false ? "" : rulesHtml(rules),
      hideAvatars,
      minHeight,
      hideEnterMobile,
      pageSize,
      pollSeconds,
      maxLength,
      maxEmoticons,
      allowImages,
      allowYoutube,
      giphy: typeof giphyKey === "string" && giphyKey.trim() !== "",
      voice: voice && this.deps.attachments !== undefined,
      voiceMaxSeconds,
    };
  }

  /** Cheia GIPHY (secretă), sau `null` dacă nu e setată. */
  async giphyKey(): Promise<string | null> {
    const key = await this.deps.settings.get<string>("chat.giphy_key");
    return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
  }

  /** Limitele configurabile ale textului: numărul de caractere și de emoticoane. */
  private async checkLimits(body: string): Promise<void> {
    const [maxLength, maxEmoticons] = await Promise.all([this.deps.settings.get<number>("chat.max_length"), this.deps.settings.get<number>("chat.max_emoticons")]);
    if (maxLength > 0 && [...body].length > maxLength) throw new GcsValidationError({ body: "too_long" }, { max: String(maxLength) });
    if (maxEmoticons > 0 && countEmoji(body) > maxEmoticons) throw new GcsValidationError({ body: "too_many_emoticons" }, { max: String(maxEmoticons) });
  }

  private async channel(key: string): Promise<ChatChannel> {
    const channel = typeof key === "string" ? await this.deps.db.chatChannel.findUnique({ where: { key } }) : null;
    if (!channel || !channel.enabled) throw new GcsNotFound();
    return channel;
  }

  /** Camera e accesibilă actorului (la cele private: doar membrii); altfel „nu există”. */
  private async accessible(actor: GcsActor, key: string): Promise<ChatChannel> {
    const channel = await this.channel(key);
    if (channel.type === "PRIVATE") {
      const member = actor.userId ? await this.deps.db.chatRoomMember.findUnique({ where: { channelId_userId: { channelId: channel.id, userId: actor.userId } } }) : null;
      if (!member) throw new GcsNotFound();
    }
    if (actor.isBanned || !(await this.deps.permissions.can(actor, "chat.read", chatContainer(channel.key)))) throw new GcsForbidden({ permission: "chat.read" });
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

  /** Extensiile chat-ului (Chat Pro le înregistrează aici). */
  get extensions(): GcsChatExtensions {
    return (this.deps.extensions ??= new GcsChatExtensions());
  }

  /**
   * Trimite un mesaj: text și/sau fișiere încărcate înainte (imagini, mesaje vocale; cel mult 4, doar ale autorului,
   * încă nelegate). Imaginile cer `chat.allow_images`, vocea `chat.voice_enabled`. `replyTo`: un mesaj al aceleiași
   * camere (răspunsul citat din Chat Pro).
   */
  async send(actor: GcsActor, key: string, raw: unknown, opts: { files?: string[]; replyTo?: number | null } = {}): Promise<GcsChatMessageView> {
    const { db, bus, permissions, settings, rateLimiter, realtime } = this.deps;
    const channel = await this.accessible(actor, key);
    if (!actor.userId || actor.isBanned || !(await permissions.can(actor, "chat.write", chatContainer(channel.key)))) {
      throw new GcsForbidden({ permission: "chat.write" });
    }
    const body = cleanChatText(typeof raw === "string" ? raw : "");
    const fileIds = [...new Set(opts.files ?? [])];
    if (!body && fileIds.length === 0) throw new GcsValidationError({ body: "required" });
    if (fileIds.length > MAX_FILES) throw new GcsValidationError({ files: "too_many" }, { max: String(MAX_FILES) });
    if (fileIds.length > 0 && !this.deps.attachments) throw new GcsValidationError({ files: "unsupported_type" });
    await this.checkLimits(body);
    // Fișierele și mesajul citat se verifică înainte de flood: o încercare invalidă nu consumă mesajul permis.
    const files = fileIds.length > 0 ? await this.chatFiles(actor.userId, fileIds) : [];
    const replyToId = opts.replyTo ? await this.replyTarget(channel.id, opts.replyTo) : null;
    const mute = await this.activeMute(actor.userId, channel.id);
    if (mute) throw new GcsForbidden({ reason: "muted", ...(mute.until ? { until: mute.until.toISOString() } : {}) });

    const moderator = await this.canModerate(actor);
    if (channel.slowModeSeconds > 0 && !moderator) {
      const res = await rateLimiter.consume(`chat-slow:${channel.id}:${actor.userId}`, { window: channel.slowModeSeconds, max: 1 });
      if (!res.allowed) throw new GcsRateLimited({ retryAfter: String(res.retryAfter), reason: "slow_mode" });
    }
    // Flood control: valoarea mai strictă dintre setarea din ACP și permisiunea grupului; moderatorii trec peste.
    if (!moderator) {
      const [group, global] = await Promise.all([permissions.groupValue<number | boolean>(actor, "chat.flood_seconds"), settings.get<number>("chat.flood_seconds")]);
      const flood = Math.max(typeof group === "number" ? group : 0, typeof global === "number" ? global : 0);
      if (flood > 0) {
        const res = await rateLimiter.consume(`chat:${actor.userId}`, { window: flood, max: 1 });
        if (!res.allowed) throw new GcsRateLimited({ retryAfter: String(res.retryAfter) });
      }
    }

    // Extensiile (Chat Pro): comenzile își scriu rezultatul în locul textului, datele lor rămân în `meta`.
    const patch = await this.extensions.beforeSend({ actor, channel, body, files: fileIds.length, replyToId });
    const words = await settings.get<string[]>("chat.word_filter");
    const filtered = applyWordFilter(patch.body ?? body, Array.isArray(words) ? words : []);
    const authorId = actor.userId;
    const meta = patch.meta ?? null;
    const message = await db.$transaction(async (tx) => {
      const row = await tx.chatMessage.create({
        data: { channelId: channel.id, authorId, body: filtered, files, replyToId, ...(meta ? { meta: meta as Prisma.InputJsonValue } : {}) },
        include: { author: { select: userRefSelect } },
      });
      if (files.length > 0) await this.deps.attachments!.attach(tx, fileIds, { contentType: CHAT_FILE_CONTENT_TYPE, contentId: String(row.id), ownerId: authorId });
      return row;
    });
    await this.extensions.afterSend({ actor, channel, messageId: message.id, body: filtered, meta, replyToId, createdAt: message.createdAt });
    const [view] = await this.extensions.decorate([toChatView(message, channel.key)]);
    await bus.emit({
      name: "chat.message",
      payload: { channelKey: channel.key, messageId: message.id, authorId: actor.userId, ...(meta?.bot ? { bot: true } : {}) },
      tags: [`chat:${channel.key}`],
    });
    await realtime.publish(`chat:${channel.key}`, "message", view);
    await this.mentions(channel, message.id, actor.userId, filtered);
    return view!;
  }

  /** Mesajul citat: din aceeași cameră, neșters; altfel o eroare pe câmpul `replyTo`. */
  private async replyTarget(channelId: number, id: number): Promise<number> {
    const target = Number.isInteger(id) ? await this.deps.db.chatMessage.findUnique({ where: { id }, select: { channelId: true, deletedAt: true } }) : null;
    if (!target || target.deletedAt || target.channelId !== channelId) throw new GcsValidationError({ replyTo: "invalid" });
    return id;
  }

  /** Fișierele de trimis: ale autorului, încă nelegate, imagini (dacă sunt permise) sau audio (dacă vocea e pornită). */
  private async chatFiles(ownerId: string, ids: string[]): Promise<GcsChatFile[]> {
    const { db, settings } = this.deps;
    const rows = await db.attachment.findMany({ where: { id: { in: ids } }, select: { id: true, ownerId: true, contentType: true, mime: true, width: true, height: true } });
    if (rows.length !== ids.length || rows.some((r) => r.ownerId !== ownerId || r.contentType !== null)) throw new GcsForbidden({ reason: "attachment" });
    const [images, voice] = await Promise.all([settings.get<boolean>("chat.allow_images"), settings.get<boolean>("chat.voice_enabled")]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => {
      const r = byId.get(id)!;
      const kind = r.mime.startsWith("image/") ? "image" : r.mime.startsWith("audio/") || r.mime === "video/webm" ? "audio" : null;
      if (kind === null || (kind === "image" && !images) || (kind === "audio" && !voice)) throw new GcsValidationError({ files: "unsupported_type" });
      return { id, kind, width: r.width, height: r.height };
    });
  }

  /**
   * Mențiunile `@nume` dintr-un mesaj: cei menționați care pot citi camera primesc notificarea `chat.mention`
   * (evenimentul îl transformă în notificare `registerChatNotifications`). Cel mult 10 pe mesaj.
   */
  private async mentions(channel: ChatChannel, messageId: number, authorId: string, body: string): Promise<void> {
    const names = [...new Set([...body.matchAll(MENTION_RE)].map((m) => normalizeUsername(m[1]!)))].slice(0, MAX_MENTIONS);
    if (names.length === 0) return;
    const users = await this.deps.db.user.findMany({ where: { nameNormalized: { in: names }, id: { not: authorId } }, select: { id: true } });
    if (users.length === 0) return;
    await this.deps.bus.emit({ name: "chat.mention", payload: { channelKey: channel.key, messageId, authorId, userIds: users.map((u) => u.id) }, tags: [] });
  }

  /** Editarea propriului mesaj, în 5 minute; mesajul e marcat „editat”. */
  async edit(actor: GcsActor, messageId: number, raw: unknown, now = Date.now()): Promise<GcsChatMessageView> {
    const { db, settings, realtime } = this.deps;
    const message = await db.chatMessage.findUnique({ where: { id: messageId }, include: { channel: { select: { key: true } } } });
    if (!message || message.deletedAt) throw new GcsNotFound();
    if (!actor.userId || message.authorId !== actor.userId || actor.isBanned) throw new GcsForbidden({ reason: "not_author" });
    if (now - message.createdAt.getTime() > CHAT_EDIT_WINDOW_MS) throw new GcsForbidden({ reason: "edit_window" });
    const channel = await this.accessible(actor, message.channel.key);
    const mute = await this.activeMute(actor.userId, channel.id);
    if (mute) throw new GcsForbidden({ reason: "muted" });
    const body = cleanChatText(typeof raw === "string" ? raw : "");
    if (!body && !(Array.isArray(message.files) && message.files.length > 0)) throw new GcsValidationError({ body: "required" });
    await this.checkLimits(body);
    const words = await settings.get<string[]>("chat.word_filter");
    const updated = await db.chatMessage.update({
      where: { id: messageId },
      data: { body: applyWordFilter(body, Array.isArray(words) ? words : []), editedAt: new Date(now) },
      include: { author: { select: userRefSelect }, reactions: { select: { userId: true, reactionId: true } } },
    });
    const [view] = await this.extensions.decorate([toChatView(updated, channel.key)]);
    await realtime.publish(`chat:${channel.key}`, "edited", view);
    return view!;
  }

  /** Reacție la un mesaj (setul de reacții al forumului): a doua apăsare o retrage; unică pe user și reacție. */
  async react(actor: GcsActor, messageId: number, reactionId: number): Promise<GcsChatReactionCount[]> {
    const { db, realtime } = this.deps;
    if (!actor.userId || actor.isBanned) throw new GcsForbidden({ reason: "guest" });
    const message = await db.chatMessage.findUnique({ where: { id: messageId }, include: { channel: { select: { key: true } } } });
    if (!message || message.deletedAt) throw new GcsNotFound();
    await this.accessible(actor, message.channel.key);
    const reaction = Number.isInteger(reactionId) ? await db.reaction.findFirst({ where: { id: reactionId, enabled: true }, select: { id: true } }) : null;
    if (!reaction) throw new GcsValidationError({ reactionId: "invalid_choice" });
    const where = { messageId_userId_reactionId: { messageId, userId: actor.userId, reactionId } };
    const existing = await db.chatMessageReaction.findUnique({ where });
    if (existing) await db.chatMessageReaction.delete({ where });
    else await db.chatMessageReaction.create({ data: { messageId, userId: actor.userId, reactionId } }).catch(() => undefined);
    const reactions = countReactions(await db.chatMessageReaction.findMany({ where: { messageId }, orderBy: { createdAt: "asc" }, select: { reactionId: true } }));
    await realtime.publish(`chat:${message.channel.key}`, "reactions", { id: messageId, reactions });
    return reactions;
  }

  // ─── Anunțuri (staff: `chat.announce`) ─────────────────────────────────────

  private async assertAnnouncer(actor: GcsActor): Promise<void> {
    if (!actor.userId || actor.isBanned || !(await this.deps.permissions.can(actor, "chat.announce"))) throw new GcsForbidden({ permission: "chat.announce" });
  }

  /** Fixează un mesaj al camerei (sau scoate fixarea cu `null`). */
  async pin(actor: GcsActor, key: string, messageId: number | null): Promise<void> {
    const { db, realtime } = this.deps;
    await this.assertAnnouncer(actor);
    const channel = await this.accessible(actor, key);
    let pinned: GcsChatMessageView | null = null;
    if (messageId !== null) {
      const message = await db.chatMessage.findUnique({ where: { id: messageId }, include: { author: { select: userRefSelect } } });
      if (!message || message.deletedAt || message.channelId !== channel.id) throw new GcsNotFound();
      [pinned = null] = await this.extensions.decorate([toChatView(message, channel.key)]);
    }
    await db.$transaction(async (tx) => {
      await tx.chatChannel.update({ where: { id: channel.id }, data: { pinnedMessageId: messageId } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.pin", targetType: "chat_channel", targetId: channel.key, after: { messageId }, ip: actor.ip });
    });
    await realtime.publish(`chat:${channel.key}`, "pinned", { channel: channel.key, message: pinned });
  }

  /** Anunț global, afișat în toate camerele (`minutes: null` = până la ștergere). */
  async announce(actor: GcsActor, raw: unknown, minutes: number | null): Promise<{ id: number }> {
    const { db, realtime } = this.deps;
    await this.assertAnnouncer(actor);
    const body = cleanChatText(typeof raw === "string" ? raw : "");
    if (!body) throw new GcsValidationError({ body: "required" });
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 525_600)) throw new GcsValidationError({ minutes: "invalid_range" });
    const expiresAt = minutes === null ? null : new Date(Date.now() + minutes * 60_000);
    const row = await db.$transaction(async (tx) => {
      const a = await tx.chatAnnouncement.create({ data: { body, createdById: actor.userId, expiresAt } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.announce", targetType: "chat_announcement", targetId: String(a.id), after: { body, expiresAt }, ip: actor.ip });
      return a;
    });
    const view = { id: row.id, body: row.body, expiresAt: row.expiresAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
    for (const c of await db.chatChannel.findMany({ where: { enabled: true }, select: { key: true } })) {
      await realtime.publish(`chat:${c.key}`, "announcement", view);
    }
    return { id: row.id };
  }

  async removeAnnouncement(actor: GcsActor, id: number): Promise<void> {
    const { db, realtime } = this.deps;
    await this.assertAnnouncer(actor);
    const before = await db.chatAnnouncement.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.chatAnnouncement.delete({ where: { id } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.announcement.delete", targetType: "chat_announcement", targetId: String(id), before, ip: actor.ip });
    });
    for (const c of await db.chatChannel.findMany({ where: { enabled: true }, select: { key: true } })) {
      await realtime.publish(`chat:${c.key}`, "announcement:removed", { id });
    }
  }

  // ─── Camerele membrilor (etapa 5) ──────────────────────────────────────────

  /**
   * O cameră nouă: publică cere `chat.create_public`, privată `chat.create_private` (pe grup sau individual).
   * Creatorul e proprietarul; la o cameră privată, el și invitații sunt singurii membri.
   */
  async createRoom(actor: GcsActor, input: GcsChatRoomInput): Promise<ChatChannel> {
    const { db, permissions } = this.deps;
    if (input.type !== "PUBLIC" && input.type !== "PRIVATE") throw new GcsValidationError({ type: "invalid_choice" });
    const permission = input.type === "PUBLIC" ? "chat.create_public" : "chat.create_private";
    if (!actor.userId || actor.isBanned || !(await permissions.can(actor, permission))) throw new GcsForbidden({ permission });
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 2 || name.length > 50) throw new GcsValidationError({ name: "invalid_length" });
    if ((await db.chatChannel.count({ where: { ownerId: actor.userId } })) >= MAX_OWNED_ROOMS) throw new GcsValidationError({ name: "too_many" });
    const invited = await this.inviteIds(actor.userId, input.invite ?? []);
    const channel = await db.$transaction(async (tx) => {
      const last = await tx.chatChannel.findFirst({ orderBy: { position: "desc" } });
      const row = await tx.chatChannel.create({
        data: { key: roomKey(name), name, type: input.type, ownerId: actor.userId, position: last ? last.position + 1 : 0, retentionDays: 30 },
      });
      const groups = new Map((await tx.group.findMany({ select: { id: true, key: true } })).map((g) => [g.key, g.id]));
      await tx.containerPermission.createMany({ data: defaultChannelPermissions(groups, row.key), skipDuplicates: true });
      if (input.type === "PRIVATE") {
        await tx.chatRoomMember.createMany({
          data: [{ channelId: row.id, userId: actor.userId! }, ...invited.map((userId) => ({ channelId: row.id, userId, invitedById: actor.userId }))],
          skipDuplicates: true,
        });
      }
      await writeAudit(tx, { actorId: actor.userId, action: "chat.room.create", targetType: "chat_channel", targetId: row.key, after: { name, type: input.type, invited }, ip: actor.ip });
      return row;
    });
    await permissions.bumpVersion();
    return channel;
  }

  /** Id-urile invitaților (după id sau nume), fără creator și fără conturi inexistente. */
  private async inviteIds(ownerId: string, raw: string[]): Promise<string[]> {
    const wanted = [...new Set(raw.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()))].slice(0, MAX_INVITES);
    if (wanted.length === 0) return [];
    const rows = await this.deps.db.user.findMany({
      where: { OR: [{ id: { in: wanted } }, { nameNormalized: { in: wanted.map(normalizeUsername) } }], NOT: { id: ownerId } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Proprietarul camerei sau staff-ul de chat. Camerele din ACP (fără proprietar) se administrează doar din ACP. */
  private async assertRoomManager(actor: GcsActor, key: string): Promise<ChatChannel> {
    const channel = await this.accessible(actor, key);
    if (!channel.ownerId) throw new GcsForbidden({ reason: "acp_channel" });
    if (channel.ownerId !== actor.userId && !(await this.canModerate(actor))) throw new GcsForbidden({ reason: "not_owner" });
    return channel;
  }

  async invite(actor: GcsActor, key: string, users: string[]): Promise<number> {
    const { db, realtime } = this.deps;
    const channel = await this.assertRoomManager(actor, key);
    if (channel.type !== "PRIVATE") throw new GcsValidationError({ type: "not_private" });
    const ids = await this.inviteIds(channel.ownerId!, users);
    const { count } = await db.chatRoomMember.createMany({ data: ids.map((userId) => ({ channelId: channel.id, userId, invitedById: actor.userId })), skipDuplicates: true });
    await writeAudit(db, { actorId: actor.userId, action: "chat.room.invite", targetType: "chat_channel", targetId: channel.key, after: { users: ids }, ip: actor.ip });
    await realtime.publish(`chat:${channel.key}`, "members", { channel: channel.key });
    return count;
  }

  /** Un membru iese dintr-o cameră privată (proprietarul o șterge, nu iese). */
  async leave(actor: GcsActor, key: string): Promise<void> {
    const { db, realtime } = this.deps;
    const channel = await this.accessible(actor, key);
    if (channel.type !== "PRIVATE") throw new GcsValidationError({ type: "not_private" });
    if (channel.ownerId === actor.userId) throw new GcsValidationError({ owner: "delete_instead" });
    await db.chatRoomMember.deleteMany({ where: { channelId: channel.id, userId: actor.userId! } });
    await realtime.publish(`chat:${channel.key}`, "members", { channel: channel.key });
  }

  async rename(actor: GcsActor, key: string, rawName: string): Promise<void> {
    const { db, realtime } = this.deps;
    const channel = await this.assertRoomManager(actor, key);
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (name.length < 2 || name.length > 50) throw new GcsValidationError({ name: "invalid_length" });
    await db.$transaction(async (tx) => {
      await tx.chatChannel.update({ where: { id: channel.id }, data: { name } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.room.rename", targetType: "chat_channel", targetId: channel.key, before: { name: channel.name }, after: { name }, ip: actor.ip });
    });
    await realtime.publish(`chat:${channel.key}`, "channel", { name });
  }

  async deleteRoom(actor: GcsActor, key: string): Promise<void> {
    const { db, permissions, realtime } = this.deps;
    const channel = await this.assertRoomManager(actor, key);
    await db.$transaction(async (tx) => {
      await tx.chatChannel.delete({ where: { id: channel.id } });
      await tx.containerPermission.deleteMany({ where: { containerType: CHAT_CONTAINER, containerId: channel.key } });
      await tx.containerInherit.deleteMany({ where: { containerType: CHAT_CONTAINER, containerId: channel.key } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.room.delete", targetType: "chat_channel", targetId: channel.key, before: channel, ip: actor.ip });
    });
    await permissions.bumpVersion();
    await realtime.publish(`chat:${channel.key}`, "channel", { enabled: false, deleted: true });
  }

  /** Ștergere (moderatorul sau autorul): mesajul rămâne în bază, ascuns, și dispare live din canal. */
  async delete(actor: GcsActor, messageId: number): Promise<void> {
    const { db, bus, realtime } = this.deps;
    const message = Number.isInteger(messageId) ? await db.chatMessage.findUnique({ where: { id: messageId }, include: { channel: { select: { key: true } } } }) : null;
    const own = message !== null && actor.userId !== null && !actor.isBanned && message.authorId === actor.userId;
    if (!own) await this.assertModerator(actor);
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
