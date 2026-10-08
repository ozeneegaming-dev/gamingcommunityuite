import { beforeEach, describe, expect, it } from "vitest";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { gamePartsByClan, type GcsClanGameStatsSource } from "../../clans/gameStats";
import { addPlayerStats } from "./stats";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

async function identity(kind: "STEAM" | "NONSTEAM" | "NAME", value: string, userId: string | null) {
  return w.db.gamePlayer.create({ data: { kind, value, trust: kind === "STEAM" ? "HIGH" : kind === "NONSTEAM" ? "MEDIUM" : "LOW", userId } });
}

describe("statisticile (§9): locurile pe server și furnizorul pentru clanuri", () => {
  it("locul pe server: doar cu timpul minim de joc, după scor, apoi după ucideri", async () => {
    const { id } = await w.bridgeServer();
    const at = new Date(w.clock.now);
    const a = await identity("STEAM", "76561197960265729", null);
    const b = await identity("STEAM", "76561197960265730", null);
    const c = await identity("STEAM", "76561197960265731", null);
    const d = await identity("STEAM", "76561197960265732", null);
    await addPlayerStats(w.db, a.id, id, { kills: 10, deaths: 5, playtime: 3600 }, at);
    await addPlayerStats(w.db, b.id, id, { kills: 12, deaths: 7, playtime: 3600 }, at);
    await addPlayerStats(w.db, c.id, id, { kills: 20, deaths: 2, teamkills: 1, playtime: 1700 }, at);
    await addPlayerStats(w.db, d.id, id, { kills: 1, deaths: 9, playtime: 1800 }, at);
    await w.bridge.ranks();
    const ranks = await w.db.gamePlayerStat.findMany({ where: { serverId: id }, orderBy: { playerId: "asc" }, select: { playerId: true, score: true, rank: true } });
    // a și b au același scor (5): b are mai multe ucideri; c are sub 30 de minute.
    expect(ranks).toEqual([
      { playerId: a.id, score: 5, rank: 2 },
      { playerId: b.id, score: 5, rank: 1 },
      { playerId: c.id, score: 17, rank: null },
      { playerId: d.id, score: -8, rank: 3 },
    ]);
    await w.settings.set("servers.rank_min_minutes", 0, w.root);
    await w.bridge.ranks();
    expect((await w.db.gamePlayerStat.findUniqueOrThrow({ where: { playerId_serverId: { playerId: c.id, serverId: id } } })).rank).toBe(1);
  });

  it("furnizorul: adună identitățile Steam și non-Steam ale membrului (nu NAME); scope server / all / mix; ELO-ul identității cu cele mai multe meciuri", async () => {
    const s1 = await w.bridgeServer();
    const s2 = await w.bridgeServer();
    const at = new Date(w.clock.now);
    const steam = await identity("STEAM", "76561197960265729", w.member.userId);
    const emu = await identity("NONSTEAM", "STEAM_0:1:9", w.member.userId);
    const named = await identity("NAME", "mara", w.member.userId);
    await addPlayerStats(w.db, steam.id, s1.id, { kills: 10, deaths: 5, headshots: 4, shots: 100, hits: 30, playtime: 3600 }, at);
    await addPlayerStats(w.db, emu.id, s2.id, { kills: 6, deaths: 3, headshots: 2, playtime: 1800 }, new Date(at.getTime() + 1000));
    await addPlayerStats(w.db, named.id, s1.id, { kills: 100, playtime: 100 }, at);
    await w.bridge.ranks();

    const all = (await w.servers.playerStats.forUsers([w.member.userId!], { scope: "all" })).get(w.member.userId!)!;
    expect(all).toMatchObject({ kills: 16, deaths: 8, headshots: 6, accuracy: 0.3, playtimeSeconds: 5400, lastServerId: s2.id, serverRank: null, mixPlayed: 0, elo: null });
    const one = (await w.servers.playerStats.forUsers([w.member.userId!], { scope: s1.id })).get(w.member.userId!)!;
    expect(one).toMatchObject({ kills: 10, serverRank: 1 });

    // Mix: două meciuri pe identitatea Steam, unul pe cea non-Steam.
    const match = async (n: number, playerId: number, team: string, winner: string) => {
      const m = await w.db.gameMatch.create({ data: { serverId: s1.id, externalId: `m${n}`, status: "ENDED", winner, scoreA: 13, scoreB: 5, rated: true } });
      await w.db.gameMatchPlayer.create({ data: { matchId: m.id, playerId, team, kills: 20, deaths: 10, headshots: 5, mvps: 3 } });
    };
    await match(1, steam.id, "A", "A");
    await match(2, steam.id, "A", "B");
    await match(3, emu.id, "B", "B");
    await w.db.gameRating.createMany({ data: [{ playerId: steam.id, elo: 1040, matches: 2, wins: 1, losses: 1, peak: 1050 }, { playerId: emu.id, elo: 1200, matches: 1, wins: 1, peak: 1200 }] });
    const mix = (await w.servers.playerStats.forUsers([w.member.userId!], { scope: "mix" })).get(w.member.userId!)!;
    expect(mix).toMatchObject({ mixPlayed: 3, mixWon: 2, kills: 60, mvps: 9, elo: 1040, playtimeSeconds: 0 });
    expect(await w.servers.playerStats.forUsers([w.root.userId!], { scope: "all" })).toEqual(new Map());

    // Clanurile citesc prin același punct (doar cu aplicația Servere activă).
    const clan = await w.db.clan.create({ data: { tag: "GCS", tagNormalized: "GCS", name: "Clanul", nameNormalized: "clanul", slug: "clanul", status: "ACTIVE", members: { create: [{ userId: w.member.userId!, role: "LEADER" }] } } });
    const source: GcsClanGameStatsSource = { enabled: () => w.apps.enabled("servers"), forUsers: (ids, opts) => w.servers.playerStats.forUsers(ids, opts) };
    expect((await gamePartsByClan(w.db, source, [clan.id])).get(clan.id)).toEqual({ playtimeHours: 2, kd: 2, mixWins: 2, elo: 1040 });
    await w.apps.setEnabled(w.root, "servers", false);
    expect((await gamePartsByClan(w.db, source, [clan.id])).size).toBe(0);
  });
});
