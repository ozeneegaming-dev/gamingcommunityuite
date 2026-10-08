import { beforeEach, describe, expect, it } from "vitest";
import { mockPlayer } from "../../../../../servers-plugins/mock/gcs-mock-server.mjs";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { doc } from "../../../test/world";
import { steam64 } from "./steamid";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

const admin = (patch: Record<string, unknown>) => ({ subject: "USER" as const, serverId: null, presetId: null, flags: "bcd", immunity: null, allowNonSteam: false, note: "", expiresAt: null, ...patch });

describe("serviciile paginilor publice (specul 2026-10-08-servere-pagini)", () => {
  it("lista sancțiunilor: filtrul pe scop (doar globale / doar pe server)", async () => {
    const server = await w.bridgeServer();
    const g = await w.bridge.sanctions.create(w.root, { type: "BAN", scope: "GLOBAL", serverId: null, target: { auth: steam64(1), authKind: "steam" }, reason: "aimbot", minutes: 0 });
    const s = await w.bridge.sanctions.create(w.root, { type: "MUTE", scope: "SERVER", serverId: server.id, target: { auth: steam64(2), authKind: "steam" }, reason: "spam", minutes: 60 });
    expect((await w.bridge.sanctions.list(w.guest, { scope: "GLOBAL" })).items.map((x) => x.id)).toEqual([g.id]);
    expect((await w.bridge.sanctions.list(w.guest, { scope: "SERVER" })).items.map((x) => x.id)).toEqual([s.id]);
    // Un server: ale lui și cele globale.
    expect((await w.bridge.sanctions.list(w.guest, { serverId: server.id })).items.map((x) => x.id).sort()).toEqual([g.id, s.id].sort());
    expect((await w.bridge.sanctions.list(w.guest, { serverId: server.id, scope: "SERVER" })).items.map((x) => x.id)).toEqual([s.id]);
  });

  it("sancțiunile mele (contestația) și drepturile actorului pentru formularul de sancțiune", async () => {
    const server = await w.bridgeServer();
    const mine = await w.db.gamePlayer.create({ data: { kind: "NONSTEAM", value: "STEAM_0:1:777", trust: "MEDIUM", userId: w.member.userId } });
    const active = await w.bridge.sanctions.create(w.root, { type: "BAN", scope: "SERVER", serverId: server.id, target: { playerId: mine.id }, reason: "cheat", minutes: 0 });
    // După ID scris (aceeași identitate) și una expirată, care nu se mai contestă.
    const typed = await w.bridge.sanctions.create(w.root, { type: "GAG", scope: "GLOBAL", serverId: null, target: { auth: "STEAM_0:1:777", authKind: "nonsteam" }, reason: "injurii", minutes: 30 });
    await w.bridge.sanctions.create(w.root, { type: "MUTE", scope: "GLOBAL", serverId: null, target: { playerId: mine.id }, reason: "vechi", minutes: 1 });
    w.clock.now += 5 * 60_000;
    await w.bridge.sanctions.create(w.root, { type: "BAN", scope: "GLOBAL", serverId: null, target: { auth: steam64(5), authKind: "steam" }, reason: "altcineva", minutes: 0 });

    const list = await w.bridge.sanctions.mine(w.member);
    expect(list.map((s) => s.id).sort()).toEqual([active.id, typed.id].sort());
    expect(list.every((s) => s.appealOpen === false)).toBe(true);
    expect(await w.bridge.tickets.canAppeal(w.member, active.id)).toBe(true);
    await w.bridge.tickets.create(w.member, { kind: "APPEAL", sanctionId: active.id, title: "Contest", content: doc("Nu am trișat.") });
    expect((await w.bridge.sanctions.mine(w.member)).find((s) => s.id === active.id)?.appealOpen).toBe(true);
    expect(await w.bridge.tickets.canAppeal(w.member, active.id)).toBe(false);
    expect(await w.bridge.tickets.canAppeal(w.root, typed.id)).toBe(false);
    expect(await w.bridge.sanctions.mine(w.guest)).toEqual([]);

    // Drepturile: staff-ul global oriunde; un admin de server doar pe serverul lui, cu flag-urile lui.
    expect(await w.bridge.sanctions.abilities(w.root)).toMatchObject({ staff: true, grants: [] });
    const adm = await w.actorFor(await w.createUser("AdminMix", "member"));
    await w.bridge.admins.save(w.root, null, admin({ userId: adm.userId, serverId: server.id, flags: "ciu" }));
    await w.bridge.admins.save(w.root, null, admin({ userId: adm.userId, serverId: null, flags: "v" }));
    const ab = await w.bridge.sanctions.abilities(adm);
    expect(ab.staff).toBe(false);
    expect(ab.tempbanMax).toBe(10_080);
    expect(ab.grants).toEqual(expect.arrayContaining([{ serverId: server.id, flags: "ciu" }, { serverId: null, flags: "v" }]));
    expect(await w.bridge.sanctions.abilities(w.member)).toMatchObject({ staff: false, grants: [] });
  });

  it("tichetele: responsabilul în listă și în tichet, cei care pot trata (alegerea responsabilului)", async () => {
    const server = await w.bridgeServer();
    const adm = await w.actorFor(await w.createUser("AdminCS", "member"));
    await w.bridge.admins.save(w.root, null, admin({ userId: adm.userId, serverId: server.id, flags: "bcd" }));
    const { id } = await w.bridge.tickets.create(w.member, { kind: "CHEATER", serverId: server.id, targetName: "Suspect", title: "Wallhack", content: doc("Demo.") });
    const options = await w.bridge.tickets.handlerOptions(w.root, id);
    expect(options.map((o) => o.name)).toEqual(expect.arrayContaining(["Fondator", "AdminCS"]));
    expect(options.some((o) => o.id === w.member.userId)).toBe(false);
    expect(await w.bridge.tickets.handlerOptions(w.member, id)).toEqual([]);

    await w.bridge.tickets.assign(w.root, id, adm.userId);
    expect((await w.bridge.tickets.list(w.root, { scope: "handle" })).items[0]).toMatchObject({ id, assignee: { id: adm.userId, name: "AdminCS" } });
    expect((await w.bridge.tickets.get(w.member, id))!.assignee).toEqual({ id: adm.userId, name: "AdminCS" });
    expect((await w.bridge.tickets.list(w.member, { scope: "mine" })).items[0]!.assignee).toEqual({ id: adm.userId, name: "AdminCS" });
  });

  it("prezența pe pagini: doar serverele vizibile, adminii online (ușor) și numărul pe server", async () => {
    const shown = await w.bridgeServer();
    const hidden = await w.bridgeServer();
    const vipOnly = await w.db.group.findUniqueOrThrow({ where: { key: "vip_gold" } });
    await w.db.gameServer.update({ where: { id: hidden.id }, data: { groups: [vipOnly.id] } });
    await w.cache.invalidateTags(["servers"]);
    const a1 = mockPlayer("cs2", 1);
    const a2 = mockPlayer("cs2", 2);
    const { id: e1 } = await w.bridge.admins.save(w.root, null, { subject: "PLAYER", identity: a1.auth, serverId: shown.id, presetId: null, flags: "bcd", immunity: null, allowNonSteam: false, note: "", expiresAt: null });
    const { id: e2 } = await w.bridge.admins.save(w.root, null, { subject: "PLAYER", identity: a2.auth, serverId: hidden.id, presetId: null, flags: "bcd", immunity: null, allowNonSteam: false, note: "", expiresAt: null });
    const { id: e3 } = await w.bridge.admins.save(w.root, null, { subject: "PLAYER", identity: a2.auth, serverId: null, presetId: null, flags: "b", immunity: null, allowNonSteam: false, note: "", expiresAt: null });

    const m1 = w.mock(shown.token, "cs2", "s1");
    const m2 = w.mock(hidden.token, "cs2", "s2");
    await m1.send([m1.event("connect", { player: a1 })]);
    await m1.heartbeat({ players: [a1, mockPlayer("cs2", 9)] });
    await m2.send([m2.event("connect", { player: a2 })]);
    await m2.heartbeat({ players: [a2] });

    const presence = (await w.bridge.queries.adminPresence(w.member))!;
    expect(presence.map((a) => a.id).sort()).toEqual([e1, e3].sort());
    // Adminul „toate serverele” e online doar pe serverul ascuns: nu se arată online.
    expect(presence.find((a) => a.id === e3)!.online).toBeNull();
    expect(presence.find((a) => a.id === e1)!.online).toMatchObject({ serverId: shown.id });
    expect(await w.bridge.queries.adminPresence(w.member, { serverId: hidden.id })).toBeNull();

    const online = (await w.bridge.queries.onlineAdmins(w.member))!;
    expect(online).toEqual([expect.objectContaining({ adminId: e1, server: { id: shown.id, name: expect.any(String) }, since: expect.any(String) })]);
    expect(online.some((o) => o.adminId === e2)).toBe(false);
    const counts = await w.bridge.queries.adminsOnlineCounts(w.member, [shown.id, hidden.id]);
    expect(Object.fromEntries(counts)).toEqual({ [shown.id]: 1 });
    expect(await w.bridge.queries.onlineAdmins({ ...w.guest, isBanned: true })).toBeNull();
  });

  it("caseta din profilul membrului, căutarea jucătorilor și membrii cu identități legate (furnizorul)", async () => {
    const { id: serverId, token } = await w.bridgeServer({ isMix: true });
    await w.mock(token).scenarioFull();
    const first = await w.db.gamePlayer.findUniqueOrThrow({ where: { kind_value: { kind: "STEAM", value: steam64(900_001) } } });
    await w.db.gamePlayer.update({ where: { id: first.id }, data: { userId: w.member.userId } });

    const card = (await w.bridge.queries.userCard(w.guest, w.member.userId!))!;
    expect(card.player).toMatchObject({ id: first.id, kind: "STEAM", trust: "HIGH" });
    expect(card.kills).toBeGreaterThan(0);
    expect(card.playtime).toBeGreaterThan(0);
    expect(card.elo).toEqual(expect.any(Number));
    expect(card.matches).toBe(1);
    expect(card.identities).toBe(1);
    expect(await w.bridge.queries.userCard(w.guest, w.root.userId!)).toBeNull();

    const found = await w.bridge.queries.searchPlayers(w.guest, "Jucator1");
    expect(found.map((p) => p.name)).toEqual(expect.arrayContaining(["Jucator1", "Jucator10"]));
    expect(found[0]).not.toHaveProperty("ip");
    expect(await w.bridge.queries.searchPlayers({ ...w.guest, isBanned: true }, "Jucator1")).toEqual([]);

    expect([...(await w.servers.playerStats.linkedUsers([w.member.userId!, w.root.userId!]))]).toEqual([w.member.userId]);
    expect(serverId).toBeGreaterThan(0);
  });
});
