import "server-only";
import type { GcsActor } from "@gcs/core";
import type { GcsServerView } from "@gcs/modules";
import { EMPTY_SUMMARY, type GcsLiveSummary } from "./live-summary";
import { services } from "./services";

/** Serverele vizibile viewer-ului (fără aplicația Servere sau fără drept: lista goală). */
export async function visibleServers(actor: GcsActor): Promise<GcsServerView[]> {
  const { serverQueries } = services();
  if (!(await serverQueries.appEnabled())) return [];
  return serverQueries.list(actor).catch(() => []);
}

/**
 * Rezumatul live pentru viewer: serverele lui vizibile, meciurile mix live (cu dreptul de statistici), membrii
 * (totalul și cei online, fără cei ascunși din numărătoarea publică), cei din camerele publice de chat.
 */
export async function liveSummary(actor: GcsActor, servers?: GcsServerView[]): Promise<GcsLiveSummary> {
  const { db, presence, bridge, apps } = services();
  const usable = await apps.accessFilter(actor);
  // Doar serverele de joc: utilizatorii TeamSpeak / membrii Discord nu sunt „jucători online”.
  const all = servers ?? (await visibleServers(actor));
  const list = all.filter((s) => s.game.kind === "game");
  const online = list.filter((s) => s.status?.online);
  const [matches, total, present, chatOnline] = await Promise.all([
    all.length > 0 && (await bridge.queries.canViewStats(actor).catch(() => false)) ? bridge.queries.matchCounts(actor, {}).then((c) => c.live).catch(() => 0) : 0,
    db.user.count({ where: { isBot: false } }),
    presence.online().catch(() => ({ users: [] as string[], guests: 0, record: null })),
    usable("chat") ? chatPresence() : Promise.resolve(null),
  ]);
  return {
    ...EMPTY_SUMMARY,
    servers: {
      enabled: all.length > 0,
      online: online.length,
      total: list.length,
      players: online.reduce((n, s) => n + (s.status?.players ?? 0), 0),
      slots: online.reduce((n, s) => n + (s.status?.maxPlayers ?? 0), 0),
    },
    liveMatches: matches,
    members: { total, online: present.users.length },
    chatOnline,
    vip: usable("vip"),
  };
}

/** Membrii distincți din camerele publice de chat (lista de prezență a fiecărei camere). */
async function chatPresence(): Promise<number> {
  const { db, presence } = services();
  const rooms = await db.chatChannel.findMany({ where: { enabled: true, type: "PUBLIC" }, select: { key: true } });
  const users = new Set<string>();
  for (const r of rooms) for (const u of (await presence.roomMembers(`chat:${r.key}`).catch(() => ({ users: [] as string[] }))).users) users.add(u);
  return users.size;
}
