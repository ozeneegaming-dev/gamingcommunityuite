import { GcsForbidden, normalizeUsername, type GcsActor, type GcsPermissionService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsChatFile } from "../chat/chat";
import { chatMentionsOf, chatSystemOf } from "../chat/chat";
import type { GcsChatSystemLine } from "../chat/moderation-types";
import type { GcsChatQueries } from "../chat/queries";
import type { GcsChatRights } from "../chat/rights";
import { chatEmbeds, renderChatText, type GcsChatEmbed } from "../chat/text";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { renderEmotes } from "./emotes";
import type { GcsChatEmoteView } from "./types";

export const HISTORY_PAGE_SIZE = 25;
/** Cel mult atâtea rânduri într-un export CSV. */
export const HISTORY_EXPORT_MAX = 10_000;

export type GcsChatHistoryQuery = { q?: string; member?: string; from?: string; to?: string; channel?: string; page?: number; hidden?: boolean };
/** Grupul afișat al autorului (iconița și numele, în culoarea grupului). */
export type GcsChatHistoryGroup = { id: number; name: string; color: string | null; icon: string | null };
export type GcsChatHistoryRow = {
  id: number;
  channel: { key: string; name: string };
  author: GcsUserRef | null;
  group: GcsChatHistoryGroup | null;
  body: string;
  /** Textul randat: escapat, mențiunile ca pastile, emoticoanele ca imagini; linkurile imaginilor / GIF-urilor scoase (apar ca miniaturi). */
  html: string;
  files: GcsChatFile[];
  embeds: GcsChatEmbed[];
  system: GcsChatSystemLine | null;
  createdAt: string;
  editedAt: string | null;
  /** Ascuns de staff (doar pentru cine are dreptul să vadă mesajele ascunse). */
  hidden: { by: GcsUserRef | null } | null;
};
export type GcsChatHistoryPage = {
  totals: { messages: number; users: number; edited: number };
  rows: GcsChatHistoryRow[];
  page: number;
  pages: number;
  total: number;
  channels: { key: string; name: string }[];
  /** Viewer-ul poate cere și mesajele ascunse (dreptul `hide`) / exporta CSV (`chat_pro.history_export`). */
  can: { hidden: boolean; export: boolean; hide: boolean; delete: boolean };
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** `%` și `_` dintr-un text căutat cu LIKE se caută literal. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Linkul unei imagini / al unui GIF din text nu apare ca adresă: miniatura îl înlocuiește. */
function withoutMediaLinks(html: string, embeds: GcsChatEmbed[]): string {
  let out = html;
  for (const e of embeds) {
    if (e.kind !== "image") continue;
    out = out.replace(new RegExp(`<a href="${escapeRe(escapeHtml(e.url))}"[^>]*>[^<]*</a>`, "g"), "");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Istoricul chat-ului (`/chat/history`, Chat Pro): totalurile (mesaje, membri, mesaje editate) și căutarea după text,
 * membru (numele de pe forum sau porecla din chat), interval de zile și cameră, cu paginare. Doar mesajele (neșterse)
 * din camerele pe care viewer-ul le poate citi; cele ascunse de staff, doar pentru cine are dreptul `hide` și le cere.
 * Cere permisiunea `chat_pro.history`; exportul CSV, `chat_pro.history_export`.
 */
export class GcsChatHistory {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      permissions: GcsPermissionService;
      chatQueries: GcsChatQueries;
      /** Drepturile de moderare (mesajele ascunse, butoanele staff-ului). */
      rights?: GcsChatRights;
      /** Emoticoanele comunității (cod → imagine). */
      emotes?: () => Promise<Map<string, GcsChatEmoteView>>;
    },
  ) {}

  async canView(viewer: GcsActor): Promise<boolean> {
    return viewer.userId !== null && !viewer.isBanned && (await this.deps.permissions.can(viewer, "chat_pro.history"));
  }

  async canExport(viewer: GcsActor): Promise<boolean> {
    return (await this.canView(viewer)) && (await this.deps.permissions.can(viewer, "chat_pro.history_export"));
  }

  /** Filtrul comun (paginare și export): camerele citibile, mesajele ascunse după drept, căutarea. */
  private async filter(viewer: GcsActor, query: GcsChatHistoryQuery) {
    const { db, chatQueries, rights } = this.deps;
    const channels = await chatQueries.channels(viewer);
    const rows = await db.chatChannel.findMany({ where: { key: { in: channels.map((c) => c.key) } }, select: { id: true, key: true } });
    const ids = new Map(rows.map((r) => [r.key, r.id]));
    const channelIds = query.channel && ids.has(query.channel) ? [ids.get(query.channel)!] : [...ids.values()];
    // Mesajele ascunse: doar în camerele unde viewer-ul are dreptul `hide`, și doar dacă le cere.
    const hideIn: number[] = [];
    if (rights) for (const [key, id] of ids) if (channelIds.includes(id) && (await rights.has(viewer, "hide", key))) hideIn.push(id);
    const seeHidden = query.hidden === true && hideIn.length > 0;
    const base: Prisma.ChatMessageWhereInput = {
      channelId: { in: channelIds },
      deletedAt: null,
      ...(seeHidden ? { OR: [{ hiddenAt: null }, { channelId: { in: hideIn } }] } : { hiddenAt: null }),
    };
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
    return { channels, channelIds, base: { channelId: { in: channelIds }, deletedAt: null, hiddenAt: null } as Prisma.ChatMessageWhereInput, filter: { AND: where } as Prisma.ChatMessageWhereInput, canHidden: hideIn.length > 0 };
  }

  async page(viewer: GcsActor, query: GcsChatHistoryQuery): Promise<GcsChatHistoryPage> {
    const { db, rights } = this.deps;
    if (!(await this.canView(viewer))) throw new GcsForbidden({ permission: "chat_pro.history" });
    const { channels, channelIds, base, filter, canHidden } = await this.filter(viewer, query);

    const [messages, edited, users, total, canExport, canDelete] = await Promise.all([
      db.chatMessage.count({ where: base }),
      db.chatMessage.count({ where: { ...base, editedAt: { not: null } } }),
      db.$queryRaw<{ n: number }[]>`
        SELECT COUNT(DISTINCT "authorId")::int AS n FROM chat_messages
        WHERE "channelId" = ANY(${channelIds}::int[]) AND "deletedAt" IS NULL AND "hiddenAt" IS NULL`.then((r) => r[0]?.n ?? 0),
      db.chatMessage.count({ where: filter }),
      this.canExport(viewer),
      rights ? rights.has(viewer, "delete_any", query.channel ?? null) : Promise.resolve(false),
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
      rows: await this.rows(list),
      page,
      pages,
      total,
      channels: channels.map((c) => ({ key: c.key, name: c.name })),
      can: { hidden: canHidden, export: canExport, hide: canHidden, delete: canDelete },
    };
  }

  /** Rândurile afișate: grupul autorului, emoticoanele, miniaturile, liniile de sistem și cine a ascuns. */
  private async rows(
    list: (Prisma.ChatMessageGetPayload<{ include: { author: { select: typeof userRefSelect }; channel: { select: { key: true; name: true } } } }>)[],
  ): Promise<GcsChatHistoryRow[]> {
    const { db } = this.deps;
    const authorIds = [...new Set(list.map((m) => m.authorId).filter((x): x is string => !!x))];
    const extraIds = [...new Set(list.flatMap((m) => [m.hiddenById, chatSystemOf(m.meta)?.targetId]).filter((x): x is string => !!x))];
    const [groupsOf, extras, emotes] = await Promise.all([
      authorIds.length
        ? db.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, nameGroup: { select: { id: true, name: true, color: true, icon: true } }, primaryGroup: { select: { id: true, name: true, color: true, icon: true } } },
          })
        : Promise.resolve([]),
      extraIds.length ? db.user.findMany({ where: { id: { in: extraIds } }, select: userRefSelect }) : Promise.resolve([]),
      this.deps.emotes ? this.deps.emotes() : Promise.resolve(new Map<string, GcsChatEmoteView>()),
    ]);
    const group = new Map(groupsOf.map((u) => [u.id, u.nameGroup ?? u.primaryGroup]));
    const refs = new Map(extras.map((u) => [u.id, toRef(u)]));
    return list.map((m) => {
      const embeds = chatEmbeds(m.body);
      const system = chatSystemOf(m.meta);
      if (system) system.target = refs.get(system.targetId) ?? null;
      const html = withoutMediaLinks(renderChatText(m.body, chatMentionsOf(m.meta)), embeds);
      return {
        id: m.id,
        channel: m.channel,
        author: m.author ? toRef(m.author) : null,
        group: m.authorId ? (group.get(m.authorId) ?? null) : null,
        body: m.body,
        html: emotes.size > 0 ? renderEmotes(html, emotes) : html,
        files: Array.isArray(m.files) ? (m.files as GcsChatFile[]).filter((f) => f && typeof f.id === "string") : [],
        embeds,
        system,
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt?.toISOString() ?? null,
        hidden: m.hiddenAt ? { by: m.hiddenById ? (refs.get(m.hiddenById) ?? null) : null } : null,
      };
    });
  }

  /** Exportul CSV al căutării (cel mult 10 000 de rânduri), pentru `chat_pro.history_export`. */
  async exportCsv(viewer: GcsActor, query: GcsChatHistoryQuery): Promise<string> {
    if (!(await this.canExport(viewer))) throw new GcsForbidden({ permission: "chat_pro.history_export" });
    const { filter } = await this.filter(viewer, query);
    const list = await this.deps.db.chatMessage.findMany({
      where: filter,
      orderBy: { id: "desc" },
      take: HISTORY_EXPORT_MAX,
      select: { id: true, body: true, createdAt: true, editedAt: true, hiddenAt: true, author: { select: { name: true } }, channel: { select: { key: true } } },
    });
    // Celulele care încep cu =, +, -, @ nu devin formule în foile de calcul.
    const cell = (v: string) => {
      const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [["id", "room", "member", "message", "created_at", "edited_at", "hidden"].join(",")];
    for (const m of list) {
      lines.push([String(m.id), m.channel.key, m.author?.name ?? "", m.body, m.createdAt.toISOString(), m.editedAt?.toISOString() ?? "", m.hiddenAt ? "1" : ""].map(cell).join(","));
    }
    return `${lines.join("\r\n")}\r\n`;
  }
}
