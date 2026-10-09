import { GcsForbidden, normalizeUsername, type GcsActor, type GcsPermissionService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsChatQueries } from "../chat/queries";
import { renderChatText } from "../chat/text";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";

export const HISTORY_PAGE_SIZE = 25;

export type GcsChatHistoryQuery = { q?: string; member?: string; from?: string; to?: string; channel?: string; page?: number };
export type GcsChatHistoryRow = {
  id: number;
  channel: { key: string; name: string };
  author: GcsUserRef | null;
  body: string;
  html: string;
  createdAt: string;
  editedAt: string | null;
};
export type GcsChatHistoryPage = {
  totals: { messages: number; users: number; edited: number };
  rows: GcsChatHistoryRow[];
  page: number;
  pages: number;
  total: number;
  channels: { key: string; name: string }[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** `%` și `_` dintr-un text căutat cu LIKE se caută literal. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Istoricul chat-ului (`/chat/history`, Chat Pro): totalurile (mesaje, membri, mesaje editate) și căutarea după text,
 * membru (numele de pe forum sau porecla din chat) și interval de zile, cu paginare. Doar mesajele (neșterse) din
 * camerele pe care viewer-ul le poate citi; cere permisiunea `chat_pro.history`.
 */
export class GcsChatHistory {
  constructor(private readonly deps: { db: PrismaClient; permissions: GcsPermissionService; chatQueries: GcsChatQueries }) {}

  async canView(viewer: GcsActor): Promise<boolean> {
    return viewer.userId !== null && !viewer.isBanned && (await this.deps.permissions.can(viewer, "chat_pro.history"));
  }

  async page(viewer: GcsActor, query: GcsChatHistoryQuery): Promise<GcsChatHistoryPage> {
    const { db, chatQueries } = this.deps;
    if (!(await this.canView(viewer))) throw new GcsForbidden({ permission: "chat_pro.history" });
    const channels = await chatQueries.channels(viewer);
    const rows = await db.chatChannel.findMany({ where: { key: { in: channels.map((c) => c.key) } }, select: { id: true, key: true } });
    const ids = new Map(rows.map((r) => [r.key, r.id]));
    const channelIds = query.channel && ids.has(query.channel) ? [ids.get(query.channel)!] : [...ids.values()];
    const base: Prisma.ChatMessageWhereInput = { channelId: { in: channelIds }, deletedAt: null };

    const where: Prisma.ChatMessageWhereInput[] = [base];
    const q = (query.q ?? "").trim().slice(0, 100);
    if (q) where.push({ body: { contains: q, mode: "insensitive" } });
    const member = normalizeUsername((query.member ?? "").replace(/^@/, "")).slice(0, 40);
    if (member) {
      const pattern = likeEscape(member);
      const matches = await db.$queryRaw<{ id: string }[]>`
        SELECT u.id FROM users u LEFT JOIN chat_pro_profiles p ON p."userId" = u.id
        WHERE u."nameNormalized" LIKE ${`%${pattern}%`} OR p."nicknameNormalized" LIKE ${`%${pattern}%`}
        LIMIT 200`;
      where.push({ authorId: { in: matches.map((m) => m.id) } });
    }
    if (query.from && DAY.test(query.from)) where.push({ createdAt: { gte: new Date(`${query.from}T00:00:00Z`) } });
    if (query.to && DAY.test(query.to)) where.push({ createdAt: { lt: new Date(new Date(`${query.to}T00:00:00Z`).getTime() + 86_400_000) } });
    const filter: Prisma.ChatMessageWhereInput = { AND: where };

    const [messages, edited, users, total] = await Promise.all([
      db.chatMessage.count({ where: base }),
      db.chatMessage.count({ where: { ...base, editedAt: { not: null } } }),
      db.$queryRaw<{ n: number }[]>`
        SELECT COUNT(DISTINCT "authorId")::int AS n FROM chat_messages
        WHERE "channelId" = ANY(${channelIds}::int[]) AND "deletedAt" IS NULL`.then((r) => r[0]?.n ?? 0),
      db.chatMessage.count({ where: filter }),
    ]);
    const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
    const page = Math.min(pages, Math.max(1, Math.trunc(query.page ?? 1) || 1));
    const list = await db.chatMessage.findMany({
      where: filter,
      orderBy: { id: "desc" },
      skip: (page - 1) * HISTORY_PAGE_SIZE,
      take: HISTORY_PAGE_SIZE,
      include: { author: { select: userRefSelect }, channel: { select: { key: true, name: true } } },
    });
    return {
      totals: { messages, users, edited },
      rows: list.map((m) => ({
        id: m.id,
        channel: m.channel,
        author: m.author ? toRef(m.author) : null,
        body: m.body,
        html: renderChatText(m.body),
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt?.toISOString() ?? null,
      })),
      page,
      pages,
      total,
      channels: channels.map((c) => ({ key: c.key, name: c.name })),
    };
  }
}
