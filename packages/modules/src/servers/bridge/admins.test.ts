import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { mockPlayer } from "../../../../../servers-plugins/mock/gcs-mock-server.mjs";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import type { GcsServerAdminInput } from "./admins";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

const base = (patch: Partial<GcsServerAdminInput>): GcsServerAdminInput => ({
  subject: "USER",
  serverId: null,
  presetId: null,
  flags: null,
  immunity: null,
  allowNonSteam: false,
  note: "",
  expiresAt: null,
  ...patch,
});

async function presetId(name: string) {
  return (await w.db.gameAdminPreset.findFirstOrThrow({ where: { name } })).id;
}

describe("adminii serverelor (§7)", () => {
  it("presetările implicite: Moderator, Admin, Head admin (o singură dată)", async () => {
    expect((await w.bridge.admins.presets()).map((p) => [p.name, p.flags, p.immunity])).toEqual([
      ["Moderator", "bceiju", 10],
      ["Admin", "bcdefgijmnouv", 50],
      ["Head admin", "abcdefghijklmnopqrstuv", 90],
    ]);
  });

  it("un membru admin: doar identitățile lui Steam (non-Steam doar cu opțiunea); lista serverului cu permisiunile CS2", async () => {
    const server = await w.bridgeServer();
    const mock = w.mock(server.token);
    await mock.check(mockPlayer("cs2", 1));
    const steam = await w.db.gamePlayer.findFirstOrThrow();
    await w.db.gamePlayer.update({ where: { id: steam.id }, data: { userId: w.member.userId, linkSource: "STAFF" } });
    const emu = await w.db.gamePlayer.create({ data: { kind: "NONSTEAM", value: "STEAM_0:1:5", trust: "MEDIUM", userId: w.member.userId } });

    const { id } = await w.bridge.admins.save(w.root, null, base({ userId: w.member.userId, presetId: await presetId("Head admin") }));
    let list = await mock.pullAdmins();
    expect(list).toEqual([
      { id, auth: { kind: "steam", steamId64: steam.value, steam2: "STEAM_1:1:450000" }, flags: "abcdefghijklmnopqrstuv", immunity: 90, permissions: expect.arrayContaining(["@css/root", "@css/ban", "@css/rcon"]), expiresAt: null, label: "Head admin" },
    ]);
    // ETag neschimbat → 304.
    expect(await mock.pullAdmins()).toBeNull();

    await w.bridge.admins.save(w.root, id, base({ userId: w.member.userId, presetId: await presetId("Head admin"), allowNonSteam: true }));
    list = await mock.pullAdmins();
    expect(list!.map((a) => a.auth)).toEqual([expect.objectContaining({ kind: "steam" }), { kind: "nonsteam", id: emu.value }]);
    const rows = await w.bridge.admins.list(w.root);
    expect(rows[0]!.warnings).toEqual(["non_steam"]);
  });

  it("mai multe intrări pe aceeași identitate: reuniunea flag-urilor, imunitatea maximă, expirarea cea mai târzie", async () => {
    const server = await w.bridgeServer();
    const other = await w.bridgeServer();
    const mock = w.mock(server.token);
    const later = new Date(w.clock.now + 30 * 86_400_000).toISOString();
    await w.bridge.admins.save(w.root, null, base({ subject: "PLAYER", identity: "STEAM_1:0:7", serverId: server.id, flags: "bc", immunity: 10, expiresAt: new Date(w.clock.now + 86_400_000).toISOString() }));
    await w.bridge.admins.save(w.root, null, base({ subject: "PLAYER", identity: "STEAM_1:0:7", serverId: null, flags: "d", immunity: 40, expiresAt: later }));
    await w.bridge.admins.save(w.root, null, base({ subject: "PLAYER", identity: "STEAM_1:0:7", serverId: other.id, flags: "l" }));
    const list = (await mock.pullAdmins())!;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ flags: "bcd", immunity: 40, expiresAt: Math.floor(new Date(later).getTime() / 1000), permissions: ["@css/reservation", "@css/kick", "@css/ban", "@css/unban"] });
  });

  it("admin pe nume + parolă: doar sarea și verificatorul pleacă spre server; parola nouă = sare nouă", async () => {
    const server = await w.bridgeServer({ game: "cs16" });
    const mock = w.mock(server.token, "cs16");
    await expect(w.bridge.admins.save(w.root, null, base({ subject: "NAME", name: "Ion", password: "scurta", presetId: await presetId("Admin") }))).rejects.toMatchObject({ fields: { password: "weak_password" } });
    const { id } = await w.bridge.admins.save(w.root, null, base({ subject: "NAME", name: " Ion ", password: "parola-buna-123", presetId: await presetId("Admin") }));
    const [entry] = (await mock.pullAdmins())!;
    expect(entry!.auth).toMatchObject({ kind: "name", name: "ion" });
    const { salt, verifier } = entry!.auth as { salt: string; verifier: string };
    expect(verifier).toBe(createHash("sha256").update(`${salt}:parola-buna-123`).digest("hex"));
    expect(JSON.stringify(entry)).not.toContain("parola-buna-123");
    expect(JSON.stringify(await w.db.auditLog.findMany())).not.toContain("parola-buna-123");

    // Editarea fără parolă păstrează verificatorul; o parolă nouă schimbă sarea.
    await w.bridge.admins.save(w.root, id, base({ subject: "NAME", name: "Ion", password: "", presetId: await presetId("Admin"), note: "fără parolă nouă" }));
    expect((await w.db.gameAdmin.findUniqueOrThrow({ where: { id } })).passwordSalt).toBe(salt);
    await w.bridge.admins.save(w.root, id, base({ subject: "NAME", name: "Ion", password: "alta-parola-456", presetId: await presetId("Admin") }));
    expect((await w.db.gameAdmin.findUniqueOrThrow({ where: { id } })).passwordSalt).not.toBe(salt);
    await expect(w.bridge.admins.save(w.root, null, base({ subject: "NAME", name: "ION", password: "parola-buna-123", flags: "b" }))).rejects.toMatchObject({ fields: { name: "duplicate" } });

    // `admin_login`: sesiunea jucătorului devine a adminului (prezența îl vede).
    const player = { auth: "STEAM_ID_LAN", name: "Ion" };
    await w.bridge.saveConfig(w.root, server.id, { identityMode: "mixed", nameIds: true, isMix: false });
    await mock.send([mock.event("connect", { player }), mock.event("admin_login", { player, adminId: id })]);
    expect((await w.db.gameSession.findFirstOrThrow()).adminId).toBe(id);
    expect((await mock.send([mock.event("admin_login", { player, adminId: 999 })]))[0]).toMatchObject({ status: "rejected", error: "invalid_admin" });
  });

  it("expirarea: intrarea expirată dispare din listă; jobul scrie o dată în jurnal", async () => {
    const server = await w.bridgeServer();
    const mock = w.mock(server.token);
    await w.bridge.admins.save(w.root, null, base({ subject: "PLAYER", identity: "76561197960287930", flags: "bc", expiresAt: new Date(w.clock.now + 3_600_000).toISOString() }));
    expect(await mock.pullAdmins()).toHaveLength(1);
    w.clock.now += 2 * 3_600_000;
    expect(await w.bridge.admins.expireSweep()).toBe(1);
    expect(await w.bridge.admins.expireSweep()).toBe(0);
    expect(await mock.pullAdmins()).toEqual([]);
    expect(await w.db.auditLog.count({ where: { action: "servers.admin.expire" } })).toBe(1);
  });

  it("validarea și drepturile: secțiunea ACP, presetare sau flag-uri, identitate validă; ștergerea presetării păstrează drepturile", async () => {
    await expect(w.bridge.admins.save(w.member, null, base({ subject: "PLAYER", identity: "76561197960287930", flags: "b" }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(w.bridge.admins.save(w.root, null, base({ subject: "PLAYER", identity: "STEAM_ID_LAN" }))).rejects.toMatchObject({ fields: { identity: "invalid", flags: "required" } });
    const preset = await w.bridge.admins.savePreset(w.root, null, { name: "VIP+", flags: "bz", immunity: 5 });
    const { id } = await w.bridge.admins.save(w.root, null, base({ subject: "PLAYER", identity: "76561197960287930", presetId: preset.id }));
    await w.bridge.admins.removePreset(w.root, preset.id);
    expect(await w.db.gameAdmin.findUniqueOrThrow({ where: { id } })).toMatchObject({ presetId: null, flags: "bz", immunity: 5 });
    await w.bridge.admins.remove(w.root, id);
    expect(await w.db.auditLog.count({ where: { action: { startsWith: "servers.admin." } } })).toBe(2);
    expect(await w.db.auditLog.count({ where: { action: { startsWith: "servers.preset." } } })).toBe(2);
  });
});
