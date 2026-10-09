import { beforeEach, describe, expect, it } from "vitest";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { steam64 } from "./steamid";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

/**
 * Ștergerea unui server cu „șterge și jucătorii lui” (ex. un server de test): pleacă doar jucătorii văzuți numai pe
 * acel server, fără cont pe site, fără sancțiuni și fără intrări de admin; ceilalți rămân.
 */
describe("ștergerea unui server cu jucătorii lui", () => {
  async function setup() {
    const a = await w.bridgeServer({ isMix: true });
    const b = await w.bridgeServer();
    const mk = (i: number, extra: { userId?: string } = {}) =>
      w.db.gamePlayer.create({ data: { kind: "STEAM", value: steam64(900_000 + i), trust: "HIGH", name: `T${i}`, ...extra } });
    const only = await mk(1); // doar pe A
    const both = await mk(2); // pe A și pe B
    const linked = await mk(3, { userId: w.member.userId! }); // doar pe A, dar legat de un cont
    const sanctioned = await mk(4); // doar pe A, cu o sancțiune
    const matchOnly = await mk(5); // doar într-un meci pe A
    for (const p of [only, both, linked, sanctioned]) await w.db.gamePlayerStat.create({ data: { playerId: p.id, serverId: a.id } });
    await w.db.gameSession.create({ data: { serverId: b.id, playerId: both.id, connectedAt: new Date() } });
    await w.db.gameSanction.create({ data: { type: "BAN", scope: "SERVER", serverId: a.id, playerId: sanctioned.id, reason: "test", source: "SITE" } });
    const m = await w.db.gameMatch.create({ data: { serverId: a.id, externalId: "m1", status: "ENDED", map: "de_dust2", teamAName: "A", teamBName: "B" } });
    await w.db.gameMatchPlayer.create({ data: { matchId: m.id, playerId: matchOnly.id, team: "A" } });
    for (const p of [only, matchOnly]) await w.db.gameRating.create({ data: { playerId: p.id, elo: 1100, peak: 1100, matches: 1 } });
    return { a, b, only, both, linked, sanctioned, matchOnly };
  }

  it("fără opțiune: jucătorii rămân (doar serverul și datele lui pe server pleacă)", async () => {
    const { a } = await setup();
    await w.servers.remove(w.root, a.id);
    expect(await w.db.gamePlayer.count({ where: { value: { in: [1, 2, 3, 4, 5].map((i) => steam64(900_000 + i)) } } })).toBe(5);
  });

  it("cu opțiunea: pleacă doar cei văzuți numai aici, fără cont, sancțiuni sau admin; ratingurile lor dispar", async () => {
    const { a, only, both, linked, sanctioned, matchOnly } = await setup();
    await w.servers.remove(w.root, a.id, { purgePlayers: true });
    const left = (await w.db.gamePlayer.findMany({ where: { id: { in: [only.id, both.id, linked.id, sanctioned.id, matchOnly.id] } } })).map((p) => p.id);
    expect(left.sort()).toEqual([both.id, linked.id, sanctioned.id].sort());
    expect(await w.db.gameRating.count({ where: { playerId: { in: [only.id, matchOnly.id] } } })).toBe(0);
    const log = await w.db.auditLog.findFirst({ where: { action: "servers.delete" }, orderBy: { createdAt: "desc" } });
    expect(log?.after).toMatchObject({ purgedPlayers: 2 });
  });
});
