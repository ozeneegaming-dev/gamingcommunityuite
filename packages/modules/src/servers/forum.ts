import type { GcsForumExtField, GcsForumExtension, GcsForumListSlots, GcsForumSlotContext, GcsForumSlotNode, GcsSlotItem, GcsSlotJson } from "@gcs/core";
import { SERVERS_CACHE_TAG } from "./service";

/**
 * Serverele ca forumuri (macheta aprobată `ServerForum`, secțiunile A–E): extensia de forum a aplicației Servere. Un
 * forum sau subforum, la orice nivel, se leagă de un server (ales în tabul „Server” sau, implicit, serverul care are
 * forumul ales în ACP › Servere) și primește:
 * - pe rând, în liste: eticheta ON / OFF lângă titlu și bara live sub descriere (Complet / Compact / Doar ON/OFF);
 * - în rândul părintelui: cipurile compacte ale subforumurilor-server (index), cu numele, jucătorii și harta;
 * - în banda categoriei: câte servere are și sumarul live („36 / 58 jucători online”, „18 pe TS · 312 pe Discord”);
 * - pe pagina lui: cardul mare (harta, ocuparea, maximul de azi, graficul pe 24 h, cine e pe server acum);
 * - pe paginile topicurilor: o bară mică, opțional.
 *
 * Extensia doar alege serverul și opțiunile: componentele site-ului (`servers.*` din registrul web) citesc statusul o
 * singură dată pe cerere, din poller (nu o interogare a serverului la fiecare afișare), filtrat după ce vede vizitatorul.
 */

export const SERVERS_FORUM_EXTENSION = "servers";

/** Câmpurile tabului „Server” (valorile se salvează de nucleu, per forum). */
export const SERVER_TAB_FIELDS = [
  { key: "server", type: "select", labelKey: "acp.forumServer.server", optionsFrom: "servers", default: "" },
  {
    key: "style",
    type: "select",
    labelKey: "acp.forumServer.style",
    default: "full",
    options: [
      { value: "full", labelKey: "acp.forumServer.styles.full" },
      { value: "compact", labelKey: "acp.forumServer.styles.compact" },
      { value: "status", labelKey: "acp.forumServer.styles.status" },
    ],
  },
  { key: "row", type: "toggle", labelKey: "acp.forumServer.where.row", hintKey: "acp.forumServer.where.rowHint", default: true },
  { key: "parent", type: "toggle", labelKey: "acp.forumServer.where.parent", hintKey: "acp.forumServer.where.parentHint", default: true },
  { key: "card", type: "toggle", labelKey: "acp.forumServer.where.card", default: true },
  { key: "topic", type: "toggle", labelKey: "acp.forumServer.where.topic", default: false },
  { key: "status", type: "toggle", labelKey: "acp.forumServer.show.status", default: true },
  { key: "players", type: "toggle", labelKey: "acp.forumServer.show.players", default: true },
  { key: "map", type: "toggle", labelKey: "acp.forumServer.show.map", default: true },
  { key: "address", type: "toggle", labelKey: "acp.forumServer.show.address", default: true },
  { key: "connect", type: "toggle", labelKey: "acp.forumServer.show.connect", default: true },
  { key: "top", type: "toggle", labelKey: "acp.forumServer.show.top", hintKey: "acp.forumServer.show.topHint", default: true },
] as const satisfies readonly GcsForumExtField[];

/** Ce câmpuri ale serverului se afișează (props JSON pentru componente). */
export type GcsServerFieldsShown = { status: boolean; players: boolean; map: boolean; address: boolean; connect: boolean; top: boolean };
export type GcsServerListStyle = "full" | "compact" | "status";

/** Un server activ și forumul lui (legătura din ACP › Servere), pentru toată pagina. */
type Link = { id: number; forumId: number | null; game: string };

const LINKS_KEY = "servers:forum-links";

/** Serverele active cu forumul lor (cache, invalidat la orice schimbare a serverelor). */
async function serverLinks(ctx: Pick<GcsForumSlotContext, "db" | "cache">): Promise<Link[]> {
  const hit = await ctx.cache.get<Link[]>(LINKS_KEY);
  if (hit) return hit;
  const rows = await ctx.db.gameServer.findMany({ where: { enabled: true }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, forumId: true, game: true } });
  await ctx.cache.set(LINKS_KEY, rows, { ttlSec: 3600, tags: [SERVERS_CACHE_TAG] });
  return rows;
}

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export function shownFields(data: Record<string, unknown>): GcsServerFieldsShown {
  return { status: bool(data.status, true), players: bool(data.players, true), map: bool(data.map, true), address: bool(data.address, true), connect: bool(data.connect, true), top: bool(data.top, true) };
}

export function listStyle(data: Record<string, unknown>): GcsServerListStyle {
  return data.style === "compact" || data.style === "status" ? data.style : "full";
}

/** Serverul unui forum: cel ales în tab (dacă e activ) sau, implicit, primul server care are acest forum. */
export function resolveServer(forumId: number, data: Record<string, unknown>, links: Link[]): Link | null {
  const chosen = typeof data.server === "string" && /^[1-9]\d{0,9}$/.test(data.server) ? Number(data.server) : null;
  if (chosen !== null) return links.find((l) => l.id === chosen) ?? null;
  return links.find((l) => l.forumId === forumId) ?? null;
}

const component = (name: string, props: Record<string, unknown>, id: string): GcsSlotItem => ({ kind: "component", component: name, props: props as Record<string, GcsSlotJson>, id });

/** Sloturile listei pentru toate nodurile paginii (fără interogări pe rând: o singură citire a legăturilor, din cache). */
export async function serverListSlots(ctx: GcsForumSlotContext, nodes: GcsForumSlotNode[]): Promise<Record<number, GcsForumListSlots>> {
  const links = await serverLinks(ctx);
  if (links.length === 0) return {};
  const out: Record<number, GcsForumListSlots> = {};
  /** Serverele fiecărui nod de forum (al lui + ale subforumurilor din rând), pentru sumarul categoriei. */
  const under = new Map<number, number[]>();

  for (const node of nodes) {
    if (node.type !== "FORUM" && node.type !== "QA") continue;
    const slots: GcsForumListSlots = {};
    const ids: number[] = [];
    const own = resolveServer(node.id, node.data, links);
    if (own && bool(node.data.row, true)) {
      ids.push(own.id);
      const style = listStyle(node.data);
      slots.title = [component("servers.state", { serverId: own.id }, `servers-state-${node.id}`)];
      if (style !== "status") slots.meta = [component("servers.strip", { serverId: own.id, style, fields: shownFields(node.data) }, `servers-strip-${node.id}`)];
      slots.style = { classes: ["gcsx-servers"] };
    } else if (own) {
      ids.push(own.id);
    }
    // Subforumurile-server din rând: cipurile compacte (index); dacă toate subforumurile sunt servere, lista lor obișnuită
    // nu se mai arată (cipurile o înlocuiesc), altfel fiecare primește doar eticheta ON / OFF.
    const children = node.children ?? [];
    const chips: { serverId: number; forumId: number; name: string; slug: string }[] = [];
    const subs: Record<number, GcsSlotItem[]> = {};
    for (const c of children) {
      const s = resolveServer(c.id, c.data, links);
      if (!s) continue;
      ids.push(s.id);
      if (!bool(c.data.parent, true)) continue;
      chips.push({ serverId: s.id, forumId: c.id, name: c.name, slug: c.slug });
      subs[c.id] = [component("servers.state", { serverId: s.id }, `servers-sub-${c.id}`)];
    }
    if (chips.length > 0 && chips.length === children.length) {
      slots.meta = [...(slots.meta ?? []), component("servers.chips", { items: chips }, `servers-chips-${node.id}`)];
      slots.style = { classes: [...(slots.style?.classes ?? []), "gcsx-servers", "gcsx-servers--chips"] };
    } else if (chips.length > 0) {
      slots.subs = subs;
    }
    if (ids.length > 0) under.set(node.id, ids);
    if (slots.title || slots.meta || slots.subs || slots.style) out[node.id] = slots;
  }

  // Banda categoriei: câte servere are (direct și în subforumuri) și sumarul live.
  for (const node of nodes) {
    if (node.type !== "CATEGORY") continue;
    const ids = [...new Set(nodes.filter((n) => n.parentId === node.id).flatMap((n) => under.get(n.id) ?? []))];
    if (ids.length === 0) continue;
    out[node.id] = { header: [component("servers.summary", { serverIds: ids }, `servers-summary-${node.id}`)] };
  }
  return out;
}

/** Cardul mare de pe pagina forumului legat de un server. */
export async function serverForumPage(ctx: GcsForumSlotContext, node: GcsForumSlotNode): Promise<GcsSlotItem[] | null> {
  if (!bool(node.data.card, true)) return null;
  const own = resolveServer(node.id, node.data, await serverLinks(ctx));
  return own ? [component("servers.card", { serverId: own.id, fields: shownFields(node.data) }, `servers-card-${node.id}`)] : null;
}

/** Bara mică din topicurile forumului (implicit oprită). */
export async function serverTopicBar(ctx: GcsForumSlotContext, node: GcsForumSlotNode): Promise<GcsSlotItem[] | null> {
  if (!bool(node.data.topic, false)) return null;
  const own = resolveServer(node.id, node.data, await serverLinks(ctx));
  return own ? [component("servers.bar", { serverId: own.id, fields: shownFields(node.data) }, `servers-bar-${node.id}`)] : null;
}

export const serversForumExtension: GcsForumExtension = {
  key: SERVERS_FORUM_EXTENSION,
  position: 50,
  tabs: [
    {
      key: "server",
      labelKey: "acp.forumServer.tab",
      icon: "fa-solid fa-server",
      descriptionKey: "acp.forumServer.description",
      position: 40,
      types: ["FORUM", "QA"],
      fields: SERVER_TAB_FIELDS,
      component: "servers.forumTab",
      customForm: true,
    },
  ],
  list: serverListSlots,
  forumPage: serverForumPage,
  topicBar: (ctx, { node }) => serverTopicBar(ctx, node),
};
