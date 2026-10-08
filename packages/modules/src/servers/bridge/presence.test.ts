import { beforeEach, describe, expect, it } from "vitest";
import { mockPlayer } from "../../../../../servers-plugins/mock/gcs-mock-server.mjs";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("prezența adminilor (§11)", () => {
  it("online acum, ferestrele 24 h / 7 zile / 30 de zile, acțiunile și inactivitatea", async () => {
    const server = await w.bridgeServer();
    const mock = w.mock(server.token);
    const admin = mockPlayer("cs2", 1);
    const idle = mockPlayer("cs2", 2);
    const { id: adminId } = await w.bridge.admins.save(w.root, null, { subject: "PLAYER", identity: admin.auth, serverId: server.id, presetId: null, flags: "bcd", immunity: null, allowNonSteam: false, note: "", expiresAt: null });
    const { id: idleId } = await w.bridge.admins.save(w.root, null, { subject: "PLAYER", identity: idle.auth, serverId: null, presetId: null, flags: "b", immunity: null, allowNonSteam: false, note: "", expiresAt: null });

    // Acum 10 zile: o sesiune de 2 ore; acum: în joc de o oră, cu o acțiune. Timpii evenimentelor sunt în secunde.
    const start = w.clock.now - (w.clock.now % 1000);
    w.clock.now = start - 10 * DAY;
    await mock.send([mock.event("connect", { player: admin })]);
    w.clock.now = start - 10 * DAY + 2 * HOUR;
    await mock.send([mock.event("disconnect", { player: admin })]);
    w.clock.now = start - HOUR;
    await mock.send([mock.event("connect", { player: admin })]);
    w.clock.now = start;
    await mock.heartbeat({ players: [{ ...admin, time: 3600 }] });
    await mock.send([mock.event("admin_action", { admin, action: "kick", target: idle, reason: "afk" })]);

    const list = await w.bridge.presence.list(w.member);
    const me = list.find((a) => a.id === adminId)!;
    expect(me.online).toMatchObject({ serverId: server.id, since: new Date(start - HOUR).toISOString() });
    expect(me).toMatchObject({ seen24h: true, seen7d: true, inactive: false, actions: { d7: 1, d30: 1 } });
    expect(me.playtime).toEqual({ d1: 3600, d7: 3600, d30: 3600 + 7200 });
    const other = list.find((a) => a.id === idleId)!;
    expect(other).toMatchObject({ online: null, seen24h: false, inactive: true, lastSeenAt: null });

    // Serverul tace: după 2 × intervalul nu mai e online; jobul închide sesiunea la ultimul heartbeat.
    w.clock.now = start + 5 * 60_000;
    expect((await w.bridge.presence.list(w.member)).find((a) => a.id === adminId)!.online).toBeNull();
    const swept = await w.bridge.sweep();
    expect(swept.sessions).toBe(1);
    const session = await w.db.gameSession.findFirstOrThrow({ where: { connectedAt: new Date(start - HOUR) } });
    expect(session.disconnectedAt?.getTime()).toBe(start);
    expect(session.seconds).toBe(3600);

    // Filtrul pe server: adminul „toate serverele” apare și el.
    expect((await w.bridge.presence.list(w.member, { serverId: server.id })).map((a) => a.id).sort()).toEqual([adminId, idleId].sort());
    await expect(w.bridge.presence.list({ ...w.guest, isBanned: true })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("adminii raportați de sistemul de admini al serverului (plugin-v2 §2): online, numărul pe server, timpul de joc; fără intrări GCS", async () => {
    const server = await w.bridgeServer({ game: "cs16", identityMode: "steam" });
    const cs2 = await w.bridgeServer();
    const mock = w.mock(server.token, "cs16");
    const mock2 = w.mock(cs2.token);
    const admin = mockPlayer("cs16", 1, { flags: "abcdeiju" } as never);
    const vip = mockPlayer("cs16", 2, { flags: "bt" } as never);
    const plain = mockPlayer("cs16", 3);
    const cssAdmin = mockPlayer("cs2", 4, { permissions: ["@css/generic", "@css/kick"] } as never);
    const start = w.clock.now - (w.clock.now % 1000);
    w.clock.now = start - 2 * HOUR;
    await mock.send([mock.event("connect", { player: admin }), mock.event("connect", { player: vip })]);
    w.clock.now = start;
    await mock.heartbeat({ players: [admin, vip, plain] });
    await mock2.heartbeat({ players: [cssAdmin] });

    const sessions = await w.db.gameSession.findMany({ where: { serverId: server.id }, orderBy: { id: "asc" }, select: { adminFlags: true } });
    expect(sessions.map((s) => s.adminFlags)).toEqual(["abcdeiju", "bt", null]);

    const list = await w.bridge.presence.list(w.member);
    expect(list.map((a) => [a.subject, a.name, a.flags]).sort()).toEqual([
      ["SERVER", "Jucator1", "abcdeiju"],
      ["SERVER", "Jucator4", "cu"],
    ]);
    const me = list.find((a) => a.name === "Jucator1")!;
    expect(me).toMatchObject({ id: -me.playerId!, online: { serverId: server.id, since: new Date(start - 2 * HOUR).toISOString() }, server: { id: server.id }, label: null, inactive: false });
    expect(me.playtime.d1).toBe(7200);
    expect(await w.bridge.presence.onlineCounts([server.id, cs2.id])).toEqual(new Map([[server.id, 1], [cs2.id, 1]]));
    const online = await w.bridge.presence.online([server.id, cs2.id]);
    expect(online.map((o) => [o.adminId, o.flags, o.name]).sort()).toEqual([
      [null, "abcdeiju", "Jucator1"],
      [null, "cu", "Jucator4"],
    ]);

    // Flag-urile se schimbă (scoase de sistemul serverului): sesiunea se actualizează, adminul nu mai e online.
    await mock.heartbeat({ players: [{ ...admin, flags: "z" } as never, vip] });
    expect((await w.db.gameSession.findFirstOrThrow({ where: { serverId: server.id, disconnectedAt: null, name: "Jucator1" } })).adminFlags).toBeNull();
    expect((await w.bridge.presence.onlineCounts([server.id])).get(server.id)).toBeUndefined();

    // O identitate care e și intrare GCS apare o singură dată (ca intrare).
    const { id: entryId } = await w.bridge.admins.save(w.root, null, { subject: "PLAYER", identity: cssAdmin.auth, serverId: null, presetId: null, flags: "c", immunity: null, allowNonSteam: false, note: "", expiresAt: null });
    const after = await w.bridge.presence.list(w.member);
    expect(after.filter((a) => a.name === "Jucator4" || a.id === entryId).map((a) => a.subject)).toEqual(["PLAYER"]);
  });
});
