import { GcsNotFound, type GcsActor, type GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsUserDisplay } from "../profile/display";
import type { GcsProfileQueries } from "../profile/queries";
import { snippetOf } from "../profile/queries";
import { PM_CONTENT_TYPE } from "./conversations";

const INBOX_PER_PAGE = 20;

export type GcsInboxItem = {
  id: number;
  title: string;
  lastMessageAt: string;
  messagesCount: number;
  unread: boolean;
  participants: GcsUserDisplay[];
  last: { author: GcsUserDisplay | null; snippet: string } | null;
};

export type GcsMessageView = {
  id: number;
  html: string;
  createdAt: string;
  author: GcsUserDisplay | null;
  attachments: { id: string; filename: string; size: number; mime: string }[];
  mine: boolean;
};

export type GcsConversationView = {
  id: number;
  title: string;
  starterId: string | null;
  participants: (GcsUserDisplay & { lastReadMessageId: number; invitedById: string | null })[];
  /** Cine a citit ultimul mesaj (în afară de autorul lui și de viewer). */
  readBy: GcsUserDisplay[];
  messages: GcsMessageView[];
  page: number;
  pages: number;
  firstUnreadId: number | null;
};

/** Citirile pentru inbox și pentru o conversație (specul etapei 3, §8). Doar participanții activi. */
export class GcsConversationQueries {
  constructor(private readonly deps: { db: PrismaClient; settings: GcsSettingsService; profileQueries: GcsProfileQueries }) {}

  async inbox(viewer: GcsActor, page: number): Promise<{ items: GcsInboxItem[]; total: number; pages: number }> {
    const { db, profileQueries } = this.deps;
    if (!viewer.userId) return { items: [], total: 0, pages: 1 };
    const where = { userId: viewer.userId, leftAt: null };
    const [rows, total] = await Promise.all([
      db.conversationParticipant.findMany({
        where,
        orderBy: { conversation: { lastMessageAt: "desc" } },
        skip: (page - 1) * INBOX_PER_PAGE,
        take: INBOX_PER_PAGE,
        include: { conversation: { include: { participants: { where: { leftAt: null }, select: { userId: true } } } } },
      }),
      db.conversationParticipant.count({ where }),
    ]);
    const lastIds = rows.map((r) => r.conversation.lastMessageId).filter((id): id is number => id !== null);
    const lasts = await db.conversationMessage.findMany({ where: { id: { in: lastIds } }, select: { id: true, authorId: true, contentHtml: true } });
    const lastById = new Map(lasts.map((m) => [m.id, m]));
    const displays = await profileQueries.userDisplays([
      ...rows.flatMap((r) => r.conversation.participants.map((p) => p.userId)),
      ...lasts.map((m) => m.authorId).filter((id): id is string => id !== null),
    ]);
    return {
      items: rows.map((r) => {
        const c = r.conversation;
        const last = c.lastMessageId !== null ? lastById.get(c.lastMessageId) : undefined;
        return {
          id: c.id,
          title: c.title,
          lastMessageAt: c.lastMessageAt.toISOString(),
          messagesCount: c.messagesCount,
          unread: (c.lastMessageId ?? 0) > r.lastReadMessageId,
          participants: c.participants.map((p) => displays.get(p.userId)).filter((u): u is GcsUserDisplay => u !== undefined),
          last: last ? { author: last.authorId ? (displays.get(last.authorId) ?? null) : null, snippet: snippetOf(last.contentHtml, 120) } : null,
        };
      }),
      total,
      pages: Math.max(1, Math.ceil(total / INBOX_PER_PAGE)),
    };
  }

  /**
   * O conversație, paginată (implicit pagina cu primul mesaj necitit, altfel ultima).
   * Un neparticipant (sau cineva care a plecat) primește `GcsNotFound`.
   */
  async conversation(viewer: GcsActor, id: number, page?: number): Promise<GcsConversationView> {
    const { db, settings, profileQueries } = this.deps;
    if (!viewer.userId) throw new GcsNotFound();
    const conversation = await db.conversation.findUnique({ where: { id }, include: { participants: { where: { leftAt: null } } } });
    const me = conversation?.participants.find((p) => p.userId === viewer.userId);
    if (!conversation || !me) throw new GcsNotFound();

    const perPage = await settings.get<number>("pm.messages_per_page");
    const total = conversation.messagesCount;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const firstUnread = await db.conversationMessage.findFirst({ where: { conversationId: id, id: { gt: me.lastReadMessageId } }, orderBy: { id: "asc" }, select: { id: true } });
    let current = page;
    if (current === undefined) {
      current = firstUnread ? Math.floor((await db.conversationMessage.count({ where: { conversationId: id, id: { lt: firstUnread.id } } })) / perPage) + 1 : pages;
    }
    current = Math.min(Math.max(1, current), pages);

    const messages = await db.conversationMessage.findMany({ where: { conversationId: id }, orderBy: { id: "asc" }, skip: (current - 1) * perPage, take: perPage });
    const files = messages.length
      ? await db.attachment.findMany({
          where: { contentType: PM_CONTENT_TYPE, contentId: { in: messages.map((m) => String(m.id)) }, NOT: { mime: { startsWith: "image/" } } },
          select: { id: true, filename: true, size: true, mime: true, contentId: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const displays = await profileQueries.userDisplays([...conversation.participants.map((p) => p.userId), ...messages.map((m) => m.authorId).filter((x): x is string => x !== null)]);
    const lastId = conversation.lastMessageId ?? 0;
    const lastAuthor = lastId ? (await db.conversationMessage.findUnique({ where: { id: lastId }, select: { authorId: true } }))?.authorId : null;

    return {
      id: conversation.id,
      title: conversation.title,
      starterId: conversation.starterId,
      participants: conversation.participants.flatMap((p) => {
        const d = displays.get(p.userId);
        return d ? [{ ...d, lastReadMessageId: p.lastReadMessageId, invitedById: p.invitedById }] : [];
      }),
      readBy: conversation.participants
        .filter((p) => p.userId !== viewer.userId && p.userId !== lastAuthor && lastId > 0 && p.lastReadMessageId >= lastId)
        .map((p) => displays.get(p.userId))
        .filter((u): u is GcsUserDisplay => u !== undefined),
      messages: messages.map((m) => ({
        id: m.id,
        html: m.contentHtml,
        createdAt: m.createdAt.toISOString(),
        author: m.authorId ? (displays.get(m.authorId) ?? null) : null,
        attachments: files.filter((f) => f.contentId === String(m.id)).map(({ contentId: _c, ...f }) => f),
        mine: m.authorId === viewer.userId,
      })),
      page: current,
      pages,
      firstUnreadId: firstUnread?.id ?? null,
    };
  }
}
