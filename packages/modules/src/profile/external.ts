import type { GcsJobQueue, GcsSettingsService } from "@gcs/core";
import { Prisma, type PrismaClient, sql } from "@gcs/db";
import { accountFromSteam64, steam2, steam3 } from "../servers/bridge/steamid";

/**
 * Conturile externe pe profilul public (profil gaming v2 §2): tabul Steam (Steam Web API, cheia din ACP → Autentificare)
 * și tabul FACEIT CS2 (cheia FACEIT din ACP → Profiluri). Datele se aduc doar pentru membrii care și-au legat Steam-ul,
 * de worker (jobul `profile.external.refresh`), și se păstrează în `external_profiles`; pagina citește doar cache-ul și
 * cere o reîmprospătare când datele sunt vechi. Se păstrează doar ce ține de contul legat (fără lista de prieteni etc.).
 */

export const EXTERNAL_REFRESH_JOB = "profile.external.refresh";
export const EXTERNAL_SWEEP_JOB = "profile.external.sweep";
export const FACEIT_KEY_SETTING = "profile.faceit_api_key";
export const STEAM_KEY_SETTING = "auth.steam_api_key";
/** Datele mai vechi de atât se cer din nou la următoarea vizită pe profil. */
export const EXTERNAL_STALE_MS = 6 * 3600_000;
const SWEEP_BATCH = 25;
const ELO_HISTORY_MAX = 30;
const TOP_GAMES = 50;

export type GcsExternalProvider = "steam" | "faceit";

// ─── Steam ────────────────────────────────────────────────────────────────────────────────────────

export type GcsSteamStatus = "online" | "offline" | "busy" | "away" | "snooze" | "trade" | "play";

export type GcsSteamGame = { appId: number; name: string; hours: number; twoWeekHours: number };

export type GcsSteamView = {
  steamId64: string;
  steamId: string;
  steamId3: string;
  profileUrl: string;
  name: string;
  /** `false` = profil privat: Steam nu dă jocurile și orele. */
  public: boolean;
  status: GcsSteamStatus;
  inGame: string | null;
  level: number | null;
  createdAt: string | null;
  lastOnlineAt: string | null;
  bans: { vac: number; game: number; community: boolean; economy: boolean; daysSinceLast: number | null };
  games: { count: number | null; totalHours: number; twoWeekHours: number; recent: GcsSteamGame[]; top: GcsSteamGame[] };
};

/** Răspunsurile brute ale celor 5 metode Steam Web API (oricare poate lipsi). */
export type GcsSteamRaw = {
  summary?: unknown;
  level?: unknown;
  bans?: unknown;
  owned?: unknown;
  recent?: unknown;
};

const STATUS: GcsSteamStatus[] = ["offline", "online", "busy", "away", "snooze", "trade", "play"];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown, max = 120): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : "");
const hours = (minutes: unknown) => Math.round(((num(minutes) ?? 0) / 60) * 10) / 10;
const unix = (v: unknown): string | null => {
  const n = num(v);
  return n !== null && n > 0 ? new Date(n * 1000).toISOString() : null;
};

/** Datele afișate în tabul Steam, din răspunsurile Steam Web API (valori lipsă sau ciudate → implicite sigure). */
export function mapSteam(steamId64: string, raw: GcsSteamRaw): GcsSteamView {
  const player = obj((obj(obj(raw.summary).response).players as unknown[] | undefined)?.[0]);
  const bans = obj((obj(raw.bans).players as unknown[] | undefined)?.[0]);
  const owned = obj(obj(raw.owned).response);
  const recent = obj(obj(raw.recent).response);
  const account = accountFromSteam64(steamId64) ?? 0;
  const game = (g: unknown): GcsSteamGame => {
    const o = obj(g);
    return { appId: num(o.appid) ?? 0, name: str(o.name, 100) || `App ${num(o.appid) ?? 0}`, hours: hours(o.playtime_forever), twoWeekHours: hours(o.playtime_2weeks) };
  };
  const ownedGames = Array.isArray(owned.games) ? owned.games.map(game) : [];
  const recentGames = Array.isArray(recent.games) ? recent.games.map(game) : [];
  const state = num(player.personastate) ?? 0;
  return {
    steamId64,
    steamId: steam2(account, "cs16"),
    steamId3: steam3(account),
    profileUrl: `https://steamcommunity.com/profiles/${steamId64}`,
    name: str(player.personaname, 64),
    public: num(player.communityvisibilitystate) === 3,
    status: STATUS[state] ?? "offline",
    inGame: str(player.gameextrainfo, 100) || null,
    level: num(obj(obj(raw.level).response).player_level),
    createdAt: unix(player.timecreated),
    lastOnlineAt: unix(player.lastlogoff),
    bans: {
      vac: num(bans.NumberOfVACBans) ?? (bans.VACBanned === true ? 1 : 0),
      game: num(bans.NumberOfGameBans) ?? 0,
      community: bans.CommunityBanned === true,
      economy: typeof bans.EconomyBan === "string" && bans.EconomyBan !== "none",
      daysSinceLast: (num(bans.NumberOfVACBans) ?? 0) + (num(bans.NumberOfGameBans) ?? 0) > 0 ? num(bans.DaysSinceLastBan) : null,
    },
    games: {
      count: num(owned.game_count),
      totalHours: Math.round(ownedGames.reduce((s, g) => s + g.hours, 0) * 10) / 10,
      twoWeekHours: Math.round(recentGames.reduce((s, g) => s + g.twoWeekHours, 0) * 10) / 10,
      recent: recentGames.slice(0, 6),
      top: [...ownedGames].sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)).slice(0, TOP_GAMES),
    },
  };
}

// ─── FACEIT ───────────────────────────────────────────────────────────────────────────────────────

export type GcsFaceitMatch = { id: string; at: string; result: "W" | "L"; score: string };

export type GcsFaceitView = {
  playerId: string;
  nickname: string;
  url: string;
  level: number | null;
  elo: number | null;
  stats: { matches: number; winRate: number | null; kd: number | null; hs: number | null; adr: number | null; longestStreak: number | null; currentStreak: number | null; recent: ("W" | "L")[] };
  /** ELO-ul la fiecare citire (cel mult 30 de puncte): graficul din tab. */
  history: { at: string; elo: number }[];
  matches: GcsFaceitMatch[];
};

export type GcsFaceitRaw = { player?: unknown; stats?: unknown; history?: unknown };

/** Datele tabului FACEIT CS2; `previous` = istoricul ELO deja salvat (se adaugă punctul nou, dacă s-a schimbat). */
export function mapFaceit(raw: GcsFaceitRaw, previous: { at: string; elo: number }[] = [], now = new Date()): GcsFaceitView | null {
  const player = obj(raw.player);
  const playerId = str(player.player_id, 64);
  if (!playerId) return null;
  const cs2 = obj(obj(player.games).cs2);
  const lifetime = obj(obj(raw.stats).lifetime);
  const elo = num(cs2.faceit_elo);
  const nickname = str(player.nickname, 64);
  const rate = (v: unknown) => {
    const n = num(v);
    return n === null ? null : Math.round(n * 100) / 100;
  };
  const recent = (Array.isArray(lifetime["Recent Results"]) ? lifetime["Recent Results"] : []).slice(-5).map((r) => (String(r) === "1" ? "W" : "L") as "W" | "L");
  const items = Array.isArray(obj(raw.history).items) ? (obj(raw.history).items as unknown[]) : [];
  const matches: GcsFaceitMatch[] = items.slice(0, 10).flatMap((it) => {
    const m = obj(it);
    const results = obj(m.results);
    const teams = obj(m.teams);
    const mine = Object.entries(teams).find(([, t]) => (Array.isArray(obj(t).players) ? (obj(t).players as unknown[]) : []).some((p) => obj(p).player_id === playerId))?.[0];
    const score = obj(results.score);
    const at = unix(m.finished_at ?? m.started_at);
    if (!mine || !at) return [];
    const other = Object.keys(teams).find((k) => k !== mine);
    return [{ id: str(m.match_id, 80), at, result: results.winner === mine ? "W" : "L", score: other ? `${num(score[mine]) ?? 0}–${num(score[other]) ?? 0}` : "" }];
  });
  const history = [...previous].slice(-(ELO_HISTORY_MAX - 1));
  if (elo !== null && history.at(-1)?.elo !== elo) history.push({ at: now.toISOString(), elo });
  return {
    playerId,
    nickname,
    url: nickname ? `https://www.faceit.com/en/players/${encodeURIComponent(nickname)}` : "https://www.faceit.com",
    level: num(cs2.skill_level),
    elo,
    stats: {
      matches: num(lifetime.Matches) ?? 0,
      winRate: rate(lifetime["Win Rate %"]),
      kd: rate(lifetime["Average K/D Ratio"]),
      hs: rate(lifetime["Average Headshots %"]),
      adr: rate(lifetime.ADR ?? lifetime["Average ADR"]),
      longestStreak: num(lifetime["Longest Win Streak"]),
      currentStreak: num(lifetime["Current Win Streak"]),
      recent,
    },
    history: history.slice(-ELO_HISTORY_MAX),
    matches,
  };
}

// ─── Serviciul ────────────────────────────────────────────────────────────────────────────────────

export type GcsExternalEntry<T> = { data: T; fetchedAt: string; error: string | null };

/** O eroare de citire, cu un cod scurt (salvat lângă datele vechi). */
class GcsExternalError extends Error {}

export class GcsExternalProfiles {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      settings: GcsSettingsService;
      jobs: Pick<GcsJobQueue, "enqueue">;
      fetch?: typeof fetch;
    },
  ) {}

  private get http(): typeof fetch {
    return this.deps.fetch ?? fetch;
  }

  /** SteamID64-ul legat de cont (login sau legare Steam), sau `null`. */
  async steamId(userId: string): Promise<string | null> {
    const row = await this.deps.db.account.findFirst({ where: { userId, providerId: "steam" }, select: { accountId: true } });
    return row && /^\d{17}$/.test(row.accountId) ? row.accountId : null;
  }

  /** Cheia Steam Web API (ACP → Autentificare) și cheia FACEIT (ACP → Profiluri) sunt completate. */
  async configured(): Promise<{ steam: boolean; faceit: boolean }> {
    const [steam, faceit] = await Promise.all([this.deps.settings.get<string>(STEAM_KEY_SETTING), this.deps.settings.get<string>(FACEIT_KEY_SETTING)]);
    return { steam: Boolean(steam), faceit: Boolean(faceit) };
  }

  private async entry<T>(userId: string, provider: GcsExternalProvider, now: Date): Promise<GcsExternalEntry<T> | null> {
    const row = await this.deps.db.externalProfile.findUnique({ where: { userId_provider: { userId, provider } } });
    if (!row || now.getTime() - row.fetchedAt.getTime() > EXTERNAL_STALE_MS) await this.requestRefresh(userId, provider, now).catch(() => {});
    if (!row || !row.data || Object.keys(row.data as object).length === 0) return null;
    return { data: row.data as T, fetchedAt: row.fetchedAt.toISOString(), error: row.error };
  }

  /** Cere worker-ului datele noi (un singur job pe membru și cont, pe oră). */
  async requestRefresh(userId: string, provider: GcsExternalProvider, now = new Date()): Promise<void> {
    await this.deps.jobs.enqueue(EXTERNAL_REFRESH_JOB, { userId, provider }, { jobId: `ext-${provider}-${userId}-${Math.floor(now.getTime() / 3600_000)}` });
  }

  /** Tabul Steam: datele din cache (`null` = încă nimic adus). */
  steam(userId: string, now = new Date()): Promise<GcsExternalEntry<GcsSteamView> | null> {
    return this.entry<GcsSteamView>(userId, "steam", now);
  }

  /** Tabul FACEIT, cu locul în comunitate după ELO (dintre membrii cu FACEIT adus). */
  async faceit(userId: string, now = new Date()): Promise<(GcsExternalEntry<GcsFaceitView> & { ranking: { position: number; total: number } | null }) | null> {
    const entry = await this.entry<GcsFaceitView>(userId, "faceit", now);
    if (!entry) return null;
    const elo = entry.data.elo;
    if (elo === null) return { ...entry, ranking: null };
    const [row] = await this.deps.db.$queryRaw<{ above: bigint; total: bigint }[]>(sql`
      SELECT COUNT(*) FILTER (WHERE (data->>'elo')::int > ${elo}) AS above, COUNT(*) AS total
      FROM external_profiles WHERE provider = 'faceit' AND jsonb_typeof(data->'elo') = 'number'`);
    return { ...entry, ranking: row ? { position: Number(row.above) + 1, total: Number(row.total) } : null };
  }

  private async getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const res = await this.http(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new GcsExternalError("unauthorized");
    if (res.status === 429) throw new GcsExternalError("rate_limited");
    if (!res.ok) throw new GcsExternalError(`http_${res.status}`);
    return res.json();
  }

  private async save(userId: string, provider: GcsExternalProvider, data: object | null, error: string | null, now: Date): Promise<void> {
    const { db } = this.deps;
    if (data === null) {
      // O eroare: datele vechi rămân, se notează doar eroarea (și momentul, ca să nu reîncercăm la fiecare vizită).
      await db.externalProfile.upsert({ where: { userId_provider: { userId, provider } }, create: { userId, provider, data: {}, fetchedAt: now, error }, update: { error, fetchedAt: now } });
      return;
    }
    await db.externalProfile.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, data: data as Prisma.InputJsonValue, fetchedAt: now, error: null },
      update: { data: data as Prisma.InputJsonValue, fetchedAt: now, error: null },
    });
  }

  /** Aduce datele unui cont (jobul worker-ului). Fără cont Steam legat, datele vechi se șterg. */
  async refresh(userId: string, provider: GcsExternalProvider, now = new Date()): Promise<void> {
    const steamId = await this.steamId(userId);
    if (!steamId) {
      await this.deps.db.externalProfile.deleteMany({ where: { userId, provider } });
      return;
    }
    try {
      if (provider === "steam") await this.refreshSteam(userId, steamId, now);
      else await this.refreshFaceit(userId, steamId, now);
    } catch (error) {
      await this.save(userId, provider, null, error instanceof GcsExternalError ? error.message : "unavailable", now);
    }
  }

  private async refreshSteam(userId: string, steamId: string, now: Date): Promise<void> {
    const key = await this.deps.settings.get<string>(STEAM_KEY_SETTING);
    if (!key) throw new GcsExternalError("no_key");
    const base = "https://api.steampowered.com";
    const q = (path: string, extra = "") => `${base}${path}?key=${encodeURIComponent(key)}&${extra}`;
    const [summary, level, bans, owned, recent] = await Promise.all([
      this.getJson(q("/ISteamUser/GetPlayerSummaries/v2/", `steamids=${steamId}`)),
      this.getJson(q("/IPlayerService/GetSteamLevel/v1/", `steamid=${steamId}`)).catch(() => null),
      this.getJson(q("/ISteamUser/GetPlayerBans/v1/", `steamids=${steamId}`)).catch(() => null),
      this.getJson(q("/IPlayerService/GetOwnedGames/v1/", `steamid=${steamId}&include_appinfo=1&include_played_free_games=1`)).catch(() => null),
      this.getJson(q("/IPlayerService/GetRecentlyPlayedGames/v1/", `steamid=${steamId}&count=10`)).catch(() => null),
    ]);
    await this.save(userId, "steam", mapSteam(steamId, { summary, level, bans, owned, recent }), null, now);
  }

  private async refreshFaceit(userId: string, steamId: string, now: Date): Promise<void> {
    const key = await this.deps.settings.get<string>(FACEIT_KEY_SETTING);
    if (!key) throw new GcsExternalError("no_key");
    const base = "https://open.faceit.com/data/v4";
    const auth = { authorization: `Bearer ${key}` };
    const player = await this.getJson(`${base}/players?game=cs2&game_player_id=${steamId}`, auth);
    const playerId = str(obj(player).player_id, 64);
    if (!playerId) {
      // Fără cont FACEIT pentru acest Steam: tabul nu apare.
      await this.deps.db.externalProfile.deleteMany({ where: { userId, provider: "faceit" } });
      return;
    }
    const [stats, history, previous] = await Promise.all([
      this.getJson(`${base}/players/${encodeURIComponent(playerId)}/stats/cs2`, auth).catch(() => null),
      this.getJson(`${base}/players/${encodeURIComponent(playerId)}/history?game=cs2&offset=0&limit=10`, auth).catch(() => null),
      this.deps.db.externalProfile.findUnique({ where: { userId_provider: { userId, provider: "faceit" } }, select: { data: true } }),
    ]);
    const before = (obj(previous?.data).history as { at: string; elo: number }[] | undefined) ?? [];
    const view = mapFaceit({ player, stats, history }, Array.isArray(before) ? before : [], now);
    if (view) await this.save(userId, "faceit", view, null, now);
  }

  /**
   * Reîmprospătarea periodică: cel mult 25 de membri cu Steam legat, activi în ultimele 30 de zile, cu date vechi sau
   * fără date (doar cu cheile completate).
   */
  async sweep(now = new Date()): Promise<number> {
    const { db } = this.deps;
    const keys = await this.configured();
    const providers = (["steam", "faceit"] as const).filter((p) => keys[p]);
    if (providers.length === 0) return 0;
    const stale = new Date(now.getTime() - EXTERNAL_STALE_MS);
    let queued = 0;
    for (const provider of providers) {
      const rows = await db.account.findMany({
        where: {
          providerId: "steam",
          user: { lastActiveAt: { gte: new Date(now.getTime() - 30 * 86_400_000) }, externalProfiles: { none: { provider, fetchedAt: { gte: stale } } } },
        },
        select: { userId: true },
        take: SWEEP_BATCH,
      });
      for (const r of rows) {
        await this.requestRefresh(r.userId, provider, now);
        queued++;
      }
    }
    return queued;
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({
      name: EXTERNAL_REFRESH_JOB,
      handler: async (data) => {
        const provider = data.provider === "faceit" ? "faceit" : "steam";
        if (typeof data.userId === "string") await this.refresh(data.userId, provider);
      },
    });
    jobs.register({ name: EXTERNAL_SWEEP_JOB, everyMs: 3600_000, handler: async () => void (await this.sweep()) });
  }
}
