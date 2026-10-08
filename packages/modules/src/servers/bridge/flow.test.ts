import { beforeEach, describe, expect, it } from "vitest";
import { mockPlayer } from "../../../../../servers-plugins/mock/gcs-mock-server.mjs";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { steam64 } from "./steamid";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

const playerId = async (auth: string) => {
  const m = /^STEAM_[01]:([01]):(\d+)$/.exec(auth)!;
  const value = steam64(Number(m[2]) * 2 + Number(m[1]));
  return (await w.db.gamePlayer.findUniqueOrThrow({ where: { kind_value: { kind: "STEAM", value } } })).id;
};

describe("evenimentele (§6.4): idempotența și statisticile", () => {
  it("un eveniment se aplică exact o dată: retrimis → duplicate; în același lot → duplicate; invalid → rejected", async () => {
    const { token } = await w.bridgeServer();
    const mock = w.mock(token);
    const a = mockPlayer("cs2", 1);
    const b = mockPlayer("cs2", 2);
    const kill = mock.event("kill", { killer: a, victim: b, weapon: "weapon_ak47", headshot: true, map: "de_dust2" });
    expect(await mock.send([kill, kill])).toEqual([
      { id: kill.id, status: "ok" },
      { id: kill.id, status: "duplicate" },
    ]);
    expect(await mock.send([kill])).toEqual([{ id: kill.id, status: "duplicate" }]);
    const results = await mock.send([{ ...mock.event("kill"), id: "bad id!" }, mock.event("teleport"), mock.event("map", { map: "../etc" })]);
    expect(results.map((r) => [r.status, r.error])).toEqual([
      ["rejected", "invalid_id"],
      ["rejected", "unknown_type"],
      ["rejected", "invalid_map"],
    ]);
    const killer = await w.db.gamePlayerStat.findFirstOrThrow({ where: { playerId: await playerId(a.auth) } });
    expect(killer).toMatchObject({ kills: 1, headshots: 1, deaths: 0, score: 1 });
    expect(await w.db.gameWeaponStat.findFirst({ where: { playerId: await playerId(a.auth) } })).toMatchObject({ weapon: "ak47", kills: 1, headshots: 1 });
    expect(await w.db.gameMapStat.findFirst({ where: { playerId: await playerId(b.auth) } })).toMatchObject({ map: "de_dust2", deaths: 1 });
  });

  it("sinucideri, ucideri în echipă (scor = ucideri − decese − ucideri în echipă), asistențe, focuri, runde", async () => {
    const { id, token } = await w.bridgeServer();
    const mock = w.mock(token);
    const [a, b, c] = [mockPlayer("cs2", 1), mockPlayer("cs2", 2), mockPlayer("cs2", 3)];
    await mock.send([
      mock.event("kill", { victim: a, weapon: "world" }),
      mock.event("kill", { killer: b, victim: b, weapon: "hegrenade" }),
      mock.event("kill", { killer: a, victim: c, weapon: "ak47", teamkill: true }),
      mock.event("kill", { killer: a, victim: b, weapon: "ak47", assister: c }),
      mock.event("weapon_stats", { player: a, weapon: "ak47", shots: 40, hits: 10, damage: 500 }),
      mock.event("round_end", { winner: "CT", players: [{ player: a, team: "CT" }, { player: b, team: "T" }] }),
    ]);
    const stat = async (p: { auth: string }) => w.db.gamePlayerStat.findUniqueOrThrow({ where: { playerId_serverId: { playerId: await playerId(p.auth), serverId: id } } });
    expect(await stat(a)).toMatchObject({ kills: 1, deaths: 1, suicides: 1, teamkills: 1, score: -1, shots: 40, hits: 10, damage: 500, rounds: 1, roundsWon: 1 });
    expect(await stat(b)).toMatchObject({ kills: 0, deaths: 2, suicides: 1, rounds: 1, roundsWon: 0, score: -2 });
    expect(await stat(c)).toMatchObject({ deaths: 1, assists: 1 });
  });

  it("timpii evenimentelor se taie la [acum − 7 zile, acum + 60 s]", async () => {
    const { token } = await w.bridgeServer();
    const mock = w.mock(token);
    const p = mockPlayer("cs2", 1);
    await mock.send([{ ...mock.event("connect", { player: p }), at: 1 }]);
    const session = await w.db.gameSession.findFirstOrThrow();
    expect(session.connectedAt.getTime()).toBe(w.clock.now - 7 * 86_400_000);
  });
});

describe("serverul fals: scenariul complet (§18)", () => {
  it("heartbeat-uri, conectări, meciul mix 10–6 cu ELO, banul din joc, ieșirile; datele ajung în statistici și liste", async () => {
    const { id, token } = await w.bridgeServer({ isMix: true });
    const mock = w.mock(token);
    const out = await mock.scenarioFull();

    // Meciul: încheiat, câștigătorul din scor, rundele, ELO-ul aplicat o dată.
    const match = await w.db.gameMatch.findUniqueOrThrow({ where: { serverId_externalId: { serverId: id, externalId: out.matchId } }, include: { players: true, rounds: true } });
    expect(match).toMatchObject({ status: "ENDED", scoreA: 10, scoreB: 6, winner: "A", rated: true, map: "de_mirage", round: 16 });
    expect(match.rounds).toHaveLength(16);
    expect(match.players).toHaveLength(10);
    const winners = match.players.filter((p) => p.team === "A");
    expect(winners.every((p) => p.eloBefore === 1000 && p.eloAfter! > 1000)).toBe(true);
    expect(match.players.filter((p) => p.team === "B").every((p) => p.eloAfter! < 1000)).toBe(true);
    const ratings = await w.db.gameRating.findMany();
    expect(ratings).toHaveLength(10);
    expect(ratings.filter((r) => r.wins === 1)).toHaveLength(5);
    expect(out.ended).toMatchObject({ status: "ok" });

    // O stare veche sosită târziu (live după ended) e confirmată ca invalid_state, fără schimbări.
    const late = await mock.send([mock.event("match", { match: mock.matchState(out.matchId, "live", { teamA: out.players.slice(0, 5), teamB: out.players.slice(5) }) })]);
    expect(late[0]).toMatchObject({ status: "rejected", error: "invalid_state" });
    expect((await w.db.gameRating.findFirstOrThrow()).matches).toBe(1);

    // Live: camera serverului și camera meciului; starea live dispare la final.
    expect(w.live.some((m) => m.room === `servers:${id}` && m.event === "servers:match")).toBe(true);
    expect(w.live.some((m) => m.room === `match:${match.id}` && m.event === "match:state")).toBe(true);
    expect(await w.bridge.store.match(id)).toBeNull();

    // Statisticile clasice: ucideri, rundele, timpul de joc (ieșirile cu playtime raportat).
    const totals = await w.db.gamePlayerStat.aggregate({ where: { serverId: id }, _sum: { kills: true, deaths: true, rounds: true, playtime: true } });
    expect(totals._sum.kills).toBe(48);
    expect(totals._sum.deaths).toBe(48);
    expect(totals._sum.rounds).toBe(160);
    expect(totals._sum.playtime).toBeGreaterThan(0);
    expect(await w.db.gameSession.count({ where: { disconnectedAt: null } })).toBe(0);

    // Banul din joc: adminul nu e cunoscut pe toate serverele → scopul devine „acest server”.
    expect(out.ban).toMatchObject({ status: "ok", note: "scope_downgraded" });
    const ban = await w.db.gameSanction.findUniqueOrThrow({ where: { id: out.ban.sanctionId! } });
    expect(ban).toMatchObject({ type: "BAN", scope: "SERVER", serverId: id, source: "GAME", reason: "wallhack", targetKind: "STEAM" });
    expect(out.sanctions).toEqual([expect.objectContaining({ id: ban.id, type: "ban", active: true, scope: "server", reason: "wallhack" })]);
    expect(await w.db.gameAdminAction.count({ where: { serverId: id } })).toBe(2);

    // Catalogul hărților și ultimul heartbeat.
    expect(await w.db.gameMap.findMany({ select: { game: true, name: true } })).toEqual([{ game: "cs2", name: "de_mirage" }]);
    const server = await w.db.gameServer.findUniqueOrThrow({ where: { id } });
    expect(server.bridgePlugin).toBe("gcs-mock/cs2/1.0.0");
    expect(server.bridgeSeenAt).not.toBeNull();

    // Retrimiterea întregului scenariu (aceleași id-uri) nu dublează nimic.
    const again = w.mock(token, "cs2", mock.runId);
    await again.scenarioFull().catch(() => null);
    expect((await w.db.gamePlayerStat.aggregate({ where: { serverId: id }, _sum: { kills: true } }))._sum.kills).toBe(48);
    expect(await w.db.gameMatch.count()).toBe(1);
  });

  it("scenariul pe CS 1.6 (sha256-env, identități non-Steam în modul mixed)", async () => {
    const { id, token } = await w.bridgeServer({ game: "cs16" });
    const mock = w.mock(token, "cs16");
    const players = [{ ...mockPlayer("cs16", 1), steam: false }, mockPlayer("cs16", 2)];
    await mock.heartbeat({ players: players.map((p) => ({ ...p, time: 30 })) });
    const rows = await w.db.gamePlayer.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.kind, r.trust])).toEqual([
      ["NONSTEAM", "MEDIUM"],
      ["STEAM", "HIGH"],
    ]);
    expect(await w.db.gameSession.count({ where: { serverId: id, disconnectedAt: null } })).toBe(2);
    const roster = await w.bridge.store.roster(id);
    expect(roster?.players.map((p) => p.kind)).toEqual(["NONSTEAM", "STEAM"]);
  });
});
