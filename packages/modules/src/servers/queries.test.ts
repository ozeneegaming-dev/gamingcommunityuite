import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createServerWorld, onlineStatus, type GcsServerWorld } from "../../test/serverWorld";
import { SHOW_PLAYERS_SETTING } from "./poller";
import { rollupSnapshots } from "./rollup";

let w: GcsServerWorld;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  w = await createServerWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

/** Un rând brut de istoric la momentul dat. */
const snap = (serverId: number, at: number, p: { online?: boolean; players?: number; max?: number; map?: string | null; ping?: number | null; samples?: number } = {}) => {
  const online = p.online ?? true;
  const samples = p.samples ?? 1;
  return { serverId, at: new Date(at), online, players: p.players ?? 0, peak: p.players ?? 0, maxPlayers: p.max ?? 32, map: p.map ?? null, ping: p.ping ?? null, samples, onlineSamples: online ? samples : 0 };
};

describe("lista vizibilă", () => {
  test("vizibilitatea pe grup, serverele dezactivate, `servers.view` și aplicația dezactivată", async () => {
    const pub = await w.addServer({ name: "Public" });
    const staff = await w.addServer({ name: "Staff", groups: [w.groups.root_admin!] });
    await w.addServer({ name: "Oprit", enabled: false });
    expect((await w.serverQueries.list(w.guest)).map((s) => s.name)).toEqual(["Public"]);
    expect((await w.serverQueries.list(w.root)).map((s) => s.name)).toEqual(["Public", "Staff"]);
    expect(await w.serverQueries.details(w.guest, staff.id)).toBeNull();
    expect(await w.serverQueries.canJoin(w.guest, String(pub.id))).toBe(true);
    expect(await w.serverQueries.canJoin(w.guest, String(staff.id))).toBe(false);
    expect(await w.serverQueries.canJoin(w.guest, "1; DROP")).toBe(false);

    await w.db.groupSetting.upsert({
      where: { groupId_key: { groupId: w.groups.guest!, key: "servers.view" } },
      create: { groupId: w.groups.guest!, key: "servers.view", value: false },
      update: { value: false },
    });
    await w.permissions.bumpVersion();
    expect(await w.serverQueries.list(w.guest)).toEqual([]);

    await w.apps.setEnabled(w.root, "servers", false);
    expect(await w.serverQueries.list(w.root)).toEqual([]);
    expect(await w.serverQueries.details(w.root, pub.id)).toBeNull();
  });

  test("vederea: jocul, adresa de copiat, linkul Connect (Steam) doar la Counter-Strike, statusul proaspăt", async () => {
    const cs = await w.addServer({ game: "cs16", host: "cs.gcs-servere.ro", port: 27015 });
    const mc = await w.addServer({ game: "minecraft", host: "mc.gcs-servere.ro", port: 25565 });
    await w.store.save(cs.id, onlineStatus({ players: 19 }), { nextAt: 0, failures: 0 });
    await w.store.save(mc.id, onlineStatus({ updatedAt: new Date(Date.now() - 20 * 60_000).toISOString() }), { nextAt: 0, failures: 0 });
    const [a, b] = await w.serverQueries.list(w.guest);
    expect(a).toMatchObject({ game: { key: "cs16", family: "cs16", hasMap: true }, address: "cs.gcs-servere.ro:27015", connectHref: "steam://connect/cs.gcs-servere.ro:27015", status: { id: cs.id, players: 19 } });
    // Minecraft pe portul implicit: adresa fără port, fără Connect; statusul prea vechi nu se arată ca live.
    expect(b).toMatchObject({ game: { key: "minecraft", hasMap: false }, address: "mc.gcs-servere.ro", connectHref: null, status: null });
    expect((await w.serverQueries.list(w.guest, { family: "minecraft" })).map((s) => s.id)).toEqual([mc.id]);
  });
});

describe("pagina serverului", () => {
  test("adminii, forumul (doar dacă e vizibil), lista jucătorilor după setare și drept", async () => {
    const tree = await w.createTree();
    const { id } = await w.addServer({ forumId: tree.forum.id, adminIds: [w.member.userId!] });
    await w.store.save(id, onlineStatus({ playerList: [{ name: "Ana", score: 3, time: 60 }] }), { nextAt: 0, failures: 0 });
    const page = await w.serverQueries.details(w.guest, id);
    expect(page).toMatchObject({ admins: [{ id: w.member.userId, name: "Mara" }], forum: { id: tree.forum.id }, players: [{ name: "Ana" }], playersHidden: false });

    await w.settings.set(SHOW_PLAYERS_SETTING, false, w.root);
    expect(await w.serverQueries.details(w.guest, id)).toMatchObject({ players: null, playersHidden: true });
    expect((await w.serverQueries.live(w.guest, [id])).players).toBeNull();
    await w.settings.set(SHOW_PLAYERS_SETTING, true, w.root);
    expect((await w.serverQueries.live(w.guest, [id])).players).toEqual([{ name: "Ana", score: 3, time: 60 }]);
    expect((await w.serverQueries.live(w.guest, [id, 999])).players).toBeNull();

    // Forumul ascuns vizitatorilor: linkul dispare doar pentru ei.
    await w.groupService.setContainerInherit("forum", String(tree.forum.id), { inherits: false, parentId: null }, w.root);
    await w.groupService.setContainerPermissions("forum", String(tree.forum.id), { [w.groups.root_admin!]: ["forums.view", "forums.read"] }, w.root);
    expect((await w.serverQueries.details(w.guest, id))!.forum).toBeNull();
    expect((await w.serverQueries.details(w.root, id))!.forum).toMatchObject({ id: tree.forum.id });
  });

  test("uptime-ul ponderat, hărțile din ultimele 24 h, vârful și media", async () => {
    const { id } = await w.addServer();
    const now = Date.now();
    await w.db.serverSnapshot.createMany({
      data: [
        snap(id, now - 5 * HOUR, { players: 10, map: "de_dust2" }),
        snap(id, now - 4 * HOUR, { players: 20, map: "de_dust2" }),
        snap(id, now - 3 * HOUR, { players: 30, map: "de_inferno" }),
        // Căzut, interogat de 4 ori mai rar: cântărește 4.
        snap(id, now - 2 * HOUR, { online: false, samples: 4 }),
        snap(id, now - HOUR, { players: 8, map: "de_dust2" }),
        snap(id, now - 3 * DAY, { players: 5, map: "cs_office" }),
      ],
    });
    const page = (await w.serverQueries.details(w.guest, id))!;
    expect(page.uptime.d1).toBeCloseTo(4 / 8);
    expect(page.uptime.d7).toBeCloseTo(5 / 9);
    expect(page.maps.map((m) => m.map)).toEqual(["de_dust2", "de_inferno", "de_dust2"]);
    expect(page.peak24).toMatchObject({ players: 30 });
    expect(page.avg24).toBeCloseTo((10 + 20 + 30 + 8) / 4);
  });

  test("istoricul: 24 de coloane orare, 168 pe 7 zile, 30 zilnice; golurile sunt `null`, media e ponderată", async () => {
    const { id } = await w.addServer();
    const hourStart = Math.floor(Date.now() / HOUR) * HOUR;
    await w.db.serverSnapshot.createMany({
      data: [
        snap(id, hourStart + 60_000, { players: 10, max: 32 }),
        snap(id, hourStart + 120_000, { players: 20, max: 32 }),
        snap(id, hourStart - 2 * HOUR + 1000, { online: false, samples: 2 }),
        snap(id, hourStart - 2 * HOUR + 2000, { players: 9, max: 40 }),
        snap(id, hourStart - 10 * DAY, { players: 7 }),
      ],
    });
    const day = await w.serverQueries.history(id, "24h");
    expect(day.buckets).toHaveLength(24);
    expect(day.buckets[23]).toMatchObject({ at: new Date(hourStart).toISOString(), avg: 15, peak: 20, uptime: 1 });
    expect(day.buckets[22]).toMatchObject({ avg: null, peak: null, uptime: null });
    expect(day.buckets[21]).toMatchObject({ avg: 3, peak: 9, uptime: 1 / 3 });
    expect(day.maxPlayers).toBe(40);
    expect((await w.serverQueries.history(id, "7d")).buckets).toHaveLength(168);
    const month = await w.serverQueries.history(id, "30d");
    expect(month.buckets).toHaveLength(30);
    expect(month.buckets.filter((b) => b.avg !== null).length).toBeGreaterThanOrEqual(2);
  });
});

describe("agregarea și curățarea istoricului", () => {
  test("rândurile brute mai vechi de 7 zile devin rânduri orare; cele recente rămân; peste retenție se șterge", async () => {
    const { id } = await w.addServer();
    const now = Date.now();
    const oldHour = Math.floor((now - 10 * DAY) / HOUR) * HOUR;
    await w.db.serverSnapshot.createMany({
      data: [
        snap(id, oldHour + 1000, { players: 10, map: "de_dust2", ping: 20 }),
        snap(id, oldHour + 2000, { online: false, samples: 2 }),
        snap(id, oldHour + 3000, { players: 31, map: "de_nuke", ping: 40, max: 40 }),
        snap(id, oldHour + HOUR + 1000, { players: 4, map: "de_nuke" }),
        snap(id, now - DAY, { players: 15 }),
        snap(id, now - 200 * DAY, { players: 1 }),
      ],
    });
    const result = await rollupSnapshots(w.db, { retentionDays: 90 });
    expect(result).toEqual({ aggregated: 2, pruned: 1 });
    const rows = await w.db.serverSnapshot.findMany({ where: { serverId: id }, orderBy: { at: "asc" } });
    expect(rows.map((r) => ({ at: r.at.getTime(), hourly: r.hourly, online: r.online, players: r.players, peak: r.peak, maxPlayers: r.maxPlayers, map: r.map, ping: r.ping, samples: r.samples, onlineSamples: r.onlineSamples }))).toEqual([
      // (10×1 + 0×2 + 31×1) / 4 = 10.25 → 10; ping-ul doar din interogările reușite.
      { at: oldHour, hourly: true, online: true, players: 10, peak: 31, maxPlayers: 40, map: "de_nuke", ping: 30, samples: 4, onlineSamples: 2 },
      { at: oldHour + HOUR, hourly: true, online: true, players: 4, peak: 4, maxPlayers: 32, map: "de_nuke", ping: null, samples: 1, onlineSamples: 1 },
      { at: now - DAY, hourly: false, online: true, players: 15, peak: 15, maxPlayers: 32, map: null, ping: null, samples: 1, onlineSamples: 1 },
    ]);
    // A doua rulare nu mai are ce agrega.
    expect(await rollupSnapshots(w.db, { retentionDays: 90 })).toEqual({ aggregated: 0, pruned: 0 });
  });
});
