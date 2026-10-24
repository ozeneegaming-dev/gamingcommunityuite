import {
  GcsForbidden,
  GcsNotFound,
  GcsValidationError,
  normalizeUsername,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsJobQueue,
  type GcsNotificationService,
  type GcsPermissionService,
  type GcsRealtime,
  type GcsReportService,
  type GcsSettingsService,
  type GcsWarningService,
} from "@gcs/core";
import { type ChatSanctionKind, type Prisma, type PrismaClient, jsonStrings } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { toChatView, type GcsChatMessageView, type GcsChatService } from "./chat";
import type { GcsChatCommandContext } from "./extensions";
import { CHAT_ACP_MODERATION, CHAT_ACP_MODERATORS, CHAT_MOD_REASONS_DEFAULT } from "./index";
import type { GcsChatEphemeral, GcsChatGrantView, GcsChatModMenu, GcsChatSystemLine, GcsChatViewerState } from "./moderation-types";
import { writeChatModLog, type GcsChatModAction } from "./modlog";
import { CHAT_MOD_PRESETS, isChatRight, parseAccessCommand, type GcsChatRight, type GcsChatRights } from "./rights";

export const CHAT_MODERATION_JOB = "chat.moderation.expire";
const MAX_KICK_MINUTES = 7 * 1440;
const MAX_MINUTES = 525_600;
const MAX_GRANT_MS = 365 * 86_400_000;
const WARNING_DAYS = 30;
const PURGE_WINDOWS = { "1h": 3_600_000, "24h": 86_400_000, all: null } as const;
export type GcsChatPurgeWindow = keyof typeof PURGE_WINDOWS;

/** Opțiunile comune dialogurilor de moderare: motivul, linia de sistem în chat, notificarea membrului, mesajul de unde vine. */
export type GcsChatModOptions = {
  reason: string;
  /** „Anunță în chat”: o linie de sistem în cameră (implicit pornit la mute / kick / ban). */
  announce?: boolean;
  /** „Notifică membrul” (implicit pornit). */
  notify?: boolean;
  /** Camera în care s-a dat acțiunea (linia de sistem apare aici). */
  channelKey?: string | null;
  /** Mesajul din care s-a deschis meniul (dovada, linkul din jurnal). */
  messageId?: number | null;
};

export type GcsChatModLogView = {
  id: number;
  action: string;
  actor: GcsUserRef | null;
  target: GcsUserRef | null;
  channelKey: string | null;
  messageId: number | null;
  reason: string;
  data: Record<string, unknown> | null;
  /** Se poate anula (mute, kick, ban, slow mode încă active). */
  undoable: boolean;
  undoneAt: string | null;
  createdAt: string;
};

export type GcsChatSanctionView = {
  /** `mute:<id>` sau `sanction:<id>` (pentru „Ridică”). */
  ref: string;
  kind: "mute" | "kick" | "ban" | "slow";
  user: GcsUserRef;
  channelKey: string | null;
  until: string | null;
  seconds: number;
  reason: string;
  by: GcsUserRef | null;
  createdAt: string;
};

/** Fișa de moderare a unui membru (panoul din chat): avertismentele, sancțiunile active și ultimele acțiuni. */
export type GcsChatModCard = {
  user: GcsUserRef;
  warnings: { id: string; points: number; reason: string; expiresAt: string | null; createdAt: string; by: GcsUserRef | null }[];
  activePoints: number;
  sanctions: GcsChatSanctionView[];
  log: GcsChatModLogView[];
};

const KIND_OF: Record<ChatSanctionKind, GcsChatSanctionView["kind"]> = { KICK: "kick", BAN: "ban", SLOW: "slow" };
const RIGHT_OF: Record<GcsChatSanctionView["kind"], GcsChatRight> = { mute: "mute", kick: "kick", ban: "ban", slow: "slow_user" };

const minutesValid = (m: number | null, max: number) => m === null || (Number.isInteger(m) && m >= 1 && m <= max);
const cleanReason = (r: unknown) => (typeof r === "string" ? r.replace(/\s+/g, " ").trim().slice(0, 200) : "");

/**
 * Moderarea chat-ului (staff-ul și accesul de moderator în chat), în chat-ul standard (deci și în Chat Pro): ascunde,
 * șterge mesajele unui membru, avertisment (cu mesajul ca dovadă), mute, kick din cameră / chat, ban din chat, slow mode
 * personal; liniile de sistem („X a primit mute 15 minute: spam”), notificările, jurnalul cu anulare, fișa de moderare,
 * accesul de moderator (ACP și `/acces`, `/revoca`) și expirarea lor (jobul `chat.moderation.expire`). Totul e verificat
 * pe server și pleacă live: în cameră (`chat:<cheie>`) și la membru (`user:<id>`: `chat:sanction`, `chat:rights`).
 */
export class GcsChatModeration {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      realtime: GcsRealtime;
      acp: GcsAcpRoleService;
      chat: GcsChatService;
      warnings: GcsWarningService;
      notifications?: GcsNotificationService;
      reports?: GcsReportService;
    },
  ) {
    deps.chat.extensions.useCommand((ctx) => this.command(ctx));
    deps.chat.extensions.useBase((views) => this.decorate(views));
    this.registerNotifications();
  }

  get rights(): GcsChatRights {
    return this.deps.chat.rights;
  }

  // ─── Notificări ───────────────────────────────────────────────────────────────

  /** Ținta notificărilor de moderare: rândul din jurnal, vizibil doar membrului vizat. */
  private registerNotifications(): void {
    const n = this.deps.notifications;
    if (!n) return;
    const target = {
      canView: async (userId: string, id: string) => (await this.deps.db.chatModLog.findUnique({ where: { id: Number(id) }, select: { targetId: true } }))?.targetId === userId,
      describe: async (id: string) => {
        const row = await this.deps.db.chatModLog.findUnique({ where: { id: Number(id) }, select: { reason: true, channelKey: true } });
        return row ? { title: row.reason, href: row.channelKey ? `/chat?c=${row.channelKey}` : "/chat" } : null;
      },
    };
    n.registerTarget("chat.sanction", target);
    n.registerTarget("chat.access", target);
  }

  private async notify(type: "chat.sanction" | "chat.access", userId: string, logId: number, data: Record<string, unknown>): Promise<void> {
    // Fără actor: notificarea ajunge și dacă membrul îl ignoră pe moderator.
    await this.deps.notifications?.notify({ userIds: [userId], type, targetType: type, targetId: String(logId), actorId: null, data });
  }

  // ─── Ce vede viewer-ul ─────────────────────────────────────────────────────────

  /** Meniul „⋯” al camerei: drepturile, „Ban pe site…”, motivele gata scrise și dacă poate da acces. */
  async menu(actor: GcsActor, channelKey: string): Promise<GcsChatModMenu> {
    const { acp, permissions, settings } = this.deps;
    const [rights, canGrant, reasons] = await Promise.all([this.rights.rights(actor, channelKey), this.rights.canGrant(actor), settings.get<string[]>("chat.mod_reasons").catch(() => CHAT_MOD_REASONS_DEFAULT)]);
    const siteBan = actor.userId !== null && !actor.isBanned && (await permissions.can(actor, "acp.access")) && (await acp.can(actor, "members.members", "edit"));
    return { rights, siteBan, reasons: Array.isArray(reasons) ? reasons : CHAT_MOD_REASONS_DEFAULT, canGrant };
  }

  /** Starea viewer-ului în cameră: mute-ul, kick-ul / banul și slow mode-ul personal. */
  async viewerState(actor: GcsActor, channelKey: string): Promise<GcsChatViewerState> {
    if (!actor.userId) return { mute: null, block: null, slowSeconds: 0 };
    const channel = await this.deps.db.chatChannel.findUnique({ where: { key: channelKey }, select: { id: true } });
    if (!channel) return { mute: null, block: null, slowSeconds: 0 };
    const [mute, block, slow] = await Promise.all([this.deps.chat.activeMute(actor.userId, channel.id), this.rights.block(actor.userId, channel.id), this.rights.slow(actor.userId)]);
    return { mute: mute ? { reason: mute.reason, until: mute.until?.toISOString() ?? null } : null, block, slowSeconds: slow?.seconds ?? 0 };
  }

  // ─── Mesaje ─────────────────────────────────────────────────────────────────

  private async message(id: number) {
    const m = Number.isInteger(id) ? await this.deps.db.chatMessage.findUnique({ where: { id }, include: { channel: { select: { id: true, key: true } } } }) : null;
    if (!m || m.deletedAt) throw new GcsNotFound();
    return m;
  }

  /** Ascunde (sau arată din nou) un mesaj: membrii nu-l mai văd, staff-ul îl vede estompat, cu „ascuns de X”. */
  async hide(actor: GcsActor, messageId: number, hidden: boolean): Promise<void> {
    const { db, realtime } = this.deps;
    const m = await this.message(messageId);
    await this.rights.assert(actor, "hide", m.channel.key);
    const at = hidden ? new Date() : null;
    await db.$transaction(async (tx) => {
      await tx.chatMessage.update({ where: { id: messageId }, data: { hiddenAt: at, hiddenById: hidden ? actor.userId : null } });
      await writeChatModLog(tx, { actorId: actor.userId, action: hidden ? "hide" : "unhide", targetId: m.authorId, channelKey: m.channel.key, messageId });
      await writeAudit(tx, { actorId: actor.userId, action: hidden ? "chat.message.hide" : "chat.message.unhide", targetType: "chat_message", targetId: String(messageId), ip: actor.ip });
    });
    const by = actor.userId ? await db.user.findUnique({ where: { id: actor.userId }, select: userRefSelect }) : null;
    let view: GcsChatMessageView | null = null;
    if (!hidden) {
      const row = await db.chatMessage.findUniqueOrThrow({ where: { id: messageId }, include: { author: { select: userRefSelect }, reactions: { select: { userId: true, reactionId: true } } } });
      [view = null] = await this.deps.chat.extensions.decorate([toChatView(row, m.channel.key)]);
    }
    // Membrii fără drept îl scot din listă; staff-ul îl marchează; la „arată din nou” vine mesajul întreg.
    await realtime.publish(`chat:${m.channel.key}`, "hidden", { id: messageId, channel: m.channel.key, hidden, at: at?.toISOString() ?? null, by: by ? toRef(by) : null, message: view });
  }

  /** Șterge mesajele unui membru din cameră: din ultima oră, din ultimele 24 de ore sau toate. */
  async purge(actor: GcsActor, userId: string, channelKey: string, window: GcsChatPurgeWindow, opts: { reason?: string } = {}): Promise<{ count: number }> {
    const { db, realtime } = this.deps;
    if (!(window in PURGE_WINDOWS)) throw new GcsValidationError({ window: "invalid_choice" });
    await this.rights.assert(actor, "purge_user", channelKey);
    await this.rights.assertCanTarget(actor, userId);
    const channel = await db.chatChannel.findUnique({ where: { key: channelKey }, select: { id: true } });
    if (!channel) throw new GcsNotFound();
    const ms = PURGE_WINDOWS[window];
    const where: Prisma.ChatMessageWhereInput = { channelId: channel.id, authorId: userId, deletedAt: null, ...(ms !== null ? { createdAt: { gte: new Date(Date.now() - ms) } } : {}) };
    const ids = (await db.chatMessage.findMany({ where, select: { id: true }, take: 5000 })).map((r) => r.id);
    const reason = cleanReason(opts.reason);
    await db.$transaction(async (tx) => {
      if (ids.length > 0) await tx.chatMessage.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date(), deletedById: actor.userId } });
      await writeChatModLog(tx, { actorId: actor.userId, action: "purge", targetId: userId, channelKey, reason, data: { window, count: ids.length } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.purge", targetType: "user", targetId: userId, after: { channel: channelKey, window, count: ids.length }, ip: actor.ip });
    });
    if (ids.length > 0) await realtime.publish(`chat:${channelKey}`, "purged", { channel: channelKey, ids });
    return { count: ids.length };
  }

  // ─── Sancțiuni ───────────────────────────────────────────────────────────────

  /** Camera acțiunii: cea dată sau camera mesajului din care s-a deschis meniul. */
  private async channelOf(opts: GcsChatModOptions): Promise<string | null> {
    if (opts.channelKey) return opts.channelKey;
    if (opts.messageId) return (await this.message(opts.messageId)).channel.key;
    return null;
  }

  /** Avertisment (sistemul de avertismente al site-ului), cu mesajul de chat ca dovadă. */
  async warn(actor: GcsActor, userId: string, opts: GcsChatModOptions & { points?: number }): Promise<{ id: string }> {
    const channelKey = await this.channelOf(opts);
    await this.rights.assert(actor, "warn", channelKey);
    await this.rights.assertCanTarget(actor, userId);
    const reason = cleanReason(opts.reason);
    if (!reason) throw new GcsValidationError({ reason: "required" });
    const m = opts.messageId ? await this.message(opts.messageId) : null;
    if (m && m.authorId !== userId) throw new GcsValidationError({ messageId: "invalid" });
    const evidence = m ? { type: "chat.message", id: m.id, channel: m.channel.key, body: m.body.slice(0, 500), href: `/chat?c=${m.channel.key}&m=${m.id}` } : null;
    const { warning } = await this.deps.warnings.warn(
      { userId, points: Math.min(10, Math.max(1, Math.trunc(opts.points ?? 1))), reason, expiresAt: new Date(Date.now() + WARNING_DAYS * 86_400_000), evidence },
      actor,
      { authorized: true },
    );
    await writeChatModLog(this.deps.db, { actorId: actor.userId, action: "warn", targetId: userId, channelKey, messageId: m?.id ?? null, reason, data: { warningId: warning.id, points: warning.points } });
    if (opts.announce && channelKey) await this.system(actor, channelKey, { kind: "warn", targetId: userId, minutes: null, reason });
    return { id: warning.id };
  }

  /** Mute (5 / 15 / 60 de minute, 24 de ore, permanent) cu motiv; linia de sistem și notificarea, după opțiuni. */
  async mute(actor: GcsActor, userId: string, opts: GcsChatModOptions & { minutes: number | null; everywhere?: boolean }): Promise<{ id: number }> {
    const channelKey = await this.channelOf(opts);
    const reason = cleanReason(opts.reason);
    const res = await this.deps.chat.mute(actor, userId, { channelKey: opts.everywhere ? null : channelKey, minutes: opts.minutes, reason });
    const log = await this.deps.db.chatModLog.findFirst({ where: { ref: `mute:${res.id}` }, select: { id: true } });
    if (log && opts.messageId) await this.deps.db.chatModLog.update({ where: { id: log.id }, data: { messageId: opts.messageId } });
    await this.after(actor, userId, channelKey, log?.id ?? null, { kind: "mute", minutes: opts.minutes, reason }, opts);
    return res;
  }

  /** Kick din cameră (sau din tot chat-ul) pentru N minute: membrul iese pe loc, live, și nu poate reintra până expiră. */
  async kick(actor: GcsActor, userId: string, opts: GcsChatModOptions & { minutes: number; everywhere?: boolean }): Promise<{ id: number }> {
    if (!Number.isInteger(opts.minutes) || opts.minutes < 1 || opts.minutes > MAX_KICK_MINUTES) throw new GcsValidationError({ minutes: "invalid_range" });
    const channelKey = await this.channelOf(opts);
    return this.sanction(actor, userId, "KICK", { ...opts, channelKey, scope: opts.everywhere || !channelKey ? null : channelKey, minutes: opts.minutes, seconds: 0 });
  }

  /** Ban doar din chat (toate camerele), temporar sau permanent (`minutes: null`). */
  async ban(actor: GcsActor, userId: string, opts: GcsChatModOptions & { minutes: number | null }): Promise<{ id: number }> {
    if (!minutesValid(opts.minutes, MAX_MINUTES)) throw new GcsValidationError({ minutes: "invalid_range" });
    const channelKey = await this.channelOf(opts);
    return this.sanction(actor, userId, "BAN", { ...opts, channelKey, scope: null, minutes: opts.minutes, seconds: 0 });
  }

  /** Slow mode personal: cel mult un mesaj la `seconds` secunde, pentru `minutes` (sau până e ridicat). */
  async slowUser(actor: GcsActor, userId: string, opts: GcsChatModOptions & { seconds: number; minutes: number | null }): Promise<{ id: number }> {
    if (!Number.isInteger(opts.seconds) || opts.seconds < 5 || opts.seconds > 3600) throw new GcsValidationError({ seconds: "invalid_range" });
    if (!minutesValid(opts.minutes, MAX_MINUTES)) throw new GcsValidationError({ minutes: "invalid_range" });
    const channelKey = await this.channelOf(opts);
    return this.sanction(actor, userId, "SLOW", { ...opts, announce: false, channelKey, scope: null, minutes: opts.minutes, seconds: opts.seconds });
  }

  private async sanction(
    actor: GcsActor,
    userId: string,
    kind: ChatSanctionKind,
    opts: GcsChatModOptions & { channelKey: string | null; scope: string | null; minutes: number | null; seconds: number },
  ): Promise<{ id: number }> {
    const { db, realtime } = this.deps;
    const right = RIGHT_OF[KIND_OF[kind]];
    // Banul și kick-ul din tot chat-ul cer dreptul pe toate camerele; kick-ul dintr-o cameră, pe camera ei.
    await this.rights.assert(actor, right, kind === "KICK" ? opts.scope : kind === "SLOW" ? opts.channelKey : null);
    await this.rights.assertCanTarget(actor, userId);
    const channel = opts.scope ? await db.chatChannel.findUnique({ where: { key: opts.scope }, select: { id: true, key: true } }) : null;
    if (opts.scope && !channel) throw new GcsNotFound();
    const reason = cleanReason(opts.reason);
    const until = opts.minutes === null ? null : new Date(Date.now() + opts.minutes * 60_000);
    const action = KIND_OF[kind] as GcsChatModAction;
    const { row, logId } = await db.$transaction(async (tx) => {
      const row = await tx.chatSanction.create({ data: { kind, userId, channelId: channel?.id ?? null, until, seconds: opts.seconds, reason, createdById: actor.userId } });
      const logId = await writeChatModLog(tx, {
        actorId: actor.userId,
        action,
        targetId: userId,
        channelKey: channel?.key ?? opts.channelKey,
        messageId: opts.messageId ?? null,
        reason,
        data: { minutes: opts.minutes, ...(kind === "SLOW" ? { seconds: opts.seconds } : {}), scope: channel?.key ?? null },
        ref: `sanction:${row.id}`,
      });
      await writeAudit(tx, { actorId: actor.userId, action: `chat.${action}`, targetType: "user", targetId: userId, after: { channel: channel?.key ?? null, until, reason, seconds: opts.seconds }, ip: actor.ip });
      return { row, logId };
    });
    await realtime.publish(`user:${userId}`, "chat:sanction", { kind: action, channel: channel?.key ?? null, until: until?.toISOString() ?? null, reason, seconds: opts.seconds, active: true });
    await this.after(actor, userId, opts.channelKey, logId, { kind: action as "kick" | "ban" | "slow", minutes: opts.minutes, reason, seconds: opts.seconds }, opts);
    return { id: row.id };
  }

  /** După o sancțiune: linia de sistem (dacă e cerută) și notificarea membrului (implicit pornită). */
  private async after(
    actor: GcsActor,
    userId: string,
    channelKey: string | null,
    logId: number | null,
    s: { kind: "mute" | "kick" | "ban" | "slow"; minutes: number | null; reason: string; seconds?: number },
    opts: GcsChatModOptions,
  ): Promise<void> {
    if ((opts.announce ?? s.kind !== "slow") && channelKey && s.kind !== "slow") await this.system(actor, channelKey, { kind: s.kind, targetId: userId, minutes: s.minutes, reason: s.reason });
    if ((opts.notify ?? true) && logId !== null) await this.notify("chat.sanction", userId, logId, { kind: s.kind, minutes: s.minutes, reason: s.reason, ...(s.seconds ? { seconds: s.seconds } : {}) });
  }

  /** Ridică o sancțiune după referință (`mute:<id>` / `sanction:<id>`), cu dreptul de a o da. */
  async lift(actor: GcsActor, ref: string): Promise<void> {
    const { db, realtime } = this.deps;
    const [type, raw] = ref.split(":");
    const id = Number(raw);
    if (!Number.isInteger(id)) throw new GcsValidationError({ ref: "invalid" });
    if (type === "mute") return this.deps.chat.unmute(actor, id);
    if (type !== "sanction") throw new GcsValidationError({ ref: "invalid" });
    const s = await db.chatSanction.findUnique({ where: { id }, include: { channel: { select: { key: true } } } });
    if (!s) throw new GcsNotFound();
    const kind = KIND_OF[s.kind];
    await this.rights.assert(actor, RIGHT_OF[kind], kind === "kick" ? (s.channel?.key ?? null) : null);
    if (s.liftedAt) return;
    await db.$transaction(async (tx) => {
      await tx.chatSanction.update({ where: { id }, data: { liftedAt: new Date(), liftedById: actor.userId } });
      await writeChatModLog(tx, { actorId: actor.userId, action: "lift", targetId: s.userId, channelKey: s.channel?.key ?? null, data: { kind } });
      await tx.chatModLog.updateMany({ where: { ref, undoneAt: null }, data: { undoneAt: new Date(), undoneById: actor.userId } });
      await writeAudit(tx, { actorId: actor.userId, action: `chat.${kind}.lift`, targetType: "user", targetId: s.userId, before: { reason: s.reason, until: s.until }, ip: actor.ip });
    });
    await realtime.publish(`user:${s.userId}`, "chat:sanction", { kind, channel: s.channel?.key ?? null, until: null, reason: "", active: false });
  }

  /** „Anulează” din jurnal: ridică sancțiunea rândului (mute, kick, ban, slow mode). */
  async undo(actor: GcsActor, logId: number): Promise<void> {
    const row = await this.deps.db.chatModLog.findUnique({ where: { id: logId }, select: { ref: true, undoneAt: true } });
    if (!row?.ref) throw new GcsNotFound();
    if (row.undoneAt) return;
    await this.lift(actor, row.ref);
  }

  // ─── Fișa de moderare, jurnalul, sancțiunile active ─────────────────────────────────

  private async assertAnyRight(actor: GcsActor, channelKey: string | null): Promise<void> {
    if ((await this.rights.rights(actor, channelKey)).length === 0) throw new GcsForbidden({ permission: "chat.moderation" });
  }

  /** Fișa de moderare a unui membru (din meniul unui mesaj): avertismentele, sancțiunile active, ultimele acțiuni. */
  async card(actor: GcsActor, userId: string, channelKey: string | null): Promise<GcsChatModCard> {
    const { db, warnings } = this.deps;
    await this.assertAnyRight(actor, channelKey);
    const user = await db.user.findUnique({ where: { id: userId }, select: userRefSelect });
    if (!user) throw new GcsNotFound();
    const [rows, activePoints, sanctions, log] = await Promise.all([
      db.warning.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20, include: { issuedBy: { select: userRefSelect } } }),
      warnings.activePoints(userId),
      this.activeSanctionsOf({ userId }),
      this.logRows({ targetId: userId }, 15),
    ]);
    return {
      user: toRef(user),
      warnings: rows.map((w) => ({ id: w.id, points: w.points, reason: w.reason, expiresAt: w.expiresAt?.toISOString() ?? null, createdAt: w.createdAt.toISOString(), by: w.issuedBy ? toRef(w.issuedBy) : null })),
      activePoints,
      sanctions,
      log,
    };
  }

  private async logRows(where: Prisma.ChatModLogWhereInput, take: number, skip = 0): Promise<GcsChatModLogView[]> {
    const rows = await this.deps.db.chatModLog.findMany({
      where,
      orderBy: { id: "desc" },
      take,
      skip,
      include: { actor: { select: userRefSelect }, target: { select: userRefSelect } },
    });
    const now = new Date();
    const refs = rows.map((r) => r.ref).filter((r): r is string => !!r);
    const muteIds = refs.filter((r) => r.startsWith("mute:")).map((r) => Number(r.slice(5)));
    const sanctionIds = refs.filter((r) => r.startsWith("sanction:")).map((r) => Number(r.slice(9)));
    const [mutes, sanctions] = await Promise.all([
      muteIds.length ? this.deps.db.chatMute.findMany({ where: { id: { in: muteIds }, OR: [{ until: null }, { until: { gt: now } }] }, select: { id: true } }) : [],
      sanctionIds.length ? this.deps.db.chatSanction.findMany({ where: { id: { in: sanctionIds }, liftedAt: null, OR: [{ until: null }, { until: { gt: now } }] }, select: { id: true } }) : [],
    ]);
    const active = new Set([...mutes.map((m) => `mute:${m.id}`), ...sanctions.map((s) => `sanction:${s.id}`)]);
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor ? toRef(r.actor) : null,
      target: r.target ? toRef(r.target) : null,
      channelKey: r.channelKey,
      messageId: r.messageId,
      reason: r.reason,
      data: (r.data as Record<string, unknown> | null) ?? null,
      undoable: r.ref !== null && r.undoneAt === null && active.has(r.ref),
      undoneAt: r.undoneAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** „Jurnal moderare chat” (ACP): paginat, opțional după acțiune sau membru. */
  async log(actor: GcsActor, query: { page?: number; action?: string; targetId?: string } = {}): Promise<{ rows: GcsChatModLogView[]; page: number; pages: number }> {
    await this.deps.acp.assert(actor, CHAT_ACP_MODERATION, "view");
    const where: Prisma.ChatModLogWhereInput = { ...(query.action ? { action: query.action } : {}), ...(query.targetId ? { targetId: query.targetId } : {}) };
    const total = await this.deps.db.chatModLog.count({ where });
    const pages = Math.max(1, Math.ceil(total / 30));
    const page = Math.min(pages, Math.max(1, Math.trunc(query.page ?? 1) || 1));
    return { rows: await this.logRows(where, 30, (page - 1) * 30), page, pages };
  }

  private async activeSanctionsOf(filter: { userId?: string } = {}): Promise<GcsChatSanctionView[]> {
    const { db } = this.deps;
    const now = new Date();
    const live = { OR: [{ until: null }, { until: { gt: now } }] };
    const [mutes, sanctions] = await Promise.all([
      db.chatMute.findMany({ where: { ...filter, ...live }, orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: userRefSelect }, channel: { select: { key: true } } } }),
      db.chatSanction.findMany({ where: { ...filter, liftedAt: null, ...live }, orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: userRefSelect }, channel: { select: { key: true } } } }),
    ]);
    const byIds = [...new Set([...mutes, ...sanctions].map((r) => r.createdById).filter((x): x is string => !!x))];
    const by = new Map((await db.user.findMany({ where: { id: { in: byIds } }, select: userRefSelect })).map((u) => [u.id, toRef(u)]));
    return [
      ...mutes.map((m) => ({ ref: `mute:${m.id}`, kind: "mute" as const, user: toRef(m.user), channelKey: m.channel?.key ?? null, until: m.until?.toISOString() ?? null, seconds: 0, reason: m.reason, by: (m.createdById && by.get(m.createdById)) || null, createdAt: m.createdAt.toISOString() })),
      ...sanctions.map((s) => ({ ref: `sanction:${s.id}`, kind: KIND_OF[s.kind], user: toRef(s.user), channelKey: s.channel?.key ?? null, until: s.until?.toISOString() ?? null, seconds: s.seconds, reason: s.reason, by: (s.createdById && by.get(s.createdById)) || null, createdAt: s.createdAt.toISOString() })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Sancțiunile active (ACP → Chat → Moderare), cu „Ridică”. */
  async activeSanctions(actor: GcsActor): Promise<GcsChatSanctionView[]> {
    await this.deps.acp.assert(actor, CHAT_ACP_MODERATION, "view");
    return this.activeSanctionsOf();
  }

  // ─── Accesul de moderator în chat ──────────────────────────────────────────────────

  private grantView(g: { id: number; rights: unknown; rooms: unknown; expiresAt: Date | null; createdAt: Date; user: Parameters<typeof toRef>[0]; grantedBy: Parameters<typeof toRef>[0] | null }): GcsChatGrantView {
    return {
      id: g.id,
      user: toRef(g.user),
      rights: jsonStrings(g.rights).filter(isChatRight),
      rooms: jsonStrings(g.rooms),
      expiresAt: g.expiresAt?.toISOString() ?? null,
      grantedBy: g.grantedBy ? toRef(g.grantedBy) : null,
      createdAt: g.createdAt.toISOString(),
    };
  }

  private async assertCanManageGrants(actor: GcsActor): Promise<void> {
    if (await this.rights.canGrant(actor)) return;
    await this.deps.acp.assert(actor, CHAT_ACP_MODERATORS, "edit");
  }

  /** Accesele active (ACP → Chat → Moderatori și `/acces` singur). */
  async grants(actor: GcsActor): Promise<GcsChatGrantView[]> {
    if (!(await this.rights.canGrant(actor))) await this.deps.acp.assert(actor, CHAT_ACP_MODERATORS, "view");
    const rows = await this.deps.db.chatModeratorGrant.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: "desc" },
      include: { user: { select: userRefSelect }, grantedBy: { select: userRefSelect } },
    });
    return rows.map((g) => this.grantView(g));
  }

  /**
   * Dă (sau schimbă) accesul de moderator în chat al unui membru. Reguli: nu dai un drept pe care nu-l ai (pe camerele
   * accesului; fără camere = pe tot chat-ul), nu atingi Root Admin sau un membru cu „Prioritate afișare” mai mare;
   * jurnal, audit, notificarea membrului și, după setare, linia de sistem publică.
   */
  async grant(actor: GcsActor, input: { userId: string; rights: string[]; rooms: string[]; expiresAt: Date | null; announceIn?: string | null }): Promise<GcsChatGrantView> {
    const { db, realtime, settings } = this.deps;
    await this.assertCanManageGrants(actor);
    const rights = [...new Set(input.rights)];
    if (rights.length === 0 || !rights.every(isChatRight)) throw new GcsValidationError({ rights: "invalid_choice" });
    const rooms = [...new Set(input.rooms.map((r) => r.toLowerCase()))];
    if (rooms.length > 0 && (await db.chatChannel.count({ where: { key: { in: rooms } } })) !== rooms.length) throw new GcsValidationError({ rooms: "invalid_choice" });
    if (input.expiresAt && (input.expiresAt.getTime() <= Date.now() || input.expiresAt.getTime() > Date.now() + MAX_GRANT_MS + 60_000)) throw new GcsValidationError({ expiresAt: "invalid_range" });
    for (const right of rights) {
      const scopes = rooms.length === 0 ? [null] : rooms;
      for (const scope of scopes) if (!(await this.rights.has(actor, right, scope))) throw new GcsForbidden({ reason: "right_not_held", right });
    }
    await this.rights.assertCanTarget(actor, input.userId);
    const data = { rights, rooms, expiresAt: input.expiresAt, grantedById: actor.userId };
    const { grant, logId } = await db.$transaction(async (tx) => {
      const grant = await tx.chatModeratorGrant.upsert({ where: { userId: input.userId }, create: { userId: input.userId, ...data }, update: data, include: { user: { select: userRefSelect }, grantedBy: { select: userRefSelect } } });
      const logId = await writeChatModLog(tx, { actorId: actor.userId, action: "grant", targetId: input.userId, channelKey: input.announceIn ?? null, data: { rights, rooms, expiresAt: input.expiresAt?.toISOString() ?? null } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.grant", targetType: "user", targetId: input.userId, after: data, ip: actor.ip });
      return { grant, logId };
    });
    const minutes = input.expiresAt ? Math.round((input.expiresAt.getTime() - Date.now()) / 60_000) : null;
    await this.notify("chat.access", input.userId, logId, { kind: "granted", rights, rooms, minutes });
    await realtime.publish(`user:${input.userId}`, "chat:rights", { rights, rooms, expiresAt: input.expiresAt?.toISOString() ?? null });
    const announce = await settings.get<boolean>("chat.announce_grants").catch(() => true);
    if (announce !== false) {
      const where = input.announceIn ? [input.announceIn] : rooms.length > 0 ? rooms : (await db.chatChannel.findMany({ where: { enabled: true, showOnHome: true, type: "PUBLIC" }, select: { key: true } })).map((c) => c.key);
      for (const key of where) await this.system(actor, key, { kind: "grant", targetId: input.userId, minutes, reason: "", rights });
    }
    return this.grantView(grant);
  }

  /** Retrage accesul de moderator în chat (aceleași reguli de rang). */
  async revoke(actor: GcsActor, userId: string, opts: { announceIn?: string | null } = {}): Promise<GcsUserRef> {
    const { db, realtime } = this.deps;
    await this.assertCanManageGrants(actor);
    await this.rights.assertCanTarget(actor, userId);
    const grant = await db.chatModeratorGrant.findUnique({ where: { userId }, include: { user: { select: userRefSelect } } });
    if (!grant) throw new GcsNotFound({ entity: "chat_grant" });
    const logId = await db.$transaction(async (tx) => {
      await tx.chatModeratorGrant.delete({ where: { userId } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat.revoke", targetType: "user", targetId: userId, before: { rights: grant.rights, rooms: grant.rooms }, ip: actor.ip });
      return writeChatModLog(tx, { actorId: actor.userId, action: "revoke", targetId: userId, channelKey: opts.announceIn ?? null, data: { rights: grant.rights } });
    });
    await this.notify("chat.access", userId, logId, { kind: "revoked" });
    await realtime.publish(`user:${userId}`, "chat:rights", { rights: [], rooms: [], expiresAt: null });
    if (opts.announceIn && (await this.deps.settings.get<boolean>("chat.announce_grants").catch(() => true)) !== false) {
      await this.system(actor, opts.announceIn, { kind: "revoke", targetId: userId, minutes: null, reason: "" });
    }
    return toRef(grant.user);
  }

  // ─── Comenzile `/acces`, `/revoca` ──────────────────────────────────────────────────

  /** Membrul numit într-o comandă: sugestia aleasă în câmp (după id) sau numele exact. */
  private async userByName(name: string | null, ctx: GcsChatCommandContext): Promise<string> {
    const hint = ctx.mentions.find((m) => m.kind === "user");
    if (hint) return hint.id;
    if (!name) throw new GcsValidationError({ command: "member_required" });
    const u = await this.deps.db.user.findUnique({ where: { nameNormalized: normalizeUsername(name) }, select: { id: true } });
    if (!u) throw new GcsValidationError({ command: "member_not_found" }, { name });
    return u.id;
  }

  /** `/acces @nume [drepturi] [durată] [#cameră]`, `/acces` (lista), `/revoca @nume`: rezultatul doar pentru autor. */
  async command(ctx: GcsChatCommandContext): Promise<GcsChatEphemeral | null> {
    const cmd = parseAccessCommand(ctx.body);
    if (!cmd) return null;
    if (!(await this.rights.canGrant(ctx.actor))) throw new GcsForbidden({ permission: "chat.grant_access" });
    if (cmd.errors.length > 0) throw new GcsValidationError({ command: "invalid" }, { token: cmd.errors[0]! });
    if (cmd.command === "revoca") {
      const user = await this.revoke(ctx.actor, await this.userByName(cmd.name, ctx), { announceIn: ctx.channel.key });
      return { kind: "revoked", user };
    }
    if (!cmd.name && !ctx.mentions.some((m) => m.kind === "user")) return { kind: "list", grants: await this.grants(ctx.actor) };
    const userId = await this.userByName(cmd.name, ctx);
    if (cmd.room && !(await this.deps.db.chatChannel.findUnique({ where: { key: cmd.room }, select: { id: true } }))) throw new GcsValidationError({ command: "room_not_found" }, { room: cmd.room });
    const grant = await this.grant(ctx.actor, {
      userId,
      rights: cmd.rights ?? [...CHAT_MOD_PRESETS.command],
      rooms: cmd.room ? [cmd.room] : [],
      expiresAt: cmd.ms ? new Date(Date.now() + cmd.ms) : null,
      announceIn: ctx.channel.key,
    });
    return { kind: "granted", grant };
  }

  // ─── Liniile de sistem ────────────────────────────────────────────────────────────

  /** O linie de sistem în cameră (mesajul moderatorului cu `meta.system`), trimisă live. Nu se numără în clasament. */
  private async system(actor: GcsActor, channelKey: string, line: Omit<GcsChatSystemLine, "target">): Promise<void> {
    const { db, realtime } = this.deps;
    const channel = await db.chatChannel.findUnique({ where: { key: channelKey }, select: { id: true, key: true, enabled: true } });
    if (!channel?.enabled || !actor.userId) return;
    const target = await db.user.findUnique({ where: { id: line.targetId }, select: { name: true } });
    const body = `[${line.kind}] ${target?.name ?? ""}${line.minutes ? ` · ${line.minutes} min` : ""}${line.reason ? ` · ${line.reason}` : ""}`.slice(0, 500);
    const row = await db.chatMessage.create({
      data: { channelId: channel.id, authorId: actor.userId, body, meta: { system: { ...line } } as Prisma.InputJsonValue },
      include: { author: { select: userRefSelect } },
    });
    const [view] = await this.deps.chat.extensions.decorate([toChatView(row, channel.key)]);
    await realtime.publish(`chat:${channel.key}`, "message", view);
  }

  /** Completează vederile: membrul din liniile de sistem și cine a ascuns un mesaj. */
  private async decorate(views: GcsChatMessageView[]): Promise<void> {
    const ids = new Set<string>();
    for (const v of views) {
      if (v.system) ids.add(v.system.targetId);
      if (v.hidden?.byId) ids.add(v.hidden.byId);
    }
    if (ids.size === 0) return;
    const users = new Map((await this.deps.db.user.findMany({ where: { id: { in: [...ids] } }, select: userRefSelect })).map((u) => [u.id, toRef(u)]));
    for (const v of views) {
      if (v.system) v.system.target = users.get(v.system.targetId) ?? null;
      if (v.hidden?.byId) v.hidden.by = users.get(v.hidden.byId) ?? null;
    }
  }

  // ─── Raportarea și expirarea ─────────────────────────────────────────────────────────

  /** Raportează un mesaj moderatorilor (și în chat-ul standard, fără Chat Pro). */
  async report(actor: GcsActor, messageId: number, reason: string): Promise<void> {
    if (!actor.userId || actor.isBanned) throw new GcsForbidden({ reason: "guest" });
    if (!this.deps.reports) throw new GcsNotFound();
    await this.deps.reports.report(actor, { contentType: "chat.message", contentId: String(messageId), reason });
  }

  /** Expirarea (jobul): accesele expirate (cu notificare), mute-urile și sancțiunile terminate (live, la membru). */
  async expire(now = new Date()): Promise<{ grants: number; mutes: number; sanctions: number }> {
    const { db, realtime } = this.deps;
    const grants = await db.chatModeratorGrant.findMany({ where: { expiresAt: { lte: now } }, select: { userId: true, rights: true } });
    for (const g of grants) {
      const removed = await db.chatModeratorGrant.deleteMany({ where: { userId: g.userId, expiresAt: { lte: now } } });
      if (removed.count === 0) continue;
      const logId = await writeChatModLog(db, { actorId: null, action: "expire", targetId: g.userId, data: { rights: g.rights } });
      await this.notify("chat.access", g.userId, logId, { kind: "expired" });
      await realtime.publish(`user:${g.userId}`, "chat:rights", { rights: [], rooms: [], expiresAt: null });
    }
    const mutes = await db.chatMute.findMany({ where: { until: { lte: now } }, select: { id: true, userId: true, channel: { select: { key: true } } } });
    if (mutes.length > 0) await db.chatMute.deleteMany({ where: { id: { in: mutes.map((m) => m.id) } } });
    for (const m of mutes) await realtime.publish(`user:${m.userId}`, "chat:sanction", { kind: "mute", channel: m.channel?.key ?? null, until: null, reason: "", active: false });
    const ended = await db.chatSanction.findMany({ where: { liftedAt: null, until: { lte: now } }, select: { id: true, kind: true, userId: true, channel: { select: { key: true } } } });
    if (ended.length > 0) await db.chatSanction.updateMany({ where: { id: { in: ended.map((s) => s.id) } }, data: { liftedAt: now } });
    for (const s of ended) await realtime.publish(`user:${s.userId}`, "chat:sanction", { kind: KIND_OF[s.kind], channel: s.channel?.key ?? null, until: null, reason: "", active: false });
    return { grants: grants.length, mutes: mutes.length, sanctions: ended.length };
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({ name: CHAT_MODERATION_JOB, everyMs: 60_000, handler: async () => void (await this.expire()) });
  }
}

