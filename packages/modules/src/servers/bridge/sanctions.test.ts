import { beforeEach, describe, expect, it } from "vitest";
import { mockPlayer } from "../../../../../servers-plugins/mock/gcs-mock-server.mjs";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import type { GcsSanctionInput } from "./sanctions";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

const ban = (patch: Partial<GcsSanctionInput> = {}): GcsSanctionInput => ({
  type: "BAN",
  scope: "GLOBAL",
  serverId: null,
  target: { auth: "STEAM_1:1:450000" },
  reason: "wallhack",
  minutes: 0,
  ...patch,
});

describe("sancțiunile (§8): scopul, expirarea, sincronizarea, verificarea la conectare", () => {
  it("de pe site (staff): globală → pe toate serverele; „acest server” → doar acolo; /check la conectare", async () => {
    const a = await w.bridgeServer();
    const b = await w.bridgeServer();
    const ma = w.mock(a.token);
    const mb = w.mock(b.token);
    const p = mockPlayer("cs2", 1);
    const { id: globalId } = await w.bridge.sanctions.create(w.root, ban());
    const { id: serverId } = await w.bridge.sanctions.create(w.root, ban({ type: "GAG", scope: "SERVER", serverId: a.id, target: { auth: p.auth }, minutes: 30, reason: "spam" }));
    expect((await ma.pullSanctions()).map((s) => s.id).sort()).toEqual([globalId, serverId].sort());
    expect((await mb.pullSanctions()).map((s) => s.id)).toEqual([globalId]);

    const check = await ma.check(p);
    expect(check.ban).toMatchObject({ id: globalId, type: "ban", reason: "wallhack", expiresAt: null, scope: "global", auth: { kind: "steam" } });
    expect(check.gag).toMatchObject({ id: serverId, type: "gag", expiresAt: Math.floor(w.clock.now / 1000) + 30 * 60 });
    expect((await mb.check(p)).gag).toBeNull();
    expect(await w.db.auditLog.count({ where: { action: "servers.sanction.create" } })).toBe(2);
  });

  it("sincronizarea incrementală: revizie nouă la ridicare / modificare; `active: false` pentru ce nu se mai aplică", async () => {
    const a = await w.bridgeServer();
    const b = await w.bridgeServer();
    const mock = w.mock(a.token);
    const { id } = await w.bridge.sanctions.create(w.root, ban());
    const full = await mock.request("GET", "/sanctions?since=0");
    expect(full.json).toMatchObject({ full: true, more: false, sanctions: [{ id, active: true }] });
    const cursor = full.json.cursor as number;
    mock.cursor = cursor;
    expect(await mock.pullSanctions()).toEqual([]);

    // Mutată pe alt server → nu se mai aplică aici.
    await w.bridge.sanctions.update(w.root, id, { scope: "SERVER", serverId: b.id });
    expect(await mock.pullSanctions()).toEqual([{ id, active: false }]);
    await w.bridge.sanctions.update(w.root, id, { scope: "GLOBAL", serverId: null, minutes: 60 });
    const [back] = await mock.pullSanctions();
    expect(back).toMatchObject({ id, active: true, expiresAt: expect.any(Number) });
    await w.bridge.sanctions.lift(w.root, id, "contestație acceptată");
    expect(await mock.pullSanctions()).toEqual([{ id, active: false }]);
    expect((await mock.heartbeat()).versions.sanctions).toBe(mock.cursor);

    // Expirarea naturală nu schimbă revizia: pluginul aplică singur `expiresAt`.
    const { id: temp } = await w.bridge.sanctions.create(w.root, ban({ minutes: 5 }));
    await mock.pullSanctions();
    const before = mock.cursor;
    w.clock.now += 10 * 60_000;
    expect(await mock.pullSanctions()).toEqual([]);
    expect(mock.cursor).toBe(before);
    expect((await mock.check(mockPlayer("cs2", 1))).ban).toBeNull();
    expect((await mock.request("GET", "/sanctions?since=0")).json.sanctions.map((s: { id: number }) => s.id)).not.toContain(temp);
  });

  it("paginile: max 1000 de rânduri, `more` și cursorul", async () => {
    const server = await w.bridgeServer();
    const mock = w.mock(server.token);
    await w.db.gameSanction.createMany({ data: Array.from({ length: 1205 }, (_, i) => ({ type: "BAN" as const, scope: "GLOBAL" as const, targetKind: "STEAM" as const, targetValue: String(76561197960265728n + BigInt(i + 1)), reason: "x", source: "SITE" as const })) });
    const first = await mock.request("GET", "/sanctions?since=0");
    expect(first.json).toMatchObject({ full: true, more: true });
    expect(first.json.sanctions).toHaveLength(1000);
    expect((await mock.pullSanctions()).length).toBe(1205);
    // Pagini mai mici (pluginul AMX Mod X): `limit`.
    const small = await mock.request("GET", "/sanctions?since=0&limit=100");
    expect(small.json).toMatchObject({ full: true, more: true });
    expect(small.json.sanctions).toHaveLength(100);
  });

  it("banul pe nume se aplică doar non-Steam; banul pe IP oricui", async () => {
    const server = await w.bridgeServer({ game: "cs16" });
    const mock = w.mock(server.token, "cs16");
    await w.bridge.sanctions.create(w.root, ban({ target: { name: "Ion Pro" } }));
    await w.bridge.sanctions.create(w.root, ban({ type: "MUTE", target: { ip: "198.51.100.77" } }));
    const steam = { ...mockPlayer("cs16", 1), name: "ion  pro" };
    const emu = { ...mockPlayer("cs16", 2), steam: false, name: "ION PRO" };
    expect((await mock.check(steam)).ban).toBeNull();
    expect((await mock.check(emu)).ban).toMatchObject({ auth: null, name: "ion pro" });
    expect((await mock.check({ ...steam, ip: "198.51.100.77" })).mute).toMatchObject({ type: "mute", ip: "198.51.100.77" });
    await expect(w.bridge.sanctions.create(w.root, ban({ target: {} }))).rejects.toMatchObject({ fields: { target: "required" } });
    await expect(w.bridge.sanctions.create(w.root, ban({ target: { auth: "STEAM_ID_LAN" } }))).rejects.toMatchObject({ fields: { target: "invalid_identity" } });
    await expect(w.bridge.sanctions.create(w.root, ban({ evidence: ["http://x.ro/a.png"] }))).rejects.toMatchObject({ fields: { evidence: "invalid_url" } });
  });

  it("adminii serverelor de pe site: `d` = orice ban pe serverele lor, `v` = doar temporar ≤ tempban_max, `i` = mute / gag; global cere toate serverele", async () => {
    const a = await w.bridgeServer();
    const b = await w.bridgeServer();
    const mod = await w.actorFor(await w.createUser("Moderatorul", "member"));
    await w.bridge.admins.save(w.root, null, { subject: "USER", userId: mod.userId, serverId: a.id, presetId: null, flags: "vi", immunity: null, allowNonSteam: false, note: "", expiresAt: null });
    const can = (o: Partial<{ type: "BAN" | "MUTE" | "GAG"; scope: "SERVER" | "GLOBAL"; serverId: number | null; minutes: number }>) =>
      w.bridge.sanctions.canSanction(mod, { type: "BAN", scope: "SERVER", serverId: a.id, minutes: 60, ...o });
    expect(await can({})).toBe(true);
    expect(await can({ minutes: 0 })).toBe(false);
    expect(await can({ minutes: 10_081 })).toBe(false);
    expect(await can({ serverId: b.id })).toBe(false);
    expect(await can({ scope: "GLOBAL", serverId: null })).toBe(false);
    expect(await can({ type: "GAG", minutes: 0 })).toBe(true);
    await expect(w.bridge.sanctions.create(mod, ban({ scope: "SERVER", serverId: a.id, minutes: 0 }))).rejects.toMatchObject({ code: "forbidden" });
    const { id } = await w.bridge.sanctions.create(mod, ban({ scope: "SERVER", serverId: a.id, minutes: 120 }));
    expect(await w.db.gameSanction.findUniqueOrThrow({ where: { id } })).toMatchObject({ adminUserId: mod.userId, adminName: "Moderatorul", source: "SITE" });
    expect(await w.bridge.sanctions.canSanction(w.member, { type: "BAN", scope: "SERVER", serverId: a.id, minutes: 60 })).toBe(false);
  });

  it("din joc: globală doar de la un admin cunoscut pe toate serverele; ridicarea din joc; lista publică ascunde IP-ul", async () => {
    const server = await w.bridgeServer();
    const mock = w.mock(server.token);
    const admin = mockPlayer("cs2", 1);
    const target = mockPlayer("cs2", 2);
    await w.bridge.admins.save(w.root, null, { subject: "PLAYER", identity: admin.auth, serverId: null, presetId: null, flags: "cd", immunity: null, allowNonSteam: false, note: "", expiresAt: null });
    const [created] = await mock.send([mock.event("sanction", { kind: "ban", target, minutes: 0, reason: "aimbot", scope: "global", admin })]);
    expect(created).toMatchObject({ status: "ok" });
    expect(created!.note).toBeUndefined();
    const row = await w.db.gameSanction.findUniqueOrThrow({ where: { id: created!.sanctionId! } });
    expect(row).toMatchObject({ scope: "GLOBAL", source: "GAME", ip: "198.51.100.12", adminName: "Jucator1" });

    const [lifted] = await mock.send([mock.event("unsanction", { kind: "ban", target, admin, reason: "greșeală" })]);
    expect(lifted).toMatchObject({ status: "ok", sanctionId: row.id });
    expect(await w.db.gameSanction.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ unbanReason: "greșeală", unbannedByName: "Jucator1" });
    expect((await mock.send([mock.event("unsanction", { kind: "ban", target, admin })]))[0]).toMatchObject({ status: "rejected", error: "not_found" });
    expect(await w.db.gameAdminAction.findMany({ select: { action: true }, orderBy: { id: "asc" } })).toEqual([{ action: "ban" }, { action: "unban" }]);

    const publicList = await w.bridge.sanctions.list(w.member, {});
    expect(publicList.items[0]).toMatchObject({ id: row.id, ip: null, status: "lifted" });
    expect((await w.bridge.sanctions.list(w.root, { q: "198.51.100.12" })).items).toHaveLength(1);
  });
});
