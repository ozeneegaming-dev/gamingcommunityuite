import { JSON_EMPTY_LIST } from "@gcs/db";
import type { GcsStatTile, GcsStatsContext } from "@gcs/core";

/**
 * Plăcile din panoul de statistici (specul 2026-10-07-servere §7): serverele online și jucătorii de pe ele, doar din
 * serverele publice (plăcile sunt aceleași pentru toți vizitatorii), din ultimul rând brut al fiecăruia (max 10 minute
 * vechime). Fără niciun server public, plăcile lipsesc. Worker-ul invalidează cache-ul lor la fiecare schimbare.
 */
export async function serverStatTiles({ db }: GcsStatsContext): Promise<GcsStatTile[]> {
  const servers = await db.gameServer.findMany({ where: { enabled: true, groups: JSON_EMPTY_LIST }, select: { id: true } });
  if (servers.length === 0) return [];
  const snapshots = await db.serverSnapshot.findMany({
    where: { serverId: { in: servers.map((g) => g.id) }, hourly: false, at: { gte: new Date(Date.now() - 10 * 60_000) } },
    orderBy: [{ serverId: "asc" }, { at: "desc" }],
    select: { serverId: true, online: true, players: true },
  });
  // Ultimul rând al fiecărui server.
  const rows = snapshots.filter((r, i) => i === 0 || snapshots[i - 1]!.serverId !== r.serverId);
  const online = rows.filter((r) => r.online);
  return [
    { key: "servers.online", labelKey: "stats.tiles.serversOnline", value: online.length, icon: "fa-solid fa-server", href: "/servers", color: "#3DDC97" },
    { key: "servers.players", labelKey: "stats.tiles.serverPlayers", value: online.reduce((n, r) => n + r.players, 0), icon: "fa-solid fa-gamepad", href: "/servers", color: "#5EA2FF" },
  ];
}
