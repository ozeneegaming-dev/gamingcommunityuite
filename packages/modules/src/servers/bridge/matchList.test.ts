import type { GameMatchStatus } from "@gcs/db";
import { beforeEach, describe, expect, it } from "vitest";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { steam64 } from "./steamid";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

/**
 * Lista meciurilor mix (specul 2026-10-08-servere-pagini §7): filtrele pe stare și hartă, numărătorile tab-urilor,
 * hărțile filtrului, formatul (jucătorii pe echipe) și ELO-ul mediu al fiecărui meci, cu vizibilitatea serverelor.
 */
describe("lista meciurilor mix", () => {
  async function setup() {
    const a = await w.bridgeServer({ isMix: true });
    const b = await w.bridgeServer({ isMix: true });
    const players = [];
    for (let i = 0; i < 10; i++) players.push(await w.db.gamePlayer.create({ data: { kind: "STEAM", value: steam64(800_000 + i), trust: "HIGH", name: `P${i}` } }));
    // Ratingurile curente: 1100, 1200, … pentru primii 6 jucători; ceilalți n-au rating încă.
    for (let i = 0; i < 6; i++) await w.db.gameRating.create({ data: { playerId: players[i]!.id, elo: 1100 + i * 100, peak: 1100 + i * 100, matches: 1 } });
    const t0 = new Date("2026-10-08T10:00:00Z").getTime();
    let n = 0;
    const match = async (serverId: number, status: GameMatchStatus, map: string, extra: { liveAt?: Date; endedAt?: Date } = {}) =>
      w.db.gameMatch.create({ data: { serverId, externalId: `x${++n}`, status, map, teamAName: "Alpha", teamBName: "Bravo", scoreA: 7, scoreB: 5, round: 12, startedAt: new Date(t0 + n * 60_000), ...extra } });
    // m1: încheiat, evaluat (ELO-ul de dinainte de meci), 5v5.
    const m1 = await match(a.id, "ENDED", "de_dust2", { liveAt: new Date(t0 + 120_000), endedAt: new Date(t0 + 40 * 60_000) });
    for (let i = 0; i < 10; i++) await w.db.gameMatchPlayer.create({ data: { matchId: m1.id, playerId: players[i]!.id, team: i < 5 ? "A" : "B", eloBefore: 1000 + i * 10, eloAfter: 1000 + i * 10 + (i < 5 ? 12 : -12) } });
    // m2: live, 2v2, fără ELO evaluat: media ratingurilor curente ale celor care au rating (jucătorul 9 n-are).
    const m2 = await match(a.id, "LIVE", "de_mirage", { liveAt: new Date(t0 + 5 * 60_000) });
    for (const [i, team] of [[0, "A"], [1, "A"], [2, "B"], [9, "B"]] as const) await w.db.gameMatchPlayer.create({ data: { matchId: m2.id, playerId: players[i]!.id, team } });
    // m3: încălzire pe serverul B, fără jucători; m4: anulat pe B.
    const m3 = await match(b.id, "WARMUP", "de_dust2");
    const m4 = await match(b.id, "ABORTED", "de_nuke", { endedAt: new Date(t0 + 9 * 60_000) });
    return { a, b, m1, m2, m3, m4 };
  }

  it("numărătorile pe stare (toate / live / terminate), cu filtrele pe server și hartă", async () => {
    const { a, b } = await setup();
    expect(await w.bridge.queries.matchCounts(w.guest)).toEqual({ all: 4, live: 2, ended: 2 });
    expect(await w.bridge.queries.matchCounts(w.guest, { serverId: a.id })).toEqual({ all: 2, live: 1, ended: 1 });
    expect(await w.bridge.queries.matchCounts(w.guest, { serverId: b.id, map: "de_dust2" })).toEqual({ all: 1, live: 1, ended: 0 });
    expect(await w.bridge.queries.matchCounts(w.guest, { map: "DE_DUST2" })).toEqual({ all: 2, live: 1, ended: 1 });
    // Un nume de hartă invalid nu filtrează nimic.
    expect(await w.bridge.queries.matchCounts(w.guest, { map: "../x" })).toEqual({ all: 4, live: 2, ended: 2 });
  });

  it("filtrele listei: starea (live = încălzire / live / pauză; terminate = încheiat / anulat) și harta, cele mai noi primele", async () => {
    const { a, m1, m2, m3, m4 } = await setup();
    expect((await w.bridge.queries.matches(w.guest, { status: "live" })).items.map((m) => m.id)).toEqual([m3.id, m2.id]);
    expect((await w.bridge.queries.matches(w.guest, { status: "ended" })).items.map((m) => m.id)).toEqual([m4.id, m1.id]);
    const dust = await w.bridge.queries.matches(w.guest, { map: "de_dust2" });
    expect(dust.items.map((m) => m.id)).toEqual([m3.id, m1.id]);
    expect(dust.total).toBe(2);
    const own = await w.bridge.queries.matches(w.guest, { serverId: a.id, status: "ended", map: "de_dust2" });
    expect(own.items.map((m) => m.id)).toEqual([m1.id]);
    // Începutul jocului (după încălzire) și runda, pentru durată și starea de pe card.
    expect(own.items[0]).toMatchObject({ liveAt: "2026-10-08T10:02:00.000Z", endedAt: "2026-10-08T10:40:00.000Z", round: 12 });
    // Fără `withStats`, nicio citire în plus.
    expect(own.items[0]!.stats).toBeUndefined();
  });

  it("formatul (jucătorii pe echipe) și ELO-ul mediu: cel de dinainte de meci, altfel ratingul curent; fără jucători = necunoscut", async () => {
    const { m1, m2, m3 } = await setup();
    const list = await w.bridge.queries.matches(w.guest, { withStats: true });
    const byId = new Map(list.items.map((m) => [m.id, m.stats]));
    // m1: media lui eloBefore = 1000 + 10 × (0…9) / 10 = 1045.
    expect(byId.get(m1.id)).toEqual({ players: { A: 5, B: 5 }, avgElo: 1045 });
    // m2: ratingurile curente ale jucătorilor 0, 1, 2 (1100, 1200, 1300); jucătorul 9 n-are rating.
    expect(byId.get(m2.id)).toEqual({ players: { A: 2, B: 2 }, avgElo: 1200 });
    expect(byId.get(m3.id)).toEqual({ players: { A: 0, B: 0 }, avgElo: null });
  });

  it("hărțile filtrului (alfabetic, cu numărul de meciuri) și vizibilitatea serverelor", async () => {
    const { a, b } = await setup();
    expect(await w.bridge.queries.matchMaps(w.guest)).toEqual([
      { map: "de_dust2", count: 2 },
      { map: "de_mirage", count: 1 },
      { map: "de_nuke", count: 1 },
    ]);
    expect(await w.bridge.queries.matchMaps(w.guest, { serverId: b.id })).toEqual([
      { map: "de_dust2", count: 1 },
      { map: "de_nuke", count: 1 },
    ]);
    // Serverul B ascuns grupului viewer-ului: nu apare nici în numărători, nici în hărți, nici în listă.
    const vipOnly = await w.db.group.findUniqueOrThrow({ where: { key: "vip_gold" } });
    await w.db.gameServer.update({ where: { id: b.id }, data: { groups: [vipOnly.id] } });
    await w.cache.invalidateTags(["servers"]);
    expect(await w.bridge.queries.matchCounts(w.guest)).toEqual({ all: 2, live: 1, ended: 1 });
    expect((await w.bridge.queries.matchMaps(w.guest)).map((m) => m.map)).toEqual(["de_dust2", "de_mirage"]);
    expect((await w.bridge.queries.matches(w.guest, { serverId: b.id, withStats: true })).items).toEqual([]);
    expect((await w.bridge.queries.matches(w.guest, { withStats: true })).items.every((m) => m.server.id === a.id)).toBe(true);
    // Fără dreptul de statistici (un vizitator banat): nimic.
    const banned = { ...w.guest, isBanned: true };
    expect(await w.bridge.queries.matchCounts(banned)).toEqual({ all: 0, live: 0, ended: 0 });
    expect(await w.bridge.queries.matchMaps(banned)).toEqual([]);
  });
});
