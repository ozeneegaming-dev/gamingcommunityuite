import { beforeEach, describe, expect, it } from "vitest";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { steam64 } from "./steamid";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

describe("citirile pentru paginile publice (§17, partea B)", () => {
  it("profilul jucătorului, clasamentele, meciurile și meciul live, pe datele scenariului complet", async () => {
    const { id: serverId, token } = await w.bridgeServer({ isMix: true });
    const out = await w.mock(token).scenarioFull();
    await w.settings.set("servers.rank_min_minutes", 0, w.root);
    await w.bridge.ranks();
    const first = await w.db.gamePlayer.findUniqueOrThrow({ where: { kind_value: { kind: "STEAM", value: steam64(900_001) } } });
    await w.db.gamePlayer.update({ where: { id: first.id }, data: { userId: w.member.userId } });

    const profile = (await w.bridge.queries.playerProfile(w.guest, first.id))!;
    expect(profile.player).toMatchObject({ id: first.id, kind: "STEAM", trust: "HIGH", verified: true });
    expect(profile.user).toEqual({ id: w.member.userId, name: "Mara" });
    expect(profile.classic).toHaveLength(1);
    expect(profile.summary.kills).toBeGreaterThan(0);
    expect(profile.summary.accuracy).toBeCloseTo(40 / 100, 5);
    expect(profile.mix).toMatchObject({ matches: 1, wins: 1, elo: expect.any(Number) });
    expect(profile.mix.history).toHaveLength(1);
    expect(profile.matches[0]).toMatchObject({ map: "de_mirage", status: "ended", winner: "A", player: { team: "A" } });
    expect(profile.weapons.map((x) => x.weapon)).toEqual(expect.arrayContaining(["ak47"]));
    expect(profile.maps[0]).toMatchObject({ map: "de_mirage" });
    expect(profile.sanctions).toEqual([]);
    expect((await w.bridge.queries.userProfile(w.guest, w.member.userId!))!.player.id).toBe(first.id);

    const board = (await w.bridge.queries.leaderboard(w.guest, serverId))!;
    expect(board.total).toBe(10);
    expect(board.items.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const mix = (await w.bridge.queries.mixLeaderboard(w.guest))!;
    expect(mix.items).toHaveLength(10);
    expect(mix.items[0]!.elo).toBeGreaterThanOrEqual(mix.items[9]!.elo);

    const list = await w.bridge.queries.matches(w.guest, { serverId });
    expect(list.total).toBe(1);
    const match = (await w.bridge.queries.match(w.guest, list.items[0]!.id))!;
    expect(match).toMatchObject({ teams: { A: { score: 10 }, B: { score: 6 } }, rated: true, round: 16 });
    expect(match.rounds).toHaveLength(16);
    expect(await w.bridge.queries.liveMatch(w.guest, serverId)).toBeNull();
    expect(await w.bridge.queries.canJoinMatch(w.guest, String(match.id))).toBe(true);
    expect(out.matchId).toMatch(/^m-/);

    // Un server ascuns grupului viewer-ului: clasamentul și meciul nu se văd.
    const vipOnly = await w.db.group.findUniqueOrThrow({ where: { key: "vip_gold" } });
    await w.db.gameServer.update({ where: { id: serverId }, data: { groups: [vipOnly.id] } });
    await w.cache.invalidateTags(["servers"]);
    expect(await w.bridge.queries.leaderboard(w.guest, serverId)).toBeNull();
    expect(await w.bridge.queries.match(w.guest, match.id)).toBeNull();
    expect((await w.bridge.queries.playerProfile(w.guest, first.id))!.classic).toEqual([]);
  });
});
