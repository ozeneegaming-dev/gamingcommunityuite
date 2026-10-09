import "server-only";
import type { GcsActor } from "@gcs/core";
import type { GcsThemeSettings } from "@gcs/core/themes";
import { levelProgress, normalizePrivacy, POLL_INTERVAL_SETTING, type GcsServerView, type GcsUserRef } from "@gcs/modules";
import { matchHref, serverHref } from "../app/(site)/_components/servers/types";
import type { GcsCockpitData, GcsCockpitFeatured, GcsCockpitMatch, GcsCockpitUser, GcsFeedItem, GcsFeedTab } from "./cockpit";
import { memberHref, postHref, topicHref } from "./forum-urls";
import { liveSummary, visibleServers } from "./live-summary.server";
import { COCKPIT_METRICS } from "./ranking";
import { rankingMetrics, rankingRows } from "./ranking.server";
import { services } from "./services";

const FEED_SIZE = 8;
const ref = (u: Pick<GcsUserRef, "id" | "name" | "nameKey" | "image" | "frameKey">): GcsCockpitUser => ({ id: u.id, name: u.name, nameKey: u.nameKey, image: u.image, frameKey: u.frameKey });

/** Serverele vizibile cu statisticile de joc (sesiuni, meciuri): doar cu dreptul `servers.stats_view`. */
async function statServers(actor: GcsActor): Promise<number[]> {
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled()) || !(await bridge.queries.canViewStats(actor).catch(() => false))) return [];
  return serverQueries.visibleIds(actor);
}

/** Forumul: topicurile, răspunsurile, statusurile și membrii noi din fluxul de activitate (regulile lui de acces). */
async function forumFeed(actor: GcsActor): Promise<GcsFeedItem[]> {
  const page = await services()
    .activity.page(actor, { filter: "all", limit: FEED_SIZE })
    .catch(() => ({ items: [] }));
  return page.items.flatMap((i): GcsFeedItem[] => {
    const user = i.user ? ref(i.user) : null;
    const name = i.user?.name ?? "";
    switch (i.kind) {
      case "topic":
      case "reply":
        return [{ key: i.key, kind: i.kind, at: i.at, user, name, href: i.kind === "topic" ? topicHref(i.topic) : postHref(i.topic.id, i.postId), params: { topic: i.topic.title }, tag: "forum" }];
      case "status":
        return [{ key: i.key, kind: "status", at: i.at, user, name, href: i.owner ? memberHref(i.owner) : "/activity", params: {}, tag: "forum" }];
      case "member":
        return [{ key: i.key, kind: "member", at: i.at, user, name, href: memberHref(i.user), params: {}, tag: "new" }];
    }
  });
}

/** Serverele: membrii care au intrat recent pe un server (fără cei cu statusul ascuns). */
async function serverFeed(actor: GcsActor, serverIds: number[]): Promise<GcsFeedItem[]> {
  if (serverIds.length === 0) return [];
  const { db, profileQueries } = services();
  const sessions = await db.gameSession.findMany({
    where: { serverId: { in: serverIds }, player: { userId: { not: null } } },
    orderBy: { connectedAt: "desc" },
    take: FEED_SIZE * 2,
    select: { id: true, connectedAt: true, server: { select: { id: true, name: true, slug: true } }, player: { select: { userId: true, user: { select: { privacy: true } } } } },
  });
  const visible = sessions.filter((s) => s.player.userId && normalizePrivacy(s.player.user?.privacy).showOnline);
  const users = await profileQueries.userDisplays(visible.map((s) => s.player.userId!));
  const seen = new Set<string>();
  return visible.flatMap((s): GcsFeedItem[] => {
    const u = users.get(s.player.userId!);
    // Un membru o singură dată (cea mai recentă intrare).
    if (!u || seen.has(u.id)) return [];
    seen.add(u.id);
    return [{ key: `s${s.id}`, kind: "server", at: s.connectedAt.toISOString(), user: ref(u), name: u.name, href: serverHref(s.server), params: { server: s.server.name }, tag: "server" }];
  });
}

/** Meciurile mix încheiate: cel mai bun membru din echipa câștigătoare (sau numele echipei), scorul și ELO-ul câștigat. */
async function mixFeed(serverIds: number[]): Promise<GcsFeedItem[]> {
  if (serverIds.length === 0) return [];
  const { db, profileQueries } = services();
  const matches = await db.gameMatch.findMany({
    where: { serverId: { in: serverIds }, status: "ENDED", endedAt: { not: null } },
    orderBy: { endedAt: "desc" },
    take: FEED_SIZE,
    select: {
      id: true,
      endedAt: true,
      winner: true,
      teamAName: true,
      teamBName: true,
      scoreA: true,
      scoreB: true,
      server: { select: { name: true } },
      players: { select: { team: true, kills: true, eloBefore: true, eloAfter: true, name: true, player: { select: { userId: true } } } },
    },
  });
  const ids = matches.flatMap((m) => m.players.flatMap((p) => (p.player.userId ? [p.player.userId] : [])));
  const users = await profileQueries.userDisplays(ids);
  return matches.flatMap((m): GcsFeedItem[] => {
    if (m.winner !== "A" && m.winner !== "B") return [];
    const winners = m.players.filter((p) => p.team === m.winner).sort((a, b) => b.kills - a.kills);
    const best = winners.find((p) => p.player.userId && users.has(p.player.userId));
    const u = best ? users.get(best.player.userId!) : undefined;
    const score = m.winner === "A" ? `${m.scoreA}:${m.scoreB}` : `${m.scoreB}:${m.scoreA}`;
    const elo = best && best.eloAfter !== null && best.eloBefore !== null ? best.eloAfter - best.eloBefore : null;
    return [
      {
        key: `m${m.id}`,
        kind: "mix",
        at: m.endedAt!.toISOString(),
        user: u ? ref(u) : null,
        name: u?.name ?? (m.winner === "A" ? m.teamAName : m.teamBName),
        href: matchHref(m.id),
        params: { server: m.server.name, score, elo: elo !== null && elo > 0 ? `+${elo}` : "" },
        tag: "mix",
      },
    ];
  });
}

/** „Feed live” pe tab (Tot = toate, cele mai noi primele). */
export async function cockpitFeed(actor: GcsActor, tab: GcsFeedTab): Promise<GcsFeedItem[]> {
  const ids = tab === "forum" ? [] : await statServers(actor);
  const [forum, servers, mix] = await Promise.all([
    tab === "all" || tab === "forum" ? forumFeed(actor) : [],
    tab === "all" || tab === "servers" ? serverFeed(actor, ids).catch(() => []) : [],
    tab === "all" || tab === "mix" ? mixFeed(ids).catch(() => []) : [],
  ]);
  return [...forum, ...servers, ...mix].sort((a, b) => b.at.localeCompare(a.at)).slice(0, FEED_SIZE);
}

/** Meciul live afișat în centru: primul meci mix în desfășurare de pe un server vizibil, cu scorul și jucătorii. */
async function liveMatch(actor: GcsActor, servers: GcsServerView[]): Promise<{ match: GcsCockpitMatch | null; matches: number }> {
  const { bridge, db, profileQueries } = services();
  if (servers.length === 0 || !(await bridge.queries.canViewStats(actor).catch(() => false))) return { match: null, matches: 0 };
  const list = await bridge.queries.matches(actor, { status: "live" }).catch(() => null);
  const first = list?.items[0];
  if (!first) return { match: null, matches: 0 };
  const live = await bridge.queries.liveMatch(actor, first.server.id).catch(() => null);
  const server = servers.find((s) => s.id === first.server.id);
  const watch = (await bridge.queries.watch(actor, [first.server.id]).catch(() => new Map())).get(first.server.id) ?? null;
  const players = live?.players ?? [];
  const links = await db.gamePlayer.findMany({ where: { id: { in: players.flatMap((p) => (p.playerId ? [p.playerId] : [])) }, userId: { not: null } }, select: { id: true, userId: true } });
  const users = await profileQueries.userDisplays(links.map((l) => l.userId!));
  const byPlayer = new Map(links.map((l) => [l.id, users.get(l.userId!)]));
  const top = (team: "A" | "B") =>
    players
      .filter((p) => p.team === team)
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 3)
      .map((p) => {
        const u = p.playerId ? byPlayer.get(p.playerId) : undefined;
        return { team, name: u?.name ?? p.name, user: u ? ref(u) : null, kills: p.kills, deaths: p.deaths };
      });
  return {
    matches: list?.total ?? 0,
    match: {
      id: live?.id ?? first.id,
      serverId: first.server.id,
      server: first.server.name,
      map: live?.map ?? first.map,
      round: live?.round ?? first.round,
      status: live?.status ?? first.status,
      teams: live?.teams ?? first.teams,
      players: [...top("A"), ...top("B")],
      watch,
      connectHref: server?.connectHref ?? null,
      href: matchHref(live?.id ?? first.id),
    },
  };
}

/** Recomandatele (când nu e nimic live): topicurile evidențiate, ca în caruselul recomandat. */
async function featured(actor: GcsActor): Promise<GcsCockpitFeatured[]> {
  const slides = await services()
    .forumQueries.featuredCarousel(actor, 4)
    .catch(() => []);
  return slides.map((s) => ({ id: s.id, title: s.title, href: topicHref(s), forum: s.forum?.name ?? null, excerpt: s.excerpt, image: s.image, at: s.createdAt, user: s.user ? ref(s.user) : null }));
}

/** Banda personală: necititele, prietenii (membrii urmăriți) online și cei de pe servere, nivelul. */
async function welcome(actor: GcsActor): Promise<GcsCockpitData["welcome"]> {
  if (!actor.userId) return null;
  const { db, profileQueries, activity, presence } = services();
  const userId = actor.userId;
  const [display, user, ladder, unread, follows, online] = await Promise.all([
    profileQueries.userDisplays([userId]).then((m) => m.get(userId) ?? null),
    db.user.findUnique({ where: { id: userId }, select: { rankId: true, points: true, postsCount: true, reputation: true } }),
    db.rank.findMany({ select: { id: true, name: true, position: true, minPosts: true, minPoints: true, minReputation: true } }),
    activity.page(actor, { filter: "all", unread: true, limit: 50 }).catch(() => ({ items: [] })),
    db.follow.findMany({ where: { userId, contentType: "user" }, select: { contentId: true } }),
    presence.online().catch(() => ({ users: [] as string[] })),
  ]);
  if (!display || !user) return null;
  const topics = new Set(unread.items.flatMap((i) => (i.kind === "topic" || i.kind === "reply" ? [i.topic.id] : [])));
  let friends: { online: number; playing: number; server: string | null } | null = null;
  if (follows.length > 0) {
    const followed = new Set(follows.map((f) => f.contentId));
    const present = online.users.filter((id) => followed.has(id));
    const shown = (await db.user.findMany({ where: { id: { in: present } }, select: { id: true, privacy: true } })).filter((u) => normalizePrivacy(u.privacy).showOnline).map((u) => u.id);
    const playing = shown.length
      ? await db.gameSession.findMany({ where: { disconnectedAt: null, player: { userId: { in: shown } } }, select: { server: { select: { name: true } } }, orderBy: { connectedAt: "desc" } })
      : [];
    friends = { online: shown.length, playing: playing.length, server: playing[0]?.server.name ?? null };
  }
  return { user: ref(display), unread: topics.size, friends, level: levelProgress(user, ladder) };
}

/**
 * Datele consolei pentru viewer (prima randare pe server; în browser se reîmprospătează live): banda personală, cele 3
 * panouri alese în temă, benzile serverelor și rezumatul live.
 */
export async function cockpitData(actor: GcsActor, settings: GcsThemeSettings["cockpit"]): Promise<GcsCockpitData> {
  const servers = await visibleServers(actor);
  const panels = [settings.left, settings.center, settings.right] as GcsCockpitData["panels"];
  const wants = (p: string) => panels.includes(p as GcsCockpitData["panels"][number]);
  const metrics = await rankingMetrics(actor, COCKPIT_METRICS);
  const [w, feed, live, feat, ranking, summary, poll] = await Promise.all([
    welcome(actor),
    wants("feed") ? cockpitFeed(actor, "all") : [],
    wants("live") ? liveMatch(actor, servers) : { match: null, matches: 0 },
    wants("live") || wants("featured") ? featured(actor) : [],
    wants("top") ? rankingRows(actor, metrics[0] ?? "posts", "week") : Promise.resolve({ metric: "posts" as const, period: "week" as const, rows: [], you: null }),
    liveSummary(actor, servers),
    services()
      .settings.get<number>(POLL_INTERVAL_SETTING)
      .catch(() => 30),
  ]);
  return {
    welcome: w,
    panels,
    feed,
    live: { ...live, featured: feat },
    ranking,
    rankingMetrics: metrics,
    servers: servers.map((s) => ({ id: s.id, name: s.name, href: serverHref(s), connectHref: s.connectHref, address: s.address, game: s.game.key })),
    statuses: Object.fromEntries(servers.map((s) => [s.id, s.status])),
    pollSeconds: poll,
    summary,
  };
}
