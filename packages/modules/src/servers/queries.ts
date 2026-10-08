import type { GcsActor, GcsAppService, GcsCache, GcsPermissionService, GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { connectHref, gameDef, serverAddress } from "./games";
import { SERVERS_APP, SHOW_PLAYERS_SETTING } from "./poller";
import { SERVERS_CACHE_TAG } from "./service";
import type { GcsServerStatusStore } from "./store";
import { liveStatus, type GcsServerLive, type GcsServerPlayer } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Un status mai vechi de atât (worker oprit) nu se mai arată ca live. */
const STALE_MS = 15 * 60_000;
const LIST_TTL = 3600;
const STATS_TTL = 60;
const MAX_MAPS = 12;

export const GCS_HISTORY_RANGES = ["24h", "7d", "30d"] as const;
export type GcsHistoryRange = (typeof GCS_HISTORY_RANGES)[number];
/** Mărimea unei coloane (secunde) și câte coloane are fiecare interval. */
const RANGES: Record<GcsHistoryRange, { size: number; count: number }> = {
  "24h": { size: 3600, count: 24 },
  "7d": { size: 3600, count: 168 },
  "30d": { size: 86_400, count: 30 },
};

type CachedServer = {
  id: number;
  game: string;
  host: string;
  port: number;
  name: string;
  slug: string;
  bannerId: string | null;
  description: string;
  forumId: number | null;
  groups: number[];
};

/** Un server pe `/servers`, în widget și în antetul paginii lui. */
export type GcsServerView = {
  id: number;
  slug: string;
  name: string;
  game: { key: string; name: string; family: string; icon: string; hasMap: boolean };
  address: string;
  connectHref: string | null;
  bannerUrl: string | null;
  bannerGradient: string;
  /** `null` = încă neinterogat sau statusul e prea vechi (worker oprit). */
  status: GcsServerLive | null;
  /** Uptime-ul pe 30 de zile (0–1), `null` fără istoric. */
  uptime30: number | null;
};

export type GcsServerDetails = GcsServerView & {
  description: string;
  forum: { id: number; name: string; slug: string } | null;
  admins: GcsUserRef[];
  /** Lista jucătorilor: `null` = protocolul nu o dă (sau viewer-ul nu o poate vedea, vezi `playersHidden`). */
  players: GcsServerPlayer[] | null;
  playersHidden: boolean;
  uptime: { d1: number | null; d7: number | null; d30: number | null };
  maps: { map: string; from: string; to: string }[];
  peak24: { players: number; at: string } | null;
  avg24: number | null;
};

export type GcsHistoryBucket = { at: string; avg: number | null; peak: number | null; uptime: number | null };
export type GcsServerHistory = { range: GcsHistoryRange; size: number; buckets: GcsHistoryBucket[]; maxPlayers: number };

type BucketRow = { b: bigint | number; avg: number | null; peak: number | null; max: number | null; samples: number; online: number };

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Citirile publice ale aplicației Servere (specul 2026-10-07-servere §5): lista vizibilă viewer-ului, pagina unui
 * server, istoricul pentru grafic și statusurile pentru actualizarea live. Fiecare citire verifică aplicația,
 * `servers.view` și grupurile serverului; lista jucătorilor cere în plus `servers.view_players` și setarea.
 */
export class GcsServerQueries {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      apps: GcsAppService;
      store: GcsServerStatusStore;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Serverele active, în ordinea din ACP (cache, invalidat la orice schimbare din ACP). */
  private async servers(): Promise<CachedServer[]> {
    const hit = await this.deps.cache.get<CachedServer[]>("servers:list");
    if (hit) return hit;
    const rows = await this.deps.db.gameServer.findMany({
      where: { enabled: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, game: true, host: true, port: true, name: true, slug: true, bannerId: true, description: true, forumId: true, groups: true },
    });
    await this.deps.cache.set("servers:list", rows, { ttlSec: LIST_TTL, tags: [SERVERS_CACHE_TAG] });
    return rows;
  }

  async appEnabled(): Promise<boolean> {
    return this.deps.apps.enabled(SERVERS_APP);
  }

  /** Serverele pe care viewer-ul le poate vedea (aplicația activă, `servers.view`, grupurile serverului). */
  private async visibleRows(actor: GcsActor): Promise<CachedServer[]> {
    if (!(await this.appEnabled()) || !(await this.deps.permissions.can(actor, "servers.view"))) return [];
    return (await this.servers()).filter((s) => s.groups.length === 0 || s.groups.some((g) => actor.groupIds.includes(g)));
  }

  private async uptime30All(): Promise<Map<number, number>> {
    const hit = await this.deps.cache.get<[number, number][]>("servers:uptime30");
    if (hit) return new Map(hit);
    const from = iso(this.now() - 30 * DAY);
    const rows = await this.deps.db.$queryRaw<{ id: number; uptime: number | null }[]>`
      SELECT "serverId" AS id, sum("onlineSamples")::float8 / nullif(sum(samples), 0) AS uptime
      FROM server_snapshots WHERE at >= ${from}::timestamp GROUP BY "serverId"`;
    const pairs = rows.filter((r) => r.uptime !== null).map((r) => [r.id, r.uptime!] as [number, number]);
    await this.deps.cache.set("servers:uptime30", pairs, { ttlSec: 300, tags: [SERVERS_CACHE_TAG] });
    return new Map(pairs);
  }

  private view(s: CachedServer, status: GcsServerLive | null, uptime30: number | null): GcsServerView {
    const game = gameDef(s.game);
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      game: { key: s.game, name: game?.name ?? s.game, family: game?.family ?? s.game, icon: game?.icon ?? "fa-solid fa-server", hasMap: game?.hasMap ?? true },
      address: serverAddress(game, s.host, s.port),
      connectHref: connectHref(game, s.host, s.port),
      bannerUrl: s.bannerId ? `/files/${s.bannerId}` : null,
      bannerGradient: game?.banner ?? "linear-gradient(120deg, #14161C, #262A34)",
      status,
      uptime30,
    };
  }

  private async statuses(rows: CachedServer[]): Promise<Map<number, GcsServerLive>> {
    const raw = await this.deps.store.many(rows.map((r) => r.id));
    const out = new Map<number, GcsServerLive>();
    const now = this.now();
    for (const [id, s] of raw) if (now - Date.parse(s.updatedAt) <= STALE_MS) out.set(id, liveStatus(id, s));
    return out;
  }

  /** Lista de pe `/servers` (și din widget), eventual doar o familie de jocuri. */
  async list(actor: GcsActor, opts: { family?: string | null; limit?: number } = {}): Promise<GcsServerView[]> {
    let rows = await this.visibleRows(actor);
    if (opts.family) rows = rows.filter((r) => (gameDef(r.game)?.family ?? r.game) === opts.family);
    if (opts.limit) rows = rows.slice(0, opts.limit);
    const [statuses, uptime] = await Promise.all([this.statuses(rows), this.uptime30All()]);
    return rows.map((r) => this.view(r, statuses.get(r.id) ?? null, uptime.get(r.id) ?? null));
  }

  /** Viewer-ul poate vedea serverul (camera live, bannerul, ruta de status). */
  async canView(actor: GcsActor, id: number): Promise<boolean> {
    return (await this.visibleRows(actor)).some((r) => r.id === id);
  }

  /** Id-urile serverelor vizibile viewer-ului (puntea: statisticile, meciurile, clasamentele). */
  async visibleIds(actor: GcsActor): Promise<number[]> {
    return (await this.visibleRows(actor)).map((r) => r.id);
  }

  /** Accesul la camera live `servers:{id}`. */
  async canJoin(actor: GcsActor, id: string): Promise<boolean> {
    return /^[1-9]\d{0,9}$/.test(id) && this.canView(actor, Number(id));
  }

  async playersAllowed(actor: GcsActor): Promise<boolean> {
    return (await this.deps.settings.get<boolean>(SHOW_PLAYERS_SETTING)) && (await this.deps.permissions.can(actor, "servers.view_players"));
  }

  /** Pagina unui server; `null` = inexistent, dezactivat sau ascuns viewer-ului (404). */
  async details(actor: GcsActor, id: number): Promise<GcsServerDetails | null> {
    const row = (await this.visibleRows(actor)).find((r) => r.id === id);
    if (!row) return null;
    const { db, permissions, store } = this.deps;
    const [raw, uptime30, stats, admins, forum, allowed] = await Promise.all([
      store.get(id),
      this.uptime30All(),
      this.stats(id),
      db.gameServerAdmin.findMany({ where: { serverId: id }, orderBy: { position: "asc" }, select: { user: { select: userRefSelect } } }),
      row.forumId ? db.forum.findUnique({ where: { id: row.forumId }, select: { id: true, name: true, slug: true } }) : Promise.resolve(null),
      this.playersAllowed(actor),
    ]);
    const fresh = raw && this.now() - Date.parse(raw.updatedAt) <= STALE_MS ? raw : null;
    const forumVisible = forum ? await permissions.can(actor, "forums.view", { type: "forum", id: String(forum.id) }) : false;
    return {
      ...this.view(row, fresh ? liveStatus(id, fresh) : null, uptime30.get(id) ?? null),
      description: row.description,
      forum: forum && forumVisible ? forum : null,
      admins: admins.map((a) => toRef(a.user)),
      players: allowed && fresh?.online ? fresh.playerList : null,
      playersHidden: !allowed,
      ...stats,
    };
  }

  /** Uptime-ul pe 1 / 7 / 30 de zile, hărțile din ultimele 24 h, vârful și media pe 24 h (cache 60 s). */
  private async stats(id: number): Promise<Pick<GcsServerDetails, "uptime" | "maps" | "peak24" | "avg24">> {
    const key = `servers:stats:${id}`;
    const hit = await this.deps.cache.get<Pick<GcsServerDetails, "uptime" | "maps" | "peak24" | "avg24">>(key);
    if (hit) return hit;
    const { db } = this.deps;
    const now = this.now();
    const d1 = iso(now - DAY);
    const d7 = iso(now - 7 * DAY);
    const d30 = iso(now - 30 * DAY);
    const [uptime, maps, peak, avg] = await Promise.all([
      db.$queryRaw<{ d1: number | null; d7: number | null; d30: number | null }[]>`
        SELECT sum("onlineSamples") FILTER (WHERE at >= ${d1}::timestamp)::float8 / nullif(sum(samples) FILTER (WHERE at >= ${d1}::timestamp), 0) AS d1,
               sum("onlineSamples") FILTER (WHERE at >= ${d7}::timestamp)::float8 / nullif(sum(samples) FILTER (WHERE at >= ${d7}::timestamp), 0) AS d7,
               sum("onlineSamples")::float8 / nullif(sum(samples), 0) AS d30
        FROM server_snapshots WHERE "serverId" = ${id} AND at >= ${d30}::timestamp`,
      db.$queryRaw<{ map: string; from: Date; to: Date }[]>`
        SELECT map, min(at) AS "from", max(at) AS "to" FROM (
          SELECT at, map, sum(chg) OVER (ORDER BY at) AS grp FROM (
            SELECT at, map, CASE WHEN map IS DISTINCT FROM lag(map) OVER (ORDER BY at) THEN 1 ELSE 0 END AS chg
            FROM server_snapshots
            WHERE "serverId" = ${id} AND hourly = false AND online AND map IS NOT NULL AND at >= ${d1}::timestamp
          ) changes
        ) runs
        GROUP BY grp, map ORDER BY min(at) DESC LIMIT ${MAX_MAPS}`,
      db.$queryRaw<{ peak: number; at: Date }[]>`
        SELECT peak, at FROM server_snapshots WHERE "serverId" = ${id} AND online AND at >= ${d1}::timestamp ORDER BY peak DESC, at DESC LIMIT 1`,
      db.$queryRaw<{ avg: number | null }[]>`
        SELECT sum(players * samples)::float8 / nullif(sum(samples), 0) AS avg
        FROM server_snapshots WHERE "serverId" = ${id} AND online AND at >= ${d1}::timestamp`,
    ]);
    const out = {
      uptime: { d1: uptime[0]?.d1 ?? null, d7: uptime[0]?.d7 ?? null, d30: uptime[0]?.d30 ?? null },
      maps: maps.map((m) => ({ map: m.map, from: m.from.toISOString(), to: m.to.toISOString() })),
      peak24: peak[0] && peak[0].peak > 0 ? { players: peak[0].peak, at: peak[0].at.toISOString() } : null,
      avg24: avg[0]?.avg ?? null,
    };
    await this.deps.cache.set(key, out, { ttlSec: STATS_TTL, tags: [SERVERS_CACHE_TAG] });
    return out;
  }

  /**
   * Istoricul pentru grafic: coloane orare (24 h, 7 zile) sau zilnice (30 de zile), aliniate la UTC; o coloană fără
   * interogări are valorile `null`. Media e ponderată cu greutatea rândurilor (offline = 0 jucători).
   */
  async history(id: number, range: GcsHistoryRange): Promise<GcsServerHistory> {
    const key = `servers:history:${id}:${range}`;
    const hit = await this.deps.cache.get<GcsServerHistory>(key);
    if (hit) return hit;
    const { size, count } = RANGES[range];
    const first = Math.floor(this.now() / 1000 / size) - (count - 1);
    const from = iso(first * size * 1000);
    const rows = await this.deps.db.$queryRaw<BucketRow[]>`
      SELECT floor(extract(epoch from at) / ${size})::bigint AS b,
             sum(players * samples)::float8 / nullif(sum(samples), 0) AS avg,
             max(peak) AS peak,
             max("maxPlayers") AS max,
             sum(samples)::int AS samples,
             sum("onlineSamples")::int AS online
      FROM server_snapshots WHERE "serverId" = ${id} AND at >= ${from}::timestamp
      GROUP BY b ORDER BY b`;
    const byBucket = new Map(rows.map((r) => [Number(r.b), r]));
    let maxPlayers = 0;
    const buckets = Array.from({ length: count }, (_, i) => {
      const b = first + i;
      const r = byBucket.get(b);
      if (r?.max) maxPlayers = Math.max(maxPlayers, r.max);
      return {
        at: iso(b * size * 1000),
        avg: r && r.samples > 0 && r.avg !== null ? Math.round(r.avg * 10) / 10 : null,
        peak: r && r.samples > 0 ? (r.peak ?? 0) : null,
        uptime: r && r.samples > 0 ? r.online / r.samples : null,
      };
    });
    const out = { range, size, buckets, maxPlayers };
    await this.deps.cache.set(key, out, { ttlSec: STATS_TTL, tags: [SERVERS_CACHE_TAG] });
    return out;
  }

  /**
   * Statusurile pentru actualizarea fără realtime (`/api/servers/status`): doar serverele vizibile; lista jucătorilor
   * doar pentru un singur server și doar cu dreptul de a o vedea.
   */
  async live(actor: GcsActor, ids: number[]): Promise<{ servers: GcsServerLive[]; players: GcsServerPlayer[] | null }> {
    const wanted = new Set(ids);
    const rows = (await this.visibleRows(actor)).filter((r) => wanted.has(r.id));
    const statuses = await this.statuses(rows);
    let players: GcsServerPlayer[] | null = null;
    if (wanted.size === 1 && rows.length === 1 && (await this.playersAllowed(actor))) {
      const raw = await this.deps.store.get(rows[0]!.id);
      players = raw?.online ? raw.playerList : null;
    }
    return { servers: [...statuses.values()], players };
  }
}
