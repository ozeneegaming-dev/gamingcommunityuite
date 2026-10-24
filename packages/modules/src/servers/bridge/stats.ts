import { Prisma, sqlIdent, type PrismaClient, sql } from "@gcs/db";
import type { GcsPlayerStatsAggregate, GcsPlayerStatsProvider, GcsPlayerStatsScope } from "../playerStats";

/**
 * Statisticile (specul 2026-10-08-servere-bridge §9): totalurile pe jucător și server, pe armă și pe hartă (adunate în
 * tranzacția fiecărui eveniment), locurile pe server (jobul `servers.bridge.ranks`) și furnizorul citit de Clanuri.
 */

type Tx = Prisma.TransactionClient | PrismaClient;

export const PLAYER_STAT_KEYS = ["kills", "deaths", "headshots", "assists", "teamkills", "suicides", "shots", "hits", "damage", "playtime", "rounds", "roundsWon"] as const;
export const WEAPON_STAT_KEYS = ["kills", "deaths", "headshots", "shots", "hits", "damage"] as const;
export const MAP_STAT_KEYS = ["kills", "deaths", "headshots", "playtime", "rounds", "roundsWon"] as const;

type Delta<K extends string> = Partial<Record<K, number>>;

/** Adună deltele într-un rând (`INSERT … ON CONFLICT DO UPDATE`), cu coloanele dintr-o listă fixă. */
async function addRow(tx: Tx, table: string, keys: Record<string, unknown>, delta: Record<string, number>, extra: { set?: Record<string, Prisma.Sql>; insert?: Record<string, unknown> } = {}): Promise<void> {
  const cols = Object.entries(delta).filter(([, v]) => Number.isFinite(v) && v !== 0);
  if (cols.length === 0 && !extra.set) return;
  const keyCols = Object.keys(keys);
  const insertCols = [...keyCols, ...cols.map(([c]) => c), ...Object.keys(extra.insert ?? {})];
  // Timpii: text ISO cu `::timestamp` (coloanele sunt fără fus orar; un `Date` brut ar fi mutat de fusul sesiunii).
  const values = [...Object.values(keys), ...cols.map(([, v]) => Math.trunc(v)), ...Object.values(extra.insert ?? {})].map((v) => (v instanceof Date ? sql`${v.toISOString()}::timestamp` : v));
  const ident = (c: string) => sqlIdent(c);
  const updates = [
    ...cols.map(([c]) => sql`${ident(c)} = ${Prisma.raw(table)}.${ident(c)} + EXCLUDED.${ident(c)}`),
    ...Object.entries(extra.set ?? {}).map(([c, expr]) => sql`${ident(c)} = ${expr}`),
  ];
  await tx.$executeRaw(sql`
    INSERT INTO ${Prisma.raw(table)} (${Prisma.join(insertCols.map(ident))}) VALUES (${Prisma.join(values)})
    ON CONFLICT (${Prisma.join(keyCols.map(ident))}) DO UPDATE SET ${Prisma.join(updates)}`);
}

/** Deltele unui jucător pe un server; scorul (ucideri − decese − ucideri în echipă) se actualizează odată cu ele. */
export async function addPlayerStats(tx: Tx, playerId: number, serverId: number, delta: Delta<(typeof PLAYER_STAT_KEYS)[number]>, at: Date): Promise<void> {
  const score = (delta.kills ?? 0) - (delta.deaths ?? 0) - (delta.teamkills ?? 0);
  await addRow(
    tx,
    "game_player_stats",
    { playerId, serverId },
    { ...delta, score },
    { insert: { lastSeenAt: at }, set: { lastSeenAt: sql`GREATEST(game_player_stats."lastSeenAt", EXCLUDED."lastSeenAt")` } },
  );
}

export async function addWeaponStats(tx: Tx, playerId: number, serverId: number, weapon: string, delta: Delta<(typeof WEAPON_STAT_KEYS)[number]>): Promise<void> {
  await addRow(tx, "game_weapon_stats", { playerId, serverId, weapon }, delta);
}

export async function addMapStats(tx: Tx, playerId: number, serverId: number, map: string, delta: Delta<(typeof MAP_STAT_KEYS)[number]>): Promise<void> {
  await addRow(tx, "game_map_stats", { playerId, serverId, map }, delta);
}

/**
 * Locurile pe server (jobul `servers.bridge.ranks`, la 10 minute): jucătorii cu cel puțin `minMinutes` minute de joc,
 * după scor, apoi după ucideri; ceilalți nu au loc. Doar rândurile schimbate se scriu.
 */
export async function recomputeRanks(db: PrismaClient, minMinutes: number): Promise<number> {
  const min = Math.max(0, Math.floor(minMinutes)) * 60;
  return db.$transaction(async (tx) => {
    const ranked = await tx.$executeRaw(sql`
      UPDATE game_player_stats s SET rank = r.rank
      FROM (
        SELECT "playerId", "serverId", ROW_NUMBER() OVER (PARTITION BY "serverId" ORDER BY score DESC, kills DESC, "playerId" ASC)::int AS rank
        FROM game_player_stats WHERE playtime >= ${min}
      ) r
      WHERE s."playerId" = r."playerId" AND s."serverId" = r."serverId" AND s.rank IS DISTINCT FROM r.rank`);
    const cleared = await tx.$executeRaw(sql`UPDATE game_player_stats SET rank = NULL WHERE playtime < ${min} AND rank IS NOT NULL`);
    return ranked + cleared;
  });
}

type StatRow = {
  userId: string;
  kills: number;
  deaths: number;
  headshots: number;
  shots: number;
  hits: number;
  playtime: number;
  lastSeenAt: Date | null;
  lastServerId: number | null;
  rank: number | null;
};
type MixRow = { userId: string; played: number; won: number; kills: number; deaths: number; headshots: number; mvps: number };
type EloRow = { userId: string; elo: number };

/**
 * Furnizorul statisticilor pentru Clanuri (`GcsPlayerStatsProvider`, §9): adună identitățile `STEAM` și `NONSTEAM`
 * legate de fiecare membru. `scope = "all"` (toate serverele), un id de server (cu locul cel mai bun pe el) sau
 * `"mix"` (doar meciurile mix încheiate). ELO-ul e al identității cu cele mai multe meciuri.
 */
export class GcsBridgeStatsProvider implements GcsPlayerStatsProvider {
  constructor(private readonly deps: { db: PrismaClient }) {}

  /** Membrii cu cel puțin o identitate `STEAM` / `NONSTEAM` legată. */
  async linkedUsers(userIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(userIds)].slice(0, 5000);
    if (ids.length === 0) return new Set();
    const rows = await this.deps.db.gamePlayer.findMany({ where: { userId: { in: ids }, kind: { in: ["STEAM", "NONSTEAM"] } }, select: { userId: true }, distinct: ["userId"] });
    return new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])));
  }

  async forUsers(userIds: string[], opts: { scope: GcsPlayerStatsScope }): Promise<Map<string, GcsPlayerStatsAggregate>> {
    const { db } = this.deps;
    const out = new Map<string, GcsPlayerStatsAggregate>();
    const ids = [...new Set(userIds)].slice(0, 5000);
    if (ids.length === 0) return out;
    const scope = opts.scope;
    const serverFilter = typeof scope === "number" ? sql`AND s."serverId" = ${scope}` : Prisma.empty;

    const [mix, elo] = await Promise.all([
      db.$queryRaw<MixRow[]>(sql`
        SELECT p."userId", COUNT(*)::int AS played,
          COUNT(*) FILTER (WHERE m.winner = mp.team)::int AS won,
          COALESCE(SUM(mp.kills), 0)::int AS kills, COALESCE(SUM(mp.deaths), 0)::int AS deaths,
          COALESCE(SUM(mp.headshots), 0)::int AS headshots, COALESCE(SUM(mp.mvps), 0)::int AS mvps
        FROM game_match_players mp
        JOIN game_matches m ON m.id = mp."matchId" AND m.status = 'ENDED'
        JOIN game_players p ON p.id = mp."playerId" AND p.kind IN ('STEAM', 'NONSTEAM')
        WHERE p."userId" IN (${Prisma.join(ids)})
        GROUP BY p."userId"`),
      db.$queryRaw<EloRow[]>(sql`
        SELECT DISTINCT ON (p."userId") p."userId", r.elo
        FROM game_ratings r JOIN game_players p ON p.id = r."playerId" AND p.kind IN ('STEAM', 'NONSTEAM')
        WHERE p."userId" IN (${Prisma.join(ids)})
        ORDER BY p."userId", r.matches DESC, r.elo DESC`),
    ]);
    const mixBy = new Map(mix.map((r) => [r.userId, r]));
    const eloBy = new Map(elo.map((r) => [r.userId, r.elo]));

    if (scope === "mix") {
      for (const r of mix) {
        out.set(r.userId, {
          kills: r.kills,
          deaths: r.deaths,
          headshots: r.headshots,
          accuracy: null,
          playtimeSeconds: 0,
          lastSeenAt: null,
          lastServerId: null,
          serverRank: null,
          mixPlayed: r.played,
          mixWon: r.won,
          elo: eloBy.get(r.userId) ?? null,
          mvps: r.mvps,
        });
      }
      return out;
    }

    const rows = await db.$queryRaw<StatRow[]>(sql`
      SELECT p."userId",
        COALESCE(SUM(s.kills), 0)::int AS kills, COALESCE(SUM(s.deaths), 0)::int AS deaths,
        COALESCE(SUM(s.headshots), 0)::int AS headshots, COALESCE(SUM(s.shots), 0)::int AS shots,
        COALESCE(SUM(s.hits), 0)::int AS hits, COALESCE(SUM(s.playtime), 0)::int AS playtime,
        MAX(s."lastSeenAt") AS "lastSeenAt",
        (ARRAY_AGG(s."serverId" ORDER BY s."lastSeenAt" DESC))[1] AS "lastServerId",
        MIN(s.rank)::int AS rank
      FROM game_player_stats s
      JOIN game_players p ON p.id = s."playerId" AND p.kind IN ('STEAM', 'NONSTEAM')
      WHERE p."userId" IN (${Prisma.join(ids)}) ${serverFilter}
      GROUP BY p."userId"`);
    for (const r of rows) {
      const m = mixBy.get(r.userId);
      out.set(r.userId, {
        kills: r.kills,
        deaths: r.deaths,
        headshots: r.headshots,
        accuracy: r.shots > 0 ? Math.min(1, r.hits / r.shots) : null,
        playtimeSeconds: r.playtime,
        lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
        // MySQL: primul din GROUP_CONCAT vine ca text.
        lastServerId: r.lastServerId == null ? null : Number(r.lastServerId),
        serverRank: typeof scope === "number" ? r.rank : null,
        mixPlayed: m?.played ?? 0,
        mixWon: m?.won ?? 0,
        elo: eloBy.get(r.userId) ?? null,
        mvps: m?.mvps ?? 0,
      });
    }
    // Membrii doar cu meciuri mix (fără statistici clasice) apar și în scope-ul „all”.
    if (scope === "all") {
      for (const m of mix) {
        if (out.has(m.userId)) continue;
        out.set(m.userId, { kills: 0, deaths: 0, headshots: 0, accuracy: null, playtimeSeconds: 0, lastSeenAt: null, lastServerId: null, serverRank: null, mixPlayed: m.played, mixWon: m.won, elo: eloBy.get(m.userId) ?? null, mvps: m.mvps });
      }
    }
    return out;
  }
}
