import type { GcsStatTile, GcsStatsContext } from "@gcs/core";

/**
 * Plăcile din panoul de statistici (specul 2026-10-07-servere §7): serverele online și jucătorii de pe ele, doar din
 * serverele publice (plăcile sunt aceleași pentru toți vizitatorii), din ultimul rând brut al fiecăruia (max 10 minute
 * vechime). Fără niciun server public, plăcile lipsesc. Worker-ul invalidează cache-ul lor la fiecare schimbare.
 */
export async function serverStatTiles({ db }: GcsStatsContext): Promise<GcsStatTile[]> {
  const total = await db.gameServer.count({ where: { enabled: true, groups: { isEmpty: true } } });
  if (total === 0) return [];
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const rows = await db.$queryRaw<{ online: boolean; players: number }[]>`
    SELECT DISTINCT ON (s."serverId") s.online, s.players
    FROM server_snapshots s JOIN game_servers g ON g.id = s."serverId"
    WHERE g.enabled AND cardinality(g.groups) = 0 AND s.hourly = false AND s.at >= ${since}::timestamp
    ORDER BY s."serverId", s.at DESC`;
  const online = rows.filter((r) => r.online);
  return [
    { key: "servers.online", labelKey: "stats.tiles.serversOnline", value: online.length, icon: "fa-solid fa-server", href: "/servers", color: "#3DDC97" },
    { key: "servers.players", labelKey: "stats.tiles.serverPlayers", value: online.reduce((n, r) => n + r.players, 0), icon: "fa-solid fa-gamepad", href: "/servers", color: "#5EA2FF" },
  ];
}
