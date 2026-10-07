import { randomUUID } from "node:crypto";
import type { BlockList } from "node:net";
import type { GcsAppService, GcsCache, GcsJobQueue, GcsRealtime, GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { serversAllowNets } from "./net";
import { queryGameServer, type GcsQueryOptions, type GcsServerTarget } from "./query";
import { rollupSnapshots } from "./rollup";
import type { GcsServerStatusStore } from "./store";
import { liveStatus, type GcsServerStatus } from "./types";

export const SERVERS_APP = "servers";
export const POLL_JOB = "servers.poll";
export const ROLLUP_JOB = "servers.rollup";
export const POLL_INTERVAL_SETTING = "servers.poll_interval";
export const RETENTION_SETTING = "servers.retention_days";
export const SHOW_PLAYERS_SETTING = "servers.show_players";
/** Camera live a unui server și evenimentul de status (specul 2026-10-07-servere §5.3). */
export const serverRoom = (id: number) => `servers:${id}`;
export const STATUS_EVENT = "servers:status";
/** Tag-ul plăcilor de statistici ale aplicației (vezi `GcsStatsService`). */
export const SERVERS_STATS_TAG = "stats:servers";

const TICK_MS = 10_000;
/** Lacătul rundei (eliberat la final); expiră singur dacă worker-ul cade în timpul rundei. */
const LOCK_MS = 120_000;
/** Cât rămâne rezervat un server luat într-o rundă (până își salvează rezultatul). */
const CLAIM_MS = 60_000;
const CONCURRENCY = 4;
export const MAX_SERVERS = 100;
const MAX_DELAY_S = 600;

/** Multiplicatorul intervalului după `failures` eșecuri la rând: 0 și 1 → 1, apoi 2, 4, 8, 16. */
export function backoffMultiplier(failures: number): number {
  return failures <= 1 ? 1 : 2 ** Math.min(failures - 1, 4);
}

/** Secundele până la următoarea interogare: intervalul, înmulțit de backoff și plafonat la 10 minute. */
export function nextPollDelay(intervalSec: number, failures: number): number {
  return Math.min(intervalSec * backoffMultiplier(failures), Math.max(intervalSec, MAX_DELAY_S));
}

type PollTarget = GcsServerTarget & { id: number };
export type GcsServerQueryFn = (target: GcsServerTarget, opts: GcsQueryOptions) => Promise<GcsServerStatus>;

/** Ce vede publicul s-a schimbat (ping-ul singur nu se publică). */
function changed(before: GcsServerStatus | null, after: GcsServerStatus): boolean {
  if (!before) return true;
  return before.online !== after.online || before.players !== after.players || before.maxPlayers !== after.maxPlayers || before.map !== after.map || before.name !== after.name;
}

/** Rulează `fn` pe toate elementele, cu cel mult `limit` în paralel. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

/**
 * Interogarea serverelor în `gcs-worker` (specul 2026-10-07-servere §4): runda de 10 s alege serverele scadente
 * (intervalul din ACP, cu backoff pentru cele căzute), le interoghează cu concurență 4, salvează statusul în Redis și
 * un rând brut în istoric, apoi publică live schimbările.
 */
export class GcsServerPoller {
  private readonly query: GcsServerQueryFn;
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      db: PrismaClient;
      store: GcsServerStatusStore;
      realtime: GcsRealtime;
      cache: GcsCache;
      settings: GcsSettingsService;
      apps: GcsAppService;
      query?: GcsServerQueryFn;
      now?: () => number;
      allow?: () => BlockList | null;
    },
  ) {
    this.query = deps.query ?? queryGameServer;
    this.now = deps.now ?? Date.now;
  }

  /** O rundă: întoarce câte servere a interogat (0 dacă aplicația e dezactivată sau altă rundă rulează). */
  async tick(): Promise<number> {
    const { db, store, apps, settings } = this.deps;
    if (!(await apps.enabled(SERVERS_APP))) return 0;
    const token = randomUUID();
    if (!(await store.lock(token, LOCK_MS))) return 0;
    try {
      const [servers, interval, showPlayers] = await Promise.all([
        db.gameServer.findMany({ where: { enabled: true }, orderBy: [{ position: "asc" }, { id: "asc" }], take: MAX_SERVERS, select: { id: true, game: true, host: true, port: true, queryPort: true } }),
        settings.get<number>(POLL_INTERVAL_SETTING),
        settings.get<boolean>(SHOW_PLAYERS_SETTING),
      ]);
      await store.prune(new Set(servers.map((s) => s.id)));
      const { next, failures } = await store.schedule();
      const now = this.now();
      const due = servers.filter((s) => (next.get(s.id) ?? 0) <= now);
      await store.claim(due.map((s) => s.id), now + CLAIM_MS);
      await eachLimited(due, CONCURRENCY, async (s) => void (await this.pollOne(s, { interval, failures: failures.get(s.id) ?? 0, players: showPlayers })));
      return due.length;
    } finally {
      await store.unlock(token);
    }
  }

  /** Interoghează un server și salvează rezultatul (statusul, programarea, istoricul), apoi publică schimbarea. */
  async pollOne(server: PollTarget, opts: { interval: number; failures: number; players: boolean }): Promise<GcsServerStatus> {
    const { db, store, realtime, cache } = this.deps;
    const previous = await store.get(server.id);
    const status = await this.query(server, { players: opts.players, allow: (this.deps.allow ?? serversAllowNets)() });
    const failures = status.online ? 0 : opts.failures + 1;
    const delay = nextPollDelay(opts.interval, failures);
    // Greutatea rândului = cât din timp acoperă (un server căzut, interogat mai rar, cântărește mai mult).
    const samples = Math.max(1, Math.round(delay / opts.interval));
    const at = this.now();
    await store.save(server.id, status, { nextAt: at + delay * 1000, failures });
    await db.serverSnapshot
      .create({
        data: {
          serverId: server.id,
          at: new Date(at),
          online: status.online,
          players: status.players,
          peak: status.players,
          maxPlayers: status.maxPlayers,
          map: status.map,
          ping: status.ping,
          samples,
          onlineSamples: status.online ? samples : 0,
        },
      })
      // Serverul a fost șters între timp: rândul nu mai are unde să meargă.
      .catch(() => undefined);
    if (changed(previous, status)) {
      await realtime.publish(serverRoom(server.id), STATUS_EVENT, liveStatus(server.id, status));
      if (!previous || previous.online !== status.online || previous.players !== status.players) await cache.invalidateTags([SERVERS_STATS_TAG]);
    }
    return status;
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({ name: POLL_JOB, everyMs: TICK_MS, handler: async () => void (await this.tick()) });
    jobs.register({
      name: ROLLUP_JOB,
      everyMs: 3_600_000,
      handler: async () => void (await rollupSnapshots(this.deps.db, { retentionDays: await this.deps.settings.get<number>(RETENTION_SETTING) })),
    });
  }
}
