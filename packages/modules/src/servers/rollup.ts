import type { PrismaClient } from "@gcs/db";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Cheia lacătului consultativ PostgreSQL al agregării (o singură rulare odată, chiar cu mai mulți workeri). */
const LOCK_KEY = 7_120_031;

export type GcsRollupResult = { aggregated: number; pruned: number };

/**
 * Agregarea și curățarea istoricului (specul 2026-10-07-servere §4.5): rândurile brute mai vechi de `rawDays` (orele
 * complete) devin câte un rând orar pe server (media jucătorilor ponderată cu greutatea, vârful, sloturile, ultima
 * hartă, ping-ul mediu al interogărilor reușite, suma greutăților), după ce tot ce e mai vechi decât `retentionDays`
 * s-a șters. Totul într-o tranzacție; o a doua rulare simultană nu face nimic.
 */
export async function rollupSnapshots(db: PrismaClient, opts: { retentionDays: number; rawDays?: number; now?: Date }): Promise<GcsRollupResult> {
  const now = (opts.now ?? new Date()).getTime();
  const cutoff = new Date(Math.floor((now - (opts.rawDays ?? 7) * DAY) / HOUR) * HOUR).toISOString();
  const pruneBefore = new Date(now - opts.retentionDays * DAY).toISOString();
  return db.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
      if (!lock?.locked) return { aggregated: 0, pruned: 0 };
      // Întâi ce a ieșit din retenție (nu mai merită agregat), apoi orele vechi.
      const pruned = await tx.$executeRaw`DELETE FROM server_snapshots WHERE at < ${pruneBefore}::timestamp`;
      const aggregated = await tx.$executeRaw`
        INSERT INTO server_snapshots ("serverId", at, hourly, online, players, peak, "maxPlayers", map, ping, samples, "onlineSamples")
        SELECT "serverId",
               date_trunc('hour', at),
               true,
               bool_or(online),
               round(sum(players * samples)::numeric / greatest(sum(samples), 1))::int,
               max(peak),
               max("maxPlayers"),
               (array_agg(map ORDER BY at DESC) FILTER (WHERE map IS NOT NULL))[1],
               round(avg(ping) FILTER (WHERE online))::int,
               sum(samples)::int,
               sum("onlineSamples")::int
        FROM server_snapshots
        WHERE hourly = false AND at < ${cutoff}::timestamp
        GROUP BY "serverId", date_trunc('hour', at)`;
      await tx.$executeRaw`DELETE FROM server_snapshots WHERE hourly = false AND at < ${cutoff}::timestamp`;
      return { aggregated, pruned };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
