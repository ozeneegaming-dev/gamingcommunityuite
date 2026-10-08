import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createClanWorld, type GcsClanWorld } from "../../test/clanWorld";
import { GcsPlayerStatsHub, noPlayerStats, sumPlayerStats, type GcsPlayerStatsAggregate } from "../servers/playerStats";
import { clanScore } from "./ranking";

let w: GcsClanWorld;

beforeEach(async () => {
  w = await createClanWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const stats = (patch: Partial<GcsPlayerStatsAggregate> = {}): GcsPlayerStatsAggregate => ({
  kills: 100,
  deaths: 50,
  headshots: 40,
  accuracy: null,
  playtimeSeconds: 36_000,
  lastSeenAt: null,
  lastServerId: null,
  serverRank: null,
  mixPlayed: 4,
  mixWon: 3,
  elo: 1200,
  mvps: 2,
  ...patch,
});

describe("statisticile de joc (aplicația Servere) văzute din clanuri", () => {
  test("furnizorul implicit al aplicației Servere nu are statistici; totalurile unui grup", async () => {
    const hub = new GcsPlayerStatsHub();
    expect(hub.active).toBe(false);
    expect((await hub.forUsers(["a"], { scope: "all" })).size).toBe(0);
    hub.use({ forUsers: async (ids) => new Map(ids.map((id) => [id, stats()])) });
    expect(hub.active).toBe(true);
    expect((await hub.forUsers(["a", "a", "b"], { scope: "mix" })).size).toBe(2);
    hub.use(null);
    expect(hub.active).toBe(false);
    expect(await noPlayerStats.forUsers(["x"], { scope: 3 })).toEqual(new Map());
    const totals = sumPlayerStats([stats(), stats({ kills: 50, deaths: 50, headshots: 10, elo: null, playtimeSeconds: 0 })])!;
    expect(totals).toMatchObject({ players: 2, kills: 150, deaths: 100, kd: 1.5, elo: 1200, playtimeSeconds: 36_000, mixWon: 6 });
    expect(totals.headshotRate).toBeCloseTo(50 / 150);
    expect(sumPlayerStats([])).toBeNull();
  });

  test("cu aplicația Servere oprită, pagina clanului nu arată nimic despre servere (nici Steam-ul membrilor)", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "OPEN" });
    w.gameStats.data.set(leader.userId!, stats());
    const view = await w.clanQueries.details(leader, id);
    expect(view!.game).toBeNull();
    expect(view!.viewer.steamLinked).toBeNull();
    expect((await w.clanQueries.manage(leader, id))!.steam).toBeNull();
  });

  test("cu aplicația Servere activă: totalurile, membrii activi, „—” fără statistici, starea Steam pentru lider", async () => {
    w.gameStats.on = true;
    const { id, leader } = await w.activeClan({ joinMode: "OPEN" });
    const ana = await w.user("Ana");
    await w.clans.join(ana, id);
    const empty = await w.clanQueries.details(ana, id);
    expect(empty!.game).toEqual({ totals: null, members: [] });
    expect(empty!.viewer.steamLinked).toBe(false);

    w.gameStats.data.set(leader.userId!, stats({ playtimeSeconds: 7200 }));
    w.gameStats.data.set(ana.userId!, stats({ playtimeSeconds: 72_000, kills: 300, deaths: 100 }));
    await w.db.account.create({ data: { userId: ana.userId!, providerId: "steam", accountId: "76561198000000001" } });
    const view = await w.clanQueries.details(ana, id);
    expect(view!.game!.totals).toMatchObject({ players: 2, kills: 400, deaths: 150 });
    expect(view!.game!.members.map((m) => m.user.name)).toEqual(["Ana", expect.stringMatching(/^Lider/)]);
    expect(view!.viewer.steamLinked).toBe(true);
    // Starea Steam a membrilor: doar pentru lider (și staff), nu pentru un membru simplu.
    expect((await w.clanQueries.manage(leader, id))!.steam).toEqual({ [leader.userId!]: false, [ana.userId!]: true });
  });

  test("ponderile de joc ale clasamentului: ignorate fără statistici sau cu aplicația oprită, adăugate altfel", async () => {
    expect(clanScore({ posts: 0, reputation: 0, active: 0, members: 2, game: null }, { posts: 1, reputation: 1, activity: 10, members: 5, playtime: 10, kd: 10, mixWins: 10, elo: 10 })).toBe(10);
    expect(
      clanScore({ posts: 0, reputation: 0, active: 0, members: 2, game: { playtimeHours: 10, kd: 1.5, mixWins: 3, elo: 1200 } }, { posts: 1, reputation: 1, activity: 10, members: 5, playtime: 1, kd: 1, mixWins: 2, elo: 1 }),
    ).toBe(10 + 10 + 150 + 6 + 120);

    const a = await w.activeClan({ joinMode: "OPEN" });
    const b = await w.activeClan({ joinMode: "OPEN" });
    await w.clans.join(await w.user("Bob"), b.id);
    w.gameStats.data.set(a.leader.userId!, stats({ playtimeSeconds: 360_000 }));
    await w.clanAdmin.saveOptions(w.root, { "clans.weight_playtime": 1 });
    // Aplicația Servere oprită: B (2 membri) e primul.
    expect((await w.db.clan.findMany({ orderBy: { id: "asc" } })).map((c) => c.rank)).toEqual([2, 1]);
    w.gameStats.on = true;
    await w.clans.recompute(w.root);
    const rows = await w.db.clan.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((c) => c.rank)).toEqual([1, 2]);
    expect(rows[0]!.scoreParts).toMatchObject({ game: { playtimeHours: 100 } });
    expect((await w.clanQueries.details(a.leader, a.id))!.scoreParts!.game).toMatchObject({ playtimeHours: 100 });
  });
});
