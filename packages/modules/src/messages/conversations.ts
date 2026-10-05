import {
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  writeAudit,
  type GcsActor,
  type GcsAttachmentService,
  type GcsCache,
  type GcsEventBus,
  type GcsPermissionService,
  type GcsRedisRateLimiter,
  type GcsRendered,
  type GcsReportService,
  type GcsSettingsService,
} from "@gcs/core";
import type { Conversation, ConversationMessage, Prisma, PrismaClient } from "@gcs/db";
import type { GcsProfileService } from "../profile/profile";
import { normalizePrivacy } from "../profile/privacy";
import type { GcsSocialService } from "../profile/social";

export const PM_CONTENT_TYPE = "pm.message";
const TITLE_MAX = 120;
const UNREAD_TTL = 300;

type Tx = Prisma.TransactionClient;

export type GcsStartConversationInput = { to: string[]; title: string; content: unknown };

const pmTags = (userIds: string[], conversationId?: number) => [
  ...userIds.map((id) => `pm:${id}`),
  ...(conversationId !== undefined ? [`conversation:${conversationId}`] : []),
];

/**
 * Mesajele private (spec §8, specul etapei 3 §6–§7): conversații cu mai mulți participanți, limite pe grup,
 * confidențialitate și ignorare, status citit. Doar participanții activi văd conversația și atașamentele ei.
 */
export class GcsConversationService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      cache: GcsCache;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      rateLimiter: GcsRedisRateLimiter;
      attachments: GcsAttachmentService;
      profiles: GcsProfileService;
      social: GcsSocialService;
      render: (content: unknown) => Promise<GcsRendered>;
    },
  ) {}

  /** Participant activ (n-a părăsit conversația). */
  async isParticipant(userId: string | null, conversationId: number): Promise<boolean> {
    if (!userId) return false;
    const row = await this.deps.db.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { leftAt: true } });
    return row !== null && row.leftAt === null;
  }

  private async assertParticipant(actor: GcsActor, conversationId: number): Promise<void> {
    if (!(await this.isParticipant(actor.userId, conversationId))) throw new GcsNotFound();
  }

  /** O limită numerică de grup (`-1` = nelimitat). */
  private async limit(actor: GcsActor, key: string): Promise<number> {
    const v = await this.deps.permissions.groupValue<number | boolean>(actor, key);
    return typeof v === "number" ? v : 0;
  }

  private async checkFlood(actor: GcsActor): Promise<void> {
    const seconds = await this.limit(actor, "pm.flood_seconds");
    if (seconds <= 0) return;
    const res = await this.deps.rateLimiter.consume(`pm:${actor.userId}`, { window: seconds, max: 1 });
    if (!res.allowed) throw new GcsRateLimited({ retryAfter: String(res.retryAfter) });
  }

  /**
   * Poate `actor` să-i scrie lui `userId`? Confidențialitatea destinatarului (staff-ul trece) și ignorarea
   * (nimeni nu trece, nici staff-ul). Întoarce numele destinatarului, pentru mesajul de eroare.
   */
  async canContact(actor: GcsActor, userId: string): Promise<{ ok: boolean; name: string | null }> {
    const user = await this.deps.db.user.findUnique({ where: { id: userId }, select: { name: true, privacy: true } });
    if (!user) return { ok: false, name: null };
    const ok = await this.deps.social.allowsContact(actor, userId, normalizePrivacy(user.privacy).messages, { staffBypass: true });
    return { ok, name: user.name };
  }

  private async assertRecipients(actor: GcsActor, ids: string[]): Promise<void> {
    for (const id of ids) {
      const { ok, name } = await this.canContact(actor, id);
      if (!ok) throw new GcsValidationError({ to: name === null ? "unknown_user" : "not_allowed" }, { user: name ?? id });
    }
  }

  private cleanTitle(title: string): string {
    const clean = title.replace(/\s+/g, " ").trim();
    if (clean.length < 1 || clean.length > TITLE_MAX) throw new GcsValidationError({ title: "invalid_length" }, { max: String(TITLE_MAX) });
    return clean;
  }

  private async renderMessage(content: unknown): Promise<GcsRendered> {
    const rendered = await this.deps.render(content);
    if (rendered.text.trim() === "" && rendered.attachments.length === 0) throw new GcsValidationError({ content: "required" });
    return rendered;
  }

  private async invalidateUnread(userIds: string[]): Promise<void> {
    await this.deps.cache.invalidateTags(pmTags(userIds));
  }

  async start(actor: GcsActor, input: GcsStartConversationInput): Promise<{ conversationId: number; messageId: number }> {
    const { db, bus, permissions } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    await permissions.assert(actor, "pm.send");
    const title = this.cleanTitle(input.title);
    const to = [...new Set(input.to)].filter((id) => id !== actor.userId);
    if (to.length === 0) throw new GcsValidationError({ to: "required" });

    const [maxParticipants, maxConversations] = await Promise.all([this.limit(actor, "pm.max_participants"), this.limit(actor, "pm.max_conversations")]);
    if (maxParticipants !== -1 && to.length + 1 > maxParticipants) {
      throw new GcsValidationError({ to: "too_many" }, { max: String(maxParticipants) });
    }
    if (maxConversations !== -1) {
      const active = await db.conversationParticipant.count({ where: { userId: actor.userId, leftAt: null } });
      if (active >= maxConversations) throw new GcsValidationError({ to: "conversation_limit" }, { max: String(maxConversations) });
    }
    await this.assertRecipients(actor, to);
    const rendered = await this.renderMessage(input.content);
    await this.checkFlood(actor);

    const result = await db.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          title,
          starterId: actor.userId,
          participants: { create: [{ userId: actor.userId! }, ...to.map((userId) => ({ userId, invitedById: actor.userId }))] },
        },
      });
      const message = await this.addMessage(tx, conversation.id, actor, rendered);
      return { conversationId: conversation.id, messageId: message.id };
    });
    await this.invalidateUnread([actor.userId, ...to]);
    await bus.emit({ name: "pm.conversation.created", payload: { ...result, starterId: actor.userId, participants: [actor.userId, ...to] }, tags: pmTags([actor.userId, ...to], result.conversationId) });
    await bus.emit({ name: "pm.message.created", payload: { ...result, authorId: actor.userId }, tags: [`conversation:${result.conversationId}`] });
    return result;
  }

  /** Mesajul nou + contoarele conversației, în tranzacție, cu rândul conversației blocat (răspunsuri simultane). */
  private async addMessage(tx: Tx, conversationId: number, actor: GcsActor, rendered: GcsRendered): Promise<ConversationMessage> {
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId} FOR UPDATE`;
    const message = await tx.conversationMessage.create({
      data: { conversationId, authorId: actor.userId, contentJson: rendered.json as Prisma.InputJsonValue, contentHtml: rendered.html, ip: actor.ip },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageId: message.id, lastMessageAt: message.createdAt, messagesCount: { increment: 1 } },
    });
    await tx.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: actor.userId! } },
      data: { lastReadMessageId: message.id },
    });
    await this.deps.attachments.attach(tx, rendered.attachments, { contentType: PM_CONTENT_TYPE, contentId: String(message.id), ownerId: actor.userId! });
    return message;
  }

  private async activeIds(conversationId: number): Promise<string[]> {
    const rows = await this.deps.db.conversationParticipant.findMany({ where: { conversationId, leftAt: null }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  async reply(actor: GcsActor, conversationId: number, content: unknown): Promise<{ messageId: number }> {
    const { db, bus, permissions } = this.deps;
    await this.assertParticipant(actor, conversationId);
    await permissions.assert(actor, "pm.send");
    const rendered = await this.renderMessage(content);
    await this.checkFlood(actor);
    const message = await db.$transaction((tx) => this.addMessage(tx, conversationId, actor, rendered));
    const participants = await this.activeIds(conversationId);
    await this.invalidateUnread(participants);
    await bus.emit({ name: "pm.message.created", payload: { conversationId, messageId: message.id, authorId: actor.userId }, tags: [`conversation:${conversationId}`] });
    return { messageId: message.id };
  }

  /** Orice participant activ poate invita, în limita lui `pm.max_participants`, cu aceleași verificări ca la start. */
  async invite(actor: GcsActor, conversationId: number, userIds: string[]): Promise<void> {
    const { db, bus, permissions } = this.deps;
    await this.assertParticipant(actor, conversationId);
    await permissions.assert(actor, "pm.send");
    const current = await db.conversationParticipant.findMany({ where: { conversationId }, select: { userId: true, leftAt: true } });
    const active = new Set(current.filter((p) => p.leftAt === null).map((p) => p.userId));
    const add = [...new Set(userIds)].filter((id) => !active.has(id));
    if (add.length === 0) return;
    const max = await this.limit(actor, "pm.max_participants");
    if (max !== -1 && active.size + add.length > max) throw new GcsValidationError({ to: "too_many" }, { max: String(max) });
    await this.assertRecipients(actor, add);
    await db.$transaction(async (tx) => {
      for (const userId of add) {
        await tx.conversationParticipant.upsert({
          where: { conversationId_userId: { conversationId, userId } },
          create: { conversationId, userId, invitedById: actor.userId },
          // Revine în conversație: o vede din nou, cu tot istoricul, marcată necitită.
          update: { leftAt: null, invitedById: actor.userId, joinedAt: new Date(), lastReadMessageId: 0 },
        });
      }
    });
    await this.invalidateUnread([...active, ...add]);
    await bus.emit({ name: "pm.participant.invited", payload: { conversationId, userIds: add, invitedById: actor.userId }, tags: pmTags(add, conversationId) });
  }

  /** Părăsește conversația. Când pleacă ultimul participant, conversația se șterge (cu atașamentele ei). */
  async leave(actor: GcsActor, conversationId: number): Promise<void> {
    const { db, bus, attachments } = this.deps;
    await this.assertParticipant(actor, conversationId);
    const removed = await db.$transaction(async (tx) => {
      await tx.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: actor.userId! } }, data: { leftAt: new Date() } });
      const left = await tx.conversationParticipant.count({ where: { conversationId, leftAt: null } });
      if (left > 0) return null;
      const messages = await tx.conversationMessage.findMany({ where: { conversationId }, select: { id: true } });
      await tx.conversation.delete({ where: { id: conversationId } });
      return messages.map((m) => String(m.id));
    });
    if (removed) await attachments.deleteFor(PM_CONTENT_TYPE, removed);
    await this.invalidateUnread([actor.userId!]);
    await bus.emit({ name: "pm.participant.left", payload: { conversationId, userId: actor.userId, deleted: removed !== null }, tags: pmTags([actor.userId!], conversationId) });
  }

  /** Marchează citit până la `messageId` (implicit: tot). Nu dă înapoi. */
  async markRead(actor: GcsActor, conversationId: number, messageId?: number): Promise<void> {
    const { db } = this.deps;
    await this.assertParticipant(actor, conversationId);
    const conversation = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { lastMessageId: true } });
    const target = Math.min(messageId ?? Number.MAX_SAFE_INTEGER, conversation.lastMessageId ?? 0);
    const { count } = await db.conversationParticipant.updateMany({
      where: { conversationId, userId: actor.userId!, lastReadMessageId: { lt: target } },
      data: { lastReadMessageId: target },
    });
    if (count > 0) {
      await this.invalidateUnread([actor.userId!]);
      await this.deps.bus.emit({ name: "pm.read", payload: { conversationId, userId: actor.userId, messageId: target }, tags: [`conversation:${conversationId}`] });
    }
  }

  /** Conversațiile cu mesaje necitite (pentru plicul din header). Cache 5 minute, invalidat la orice schimbare. */
  async unreadCount(userId: string | null): Promise<number> {
    if (!userId) return 0;
    const key = `pm:unread:${userId}`;
    const cached = await this.deps.cache.get<number>(key);
    if (cached !== null) return cached;
    const [row] = await this.deps.db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM conversation_participants p
      JOIN conversations c ON c.id = p."conversationId"
      WHERE p."userId" = ${userId} AND p."leftAt" IS NULL AND c."lastMessageId" > p."lastReadMessageId"`;
    const n = row?.n ?? 0;
    await this.deps.cache.set(key, n, { ttlSec: UNREAD_TTL, tags: pmTags([userId]) });
    return n;
  }

  /** Accesul la un mesaj (atașamente, rapoarte): doar participanții activi. */
  async canViewMessage(actor: GcsActor, messageId: number): Promise<boolean> {
    if (!actor.userId) return false;
    const message = await this.deps.db.conversationMessage.findUnique({ where: { id: messageId }, select: { conversationId: true } });
    return message !== null && (await this.isParticipant(actor.userId, message.conversationId));
  }

  /** Șterge un mesaj raportat (moderator), cu contoarele conversației recalculate. */
  async deleteMessage(actor: GcsActor, messageId: number, reason: string): Promise<void> {
    const { db, bus, attachments, profiles } = this.deps;
    if (!(await profiles.isModerator(actor))) throw new GcsForbidden({ permission: "profile.moderate" });
    const message = await db.conversationMessage.findUnique({ where: { id: messageId } });
    if (!message) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.conversationMessage.delete({ where: { id: messageId } });
      const last = await tx.conversationMessage.findFirst({ where: { conversationId: message.conversationId }, orderBy: { id: "desc" } });
      const count = await tx.conversationMessage.count({ where: { conversationId: message.conversationId } });
      await tx.conversation.update({
        where: { id: message.conversationId },
        data: { lastMessageId: last?.id ?? null, lastMessageAt: last?.createdAt ?? message.createdAt, messagesCount: count },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "mod.pm.delete", targetType: "pm.message", targetId: String(messageId), before: { contentHtml: message.contentHtml, authorId: message.authorId }, after: { reason }, ip: actor.ip });
    });
    await attachments.deleteFor(PM_CONTENT_TYPE, [String(messageId)]);
    await this.invalidateUnread(await this.activeIds(message.conversationId));
    await bus.emit({ name: "pm.message.deleted", payload: { conversationId: message.conversationId, messageId }, tags: [`conversation:${message.conversationId}`] });
  }

  /**
   * Rapoartele pe mesaje: participantul raportează; moderatorul vede doar mesajul raportat (prin `reported`),
   * nu și restul conversației. „Ascunde” = ștergerea mesajului.
   */
  registerContent(services: { reports: GcsReportService }): void {
    this.deps.attachments.registerAccess(PM_CONTENT_TYPE, (actor, id) => this.canViewMessage(actor, Number(id)));
    services.reports.registerContent(PM_CONTENT_TYPE, {
      canView: (actor, id) => this.canViewMessage(actor, Number(id)),
      canModerate: (actor) => this.deps.profiles.isModerator(actor),
      hide: (actor, id, reason) => this.deleteMessage(actor, Number(id), reason),
    });
  }

  /** Rapoartele deschise pe mesaje, cu mesajul raportat (doar pentru moderatori). */
  async reported(actor: GcsActor) {
    const { db, profiles } = this.deps;
    if (!(await profiles.isModerator(actor))) throw new GcsForbidden({ permission: "profile.moderate" });
    const reports = await db.report.findMany({
      where: { contentType: PM_CONTENT_TYPE, status: "OPEN" },
      orderBy: { createdAt: "asc" },
      include: { reporter: { select: { id: true, name: true } } },
      take: 100,
    });
    const messages = await db.conversationMessage.findMany({
      where: { id: { in: reports.map((r) => Number(r.contentId)) } },
      include: { author: { select: { id: true, name: true } }, conversation: { select: { title: true } } },
    });
    const byId = new Map(messages.map((m) => [String(m.id), m]));
    return reports.flatMap((r) => {
      const m = byId.get(r.contentId);
      return m
        ? [{ reportId: r.id, reason: r.reason, createdAt: r.createdAt.toISOString(), reporter: r.reporter, messageId: m.id, html: m.contentHtml, author: m.author, conversationTitle: m.conversation.title }]
        : [];
    });
  }

  conversationRow(id: number): Promise<Conversation | null> {
    return this.deps.db.conversation.findUnique({ where: { id } });
  }
}
