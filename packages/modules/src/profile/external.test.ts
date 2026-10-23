import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { EXTERNAL_REFRESH_JOB, EXTERNAL_STALE_MS, GcsExternalProfiles, mapFaceit, mapSteam } from "./external";

const STEAM_ID = "76561197960287930";

/** Răspunsurile Steam Web API (forma reală, valori de test). */
const steamRaw = {
  summary: { response: { players: [{ steamid: STEAM_ID, personaname: "Rabscuttle", communityvisibilitystate: 3, personastate: 1, timecreated: 1063407589, lastlogoff: 1760000000, gameextrainfo: "Counter-Strike 2" }] } },
  level: { response: { player_level: 42 } },
  bans: { players: [{ SteamId: STEAM_ID, CommunityBanned: false, VACBanned: true, NumberOfVACBans: 1, DaysSinceLastBan: 900, NumberOfGameBans: 0, EconomyBan: "none" }] },
  owned: {
    response: {
      game_count: 3,
      games: [
        { appid: 10, name: "Counter-Strike", playtime_forever: 60_000, playtime_2weeks: 0 },
        { appid: 730, name: "Counter-Strike 2", playtime_forever: 90_000, playtime_2weeks: 600 },
        { appid: 570, name: "Dota 2", playtime_forever: 30 },
      ],
    },
  },
  recent: { response: { total_count: 1, games: [{ appid: 730, name: "Counter-Strike 2", playtime_2weeks: 600, playtime_forever: 90_000 }] } },
};

const faceitRaw = {
  player: { player_id: "f-123", nickname: "rabs", games: { cs2: { skill_level: 8, faceit_elo: 1820 } } },
  stats: { lifetime: { Matches: "412", "Win Rate %": "54", "Average K/D Ratio": "1.18", "Average Headshots %": "47", ADR: "84.3", "Longest Win Streak": "9", "Current Win Streak": "2", "Recent Results": ["1", "0", "1", "1", "0", "1"] } },
  history: {
    items: [
      { match_id: "m1", finished_at: 1760000000, results: { winner: "faction1", score: { faction1: 13, faction2: 9 } }, teams: { faction1: { players: [{ player_id: "f-123" }] }, faction2: { players: [{ player_id: "x" }] } } },
      { match_id: "m2", finished_at: 1759990000, results: { winner: "faction1", score: { faction1: 13, faction2: 11 } }, teams: { faction1: { players: [{ player_id: "x" }] }, faction2: { players: [{ player_id: "f-123" }] } } },
    ],
  },
};

describe("Steam: datele tabului", () => {
  test("cele 3 forme ale SteamID-ului, nivelul, vechimea, banurile, jocurile pe ore", () => {
    const v = mapSteam(STEAM_ID, steamRaw);
    expect(v).toMatchObject({
      steamId64: STEAM_ID,
      steamId: "STEAM_0:0:11101",
      steamId3: "[U:1:22202]",
      public: true,
      status: "online",
      inGame: "Counter-Strike 2",
      level: 42,
      createdAt: "2003-09-12T22:59:49.000Z",
      bans: { vac: 1, game: 0, community: false, economy: false, daysSinceLast: 900 },
    });
    expect(v.games).toMatchObject({ count: 3, totalHours: 2500.5, twoWeekHours: 10 });
    expect(v.games.top.map((g) => [g.name, g.hours])).toEqual([
      ["Counter-Strike 2", 1500],
      ["Counter-Strike", 1000],
      ["Dota 2", 0.5],
    ]);
    expect(v.games.recent).toEqual([{ appId: 730, name: "Counter-Strike 2", hours: 1500, twoWeekHours: 10 }]);
  });

  test("profil privat sau răspunsuri lipsă: implicite sigure, fără jocuri", () => {
    const v = mapSteam(STEAM_ID, { summary: { response: { players: [{ personaname: "<b>x</b>", communityvisibilitystate: 1 }] } } });
    expect(v).toMatchObject({ public: false, status: "offline", level: null, bans: { vac: 0, game: 0, daysSinceLast: null }, games: { count: null, totalHours: 0, top: [] } });
    expect(mapSteam(STEAM_ID, {}).name).toBe("");
  });
});

describe("FACEIT: datele tabului", () => {
  test("nivelul, ELO-ul, ultimele 5 rezultate, statisticile, meciurile (W/L din echipa membrului)", () => {
    const v = mapFaceit(faceitRaw, [], new Date("2026-10-16T10:00:00Z"))!;
    expect(v).toMatchObject({ playerId: "f-123", nickname: "rabs", level: 8, elo: 1820, url: "https://www.faceit.com/en/players/rabs" });
    expect(v.stats).toEqual({ matches: 412, winRate: 54, kd: 1.18, hs: 47, adr: 84.3, longestStreak: 9, currentStreak: 2, recent: ["L", "W", "W", "L", "W"] });
    expect(v.matches.map((m) => [m.id, m.result, m.score])).toEqual([
      ["m1", "W", "13–9"],
      ["m2", "L", "11–13"],
    ]);
    expect(v.history).toEqual([{ at: "2026-10-16T10:00:00.000Z", elo: 1820 }]);
  });

  test("istoricul ELO: un punct nou doar când ELO-ul s-a schimbat, cel mult 30", () => {
    const prev = Array.from({ length: 30 }, (_, i) => ({ at: new Date(2026, 0, i + 1).toISOString(), elo: 1500 + i }));
    const v = mapFaceit(faceitRaw, prev)!;
    expect(v.history).toHaveLength(30);
    expect(v.history.at(-1)?.elo).toBe(1820);
    expect(mapFaceit(faceitRaw, [{ at: "x", elo: 1820 }])!.history).toEqual([{ at: "x", elo: 1820 }]);
    expect(mapFaceit({ player: {} })).toBeNull();
  });
});

describe("cache-ul conturilor externe (worker)", () => {
  let w: GcsProfileWorld;
  const jobs = { enqueue: vi.fn(async () => {}) };

  beforeEach(async () => {
    w = await createProfileWorld();
    jobs.enqueue.mockClear();
  });

  afterAll(async () => {
    await w.db.$disconnect();
    w.kv.disconnect();
  });

  /** Un `fetch` fals: răspunsul după calea cererii; numără cererile. */
  function fakeFetch(routes: Record<string, unknown>, status = 200) {
    return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = new URL(String(url));
      const hit = Object.entries(routes).find(([path]) => u.pathname.endsWith(path));
      if (!hit) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(hit[1]), { status, headers: { "content-type": "application/json" } });
    });
  }

  const linkSteam = (userId: string) => w.db.account.create({ data: { userId, providerId: "steam", accountId: STEAM_ID } });

  test("Steam: doar cu cheia și contul legat; worker-ul salvează, pagina citește cache-ul și cere reîmprospătarea", async () => {
    const userId = w.member.userId!;
    const http = fakeFetch({
      "/GetPlayerSummaries/v2/": steamRaw.summary,
      "/GetSteamLevel/v1/": steamRaw.level,
      "/GetPlayerBans/v1/": steamRaw.bans,
      "/GetOwnedGames/v1/": steamRaw.owned,
      "/GetRecentlyPlayedGames/v1/": steamRaw.recent,
    });
    const ext = new GcsExternalProfiles({ db: w.db, settings: w.settings, jobs, fetch: http as unknown as typeof fetch });

    // Fără cont legat: nimic, nicio cerere.
    await ext.refresh(userId, "steam");
    expect(http).not.toHaveBeenCalled();
    await linkSteam(userId);
    // Fără cheie: eroarea se notează, fără cereri.
    await ext.refresh(userId, "steam");
    expect(http).not.toHaveBeenCalled();
    expect((await w.db.externalProfile.findUniqueOrThrow({ where: { userId_provider: { userId, provider: "steam" } } })).error).toBe("no_key");
    expect(await ext.steam(userId)).toBeNull();

    await w.settings.set("auth.steam_api_key", "STEAMKEY", w.root);
    await ext.refresh(userId, "steam");
    expect(http).toHaveBeenCalledTimes(5);
    expect(String(http.mock.calls[0]![0])).toContain("key=STEAMKEY");
    jobs.enqueue.mockClear();
    const entry = await ext.steam(userId);
    expect(entry?.data).toMatchObject({ level: 42, steamId3: "[U:1:22202]" });
    expect(entry?.error).toBeNull();
    // Datele proaspete nu cer alt job; cele vechi da (un singur job pe oră).
    expect(jobs.enqueue).not.toHaveBeenCalled();
    await ext.steam(userId, new Date(Date.now() + EXTERNAL_STALE_MS + 60_000));
    expect(jobs.enqueue).toHaveBeenCalledWith(EXTERNAL_REFRESH_JOB, { userId, provider: "steam" }, expect.objectContaining({ jobId: expect.stringContaining(`ext-steam-${userId}`) }));
  });

  test("Steam: o eroare (limită de cereri) păstrează datele vechi și notează eroarea", async () => {
    const userId = w.member.userId!;
    await linkSteam(userId);
    await w.settings.set("auth.steam_api_key", "STEAMKEY", w.root);
    await new GcsExternalProfiles({ db: w.db, settings: w.settings, jobs, fetch: fakeFetch({ "/GetPlayerSummaries/v2/": steamRaw.summary }) as unknown as typeof fetch }).refresh(userId, "steam");
    await new GcsExternalProfiles({ db: w.db, settings: w.settings, jobs, fetch: fakeFetch({ "/GetPlayerSummaries/v2/": {} }, 429) as unknown as typeof fetch }).refresh(userId, "steam");
    const entry = await new GcsExternalProfiles({ db: w.db, settings: w.settings, jobs }).steam(userId);
    expect(entry).toMatchObject({ error: "rate_limited", data: { name: "Rabscuttle" } });
  });

  test("FACEIT: cheia ca Bearer, istoricul ELO crește, locul în comunitate #n/N", async () => {
    const userId = w.member.userId!;
    await linkSteam(userId);
    await w.settings.set("profile.faceit_api_key", "FACEITKEY", w.root);
    const http = fakeFetch({ "/players": faceitRaw.player, "/stats/cs2": faceitRaw.stats, "/history": faceitRaw.history });
    const ext = new GcsExternalProfiles({ db: w.db, settings: w.settings, jobs, fetch: http as unknown as typeof fetch });
    await ext.refresh(userId, "faceit");
    expect((http.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: "Bearer FACEITKEY" });
    // Alți doi membri cu FACEIT: unul peste, unul sub.
    for (const [name, elo] of [["Peste", 2100], ["Sub", 900]] as const) {
      const other = await w.createUser(name, "member");
      await w.db.externalProfile.create({ data: { userId: other.id, provider: "faceit", data: { elo } } });
    }
    const entry = await ext.faceit(userId);
    expect(entry?.data).toMatchObject({ level: 8, elo: 1820 });
    expect(entry?.ranking).toEqual({ position: 2, total: 3 });

    // Fără cont FACEIT pentru acest Steam: datele dispar (tabul se ascunde).
    await new GcsExternalProfiles({ db: w.db, settings: w.settings, jobs, fetch: fakeFetch({}) as unknown as typeof fetch }).refresh(userId, "faceit");
    expect(await ext.faceit(userId)).toBeNull();
  });

  test("reîmprospătarea periodică: doar membrii activi cu Steam legat și date vechi, doar cu cheile completate", async () => {
    const ext = new GcsExternalProfiles({ db: w.db, settings: w.settings, jobs });
    await linkSteam(w.member.userId!);
    await w.db.user.update({ where: { id: w.member.userId! }, data: { lastActiveAt: new Date() } });
    expect(await ext.sweep()).toBe(0);
    await w.settings.set("auth.steam_api_key", "STEAMKEY", w.root);
    expect(await ext.sweep()).toBe(1);
    await w.db.externalProfile.create({ data: { userId: w.member.userId!, provider: "steam", data: { name: "x" } } });
    expect(await ext.sweep()).toBe(0);
  });
});
