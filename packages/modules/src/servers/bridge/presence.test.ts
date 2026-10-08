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
});
