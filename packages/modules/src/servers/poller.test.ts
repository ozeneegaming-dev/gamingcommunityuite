import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { startFakeGameServer } from "../../test/gameFixtures";
import { createServerWorld, onlineStatus, type GcsServerWorld } from "../../test/serverWorld";
import { parseAllowNets } from "./net";
import { backoffMultiplier, GcsServerPoller, nextPollDelay, POLL_INTERVAL_SETTING, serverRoom, STATUS_EVENT } from "./poller";
import { serverStatTiles } from "./stats";

let w: GcsServerWorld;

beforeEach(async () => {
  w = await createServerWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("backoff-ul", () => {
  test("intervalul se dublează după al doilea eșec, până la 16×, plafonat la 10 minute", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(backoffMultiplier)).toEqual([1, 1, 2, 4, 8, 16, 16, 16]);
    expect([0, 1, 2, 3, 4, 5].map((f) => nextPollDelay(30, f))).toEqual([30, 30, 60, 120, 240, 480]);
    expect(nextPollDelay(60, 5)).toBe(600);
    expect(nextPollDelay(300, 0)).toBe(300);
    expect(nextPollDelay(300, 3)).toBe(600);
  });
});

describe("runda de interogare", () => {
  test("serverele scadente se interoghează; statusul, istoricul și publicarea live; o rundă imediată nu le mai ia", async () => {
    const a = await w.addServer({ host: "a.gcs-servere.ro", port: 27015 });
    const b = await w.addServer({ host: "b.gcs-servere.ro", port: 27015, enabled: false });
    w.answers.set("a.gcs-servere.ro:27015", onlineStatus({ players: 12, map: "de_inferno" }));

    expect(await w.poller.tick()).toBe(1);
    expect(w.calls.map((c) => c.host)).toEqual(["a.gcs-servere.ro"]);
    expect(await w.store.get(a.id)).toMatchObject({ online: true, players: 12, map: "de_inferno" });
    expect(await w.store.get(b.id)).toBeNull();
    const rows = await w.db.serverSnapshot.findMany({ where: { serverId: a.id } });
    expect(rows).toMatchObject([{ online: true, players: 12, peak: 12, maxPlayers: 32, map: "de_inferno", ping: 20, samples: 1, onlineSamples: 1, hourly: false }]);
    expect(w.published).toEqual([{ room: serverRoom(a.id), event: STATUS_EVENT, data: expect.objectContaining({ id: a.id, online: true, players: 12 }) }]);
    expect(w.published[0]!.data).not.toHaveProperty("playerList");

    // Nimic scadent: nicio interogare. După interval: din nou, dar fără publicare (nu s-a schimbat nimic vizibil).
    expect(await w.poller.tick()).toBe(0);
    w.clock.now += 31_000;
    expect(await w.poller.tick()).toBe(1);
    expect(w.published).toHaveLength(1);
    w.answers.set("a.gcs-servere.ro:27015", onlineStatus({ players: 13, map: "de_inferno" }));
    w.clock.now += 31_000;
    await w.poller.tick();
    expect(w.published).toHaveLength(2);
  });

  test("un server căzut e interogat tot mai rar; rândurile lui cântăresc cât timpul acoperit; revenirea resetează", async () => {
    const s = await w.addServer({ host: "jos.gcs-servere.ro", port: 27015 });
    const at: number[] = [];
    for (let i = 0; i < 100 && at.length < 5; i++) {
      if ((await w.poller.tick()) > 0) at.push(w.clock.now);
      w.clock.now += 10_000;
    }
    const gaps = at.slice(1).map((t, i) => Math.round((t - at[i]!) / 1000));
    // 30 s după primul eșec, apoi 60, 120, 240 (pașii de 10 s ai rundei).
    expect(gaps).toEqual([30, 60, 120, 240]);
    const rows = await w.db.serverSnapshot.findMany({ where: { serverId: s.id }, orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.online, r.samples, r.onlineSamples])).toEqual([
      [false, 1, 0],
      [false, 2, 0],
      [false, 4, 0],
      [false, 8, 0],
      [false, 16, 0],
    ]);
    expect((await w.store.schedule()).failures.get(s.id)).toBe(5);

    w.answers.set("jos.gcs-servere.ro:27015", onlineStatus());
    w.clock.now += 600_000;
    await w.poller.tick();
    expect((await w.store.schedule()).failures.get(s.id)).toBe(0);
    expect(w.published.at(-1)).toMatchObject({ data: { online: true } });
  });

  test("intervalul vine din setare; aplicația dezactivată sau o rundă în curs nu interoghează nimic", async () => {
    await w.addServer({ host: "a.gcs-servere.ro", port: 27015 });
    await w.settings.set(POLL_INTERVAL_SETTING, 120, w.root);
    w.answers.set("a.gcs-servere.ro:27015", onlineStatus());
    await w.poller.tick();
    w.clock.now += 61_000;
    expect(await w.poller.tick()).toBe(0);
    w.clock.now += 60_000;

    expect(await w.store.lock("altcineva", 5_000)).toBe(true);
    expect(await w.poller.tick()).toBe(0);
    await w.store.unlock("altcineva");

    await w.apps.setEnabled(w.root, "servers", false);
    expect(await w.poller.tick()).toBe(0);
    await w.apps.setEnabled(w.root, "servers", true);
    expect(await w.poller.tick()).toBe(1);
  });

  test("cu interogarea reală, un server fals local (excepția operatorului 127.0.0.1)", async () => {
    const fake = await startFakeGameServer({ info: { name: "§cLocal CS2", players: 5 } });
    try {
      const poller = new GcsServerPoller({ db: w.db, store: w.store, realtime: { publish: async () => {} } as never, cache: w.cache, settings: w.settings, apps: w.apps, allow: () => parseAllowNets("127.0.0.1/32") });
      const { id } = await w.addServer({ host: "127.0.0.1", port: fake.udpPort });
      await poller.tick();
      expect(await w.store.get(id)).toMatchObject({ online: true, name: "Local CS2", players: 5, map: "de_mirage" });
    } finally {
      await fake.close();
    }
  });
});

describe("plăcile de statistici", () => {
  test("serverele publice online și jucătorii lor, din ultimul rând recent; fără servere publice, nimic", async () => {
    expect(await serverStatTiles({ db: w.db })).toEqual([]);
    const a = await w.addServer();
    const b = await w.addServer();
    const hidden = await w.addServer({ groups: [w.groups.root_admin!] });
    const old = new Date(Date.now() - 20 * 60_000);
    await w.db.serverSnapshot.createMany({
      data: [
        { serverId: a.id, at: old, online: true, players: 30 },
        { serverId: a.id, online: true, players: 12 },
        { serverId: b.id, online: false, players: 0 },
        { serverId: hidden.id, online: true, players: 99 },
      ],
    });
    const tiles = await serverStatTiles({ db: w.db });
    expect(tiles.map((t) => [t.key, t.value])).toEqual([
      ["servers.online", 1],
      ["servers.players", 12],
    ]);
  });
});
