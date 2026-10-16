import type { GcsAchievementContext, GcsAchievementEventDef } from "@gcs/core";
import { Prisma } from "@gcs/db";

type Stat = "kills" | "headshots" | "playtime";

/** Suma unei statistici a jucătorilor legați de membru, pe serverele alese (toate, dacă lista e goală). */
async function statSum({ db }: GcsAchievementContext, userId: string, serverIds: number[], stat: Stat): Promise<number> {
  const col = Prisma.raw(`s."${stat}"`);
  const rows = await db.$queryRaw<{ total: bigint | null }[]>`
    SELECT SUM(${col})::bigint AS total FROM game_player_stats s JOIN game_players p ON p.id = s."playerId"
    WHERE p."userId" = ${userId} ${serverIds.length > 0 ? Prisma.sql`AND s."serverId" IN (${Prisma.join(serverIds)})` : Prisma.empty}`;
  return Number(rows[0]?.total ?? 0);
}

const stat = (key: string, icon: string, s: Stat, divide = 1): GcsAchievementEventDef => ({
  key,
  labelKey: `achievements.events.${key}`,
  icon,
  kind: "value",
  scopes: ["server"],
  rankMetric: true,
  current: async (ctx, userId, { serverIds }) => Math.floor((await statSum(ctx, userId, serverIds, s)) / divide),
});

const linked = (e: { payload: Record<string, unknown> }) => (typeof e.payload.userId === "string" ? [{ userId: e.payload.userId, ref: "value" }] : []);

/**
 * Evenimentele aplicației Servere (Realizări v2): ucideri, headshot-uri, ore jucate, victorii mix, ELO și prima
 * conectare. Sunt valori citite din statisticile punții; se verifică la legarea unui jucător, la evaluarea membrului
 * și în sweep-ul jucătorilor activi (jobul `achievements.game_sweep`).
 */
export const serverAchievementEvents: GcsAchievementEventDef[] = [
  stat("servers.kills", "fa-solid fa-crosshairs", "kills"),
  stat("servers.headshots", "fa-solid fa-skull", "headshots"),
  stat("servers.hours", "fa-solid fa-hourglass-half", "playtime", 3600),
  {
    key: "servers.mix_wins",
    labelKey: "achievements.events.servers.mix_wins",
    icon: "fa-solid fa-flag-checkered",
    kind: "value",
    rankMetric: true,
    current: async ({ db }, userId) => (await db.gameRating.aggregate({ where: { player: { userId } }, _sum: { wins: true } }))._sum.wins ?? 0,
  },
  {
    key: "servers.elo",
    labelKey: "achievements.events.servers.elo",
    icon: "fa-solid fa-chart-line",
    kind: "value",
    rankMetric: true,
    current: async ({ db }, userId) => (await db.gameRating.aggregate({ where: { player: { userId } }, _max: { elo: true } }))._max.elo ?? 0,
  },
  {
    key: "servers.first_connect",
    labelKey: "achievements.events.servers.first_connect",
    icon: "fa-solid fa-plug",
    kind: "value",
    scopes: ["server"],
    sources: [{ event: "servers.player.linked", map: linked }],
    current: async ({ db }, userId, { serverIds }) => ((await db.gamePlayerStat.count({ where: { player: { userId }, ...(serverIds.length > 0 ? { serverId: { in: serverIds } } : {}) } })) > 0 ? 1 : 0),
  },
];
