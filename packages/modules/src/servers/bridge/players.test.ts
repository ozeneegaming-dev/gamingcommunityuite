import { beforeEach, describe, expect, it } from "vitest";
import { mockPlayer } from "../../../../../servers-plugins/mock/gcs-mock-server.mjs";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { normalizeLinkCode } from "./players";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

describe("identitățile și legarea de cont (§3.3)", () => {
  it("identitatea Steam se leagă automat la prima apariție de membrul cu același cont Steam", async () => {
    const { token } = await w.bridgeServer();
    const mock = w.mock(token);
    const p = mockPlayer("cs2", 1);
    const check = await mock.check(p);
    expect(check.player).toMatchObject({ kind: "steam", linked: false });

    const other = mockPlayer("cs2", 2);
    const steamId = "76561197961165730"; // contul 900002 → STEAM_1:0:450001
    await w.db.account.create({ data: { userId: w.member.userId!, providerId: "steam", accountId: steamId } });
    const linked = await mock.check(other);
    expect(linked.player).toMatchObject({ kind: "steam", linked: true });
    expect(await w.db.gamePlayer.findFirstOrThrow({ where: { value: steamId } })).toMatchObject({ userId: w.member.userId, linkSource: "STEAM" });
  });

  it("syncSteam / reconcilierea: conectarea Steam leagă, dezlegarea dezleagă", async () => {
    const { token } = await w.bridgeServer();
    const mock = w.mock(token);
    await mock.check(mockPlayer("cs2", 1));
    const player = await w.db.gamePlayer.findFirstOrThrow();
    await w.db.account.create({ data: { userId: w.member.userId!, providerId: "steam", accountId: player.value } });
    expect(await w.bridge.players.reconcileSteam()).toBe(1);
    expect((await w.db.gamePlayer.findUniqueOrThrow({ where: { id: player.id } })).userId).toBe(w.member.userId);
    await w.db.account.deleteMany({ where: { userId: w.member.userId!, providerId: "steam" } });
    expect(await w.bridge.players.syncSteam(w.member.userId!)).toBe(1);
    expect((await w.db.gamePlayer.findUniqueOrThrow({ where: { id: player.id } })).userId).toBeNull();
    expect(await w.bridge.players.reconcileSteam()).toBe(0);
    // Un cont Steam fără identitate văzută în joc: nimic de legat acum (legarea se face la prima apariție).
    await w.db.account.create({ data: { userId: w.root.userId!, providerId: "steam", accountId: "76561197960265999" } });
    expect(await w.bridge.players.syncSteam(w.root.userId!)).toBe(0);
    expect(await w.bridge.players.reconcileSteam()).toBe(0);
    expect(await w.db.gamePlayer.count({ where: { value: "76561197960265999" } })).toBe(0);
  });

  it("codul de legare: 6 caractere, valabil 10 minute, o singură folosire; un cod nou îl anulează pe cel vechi", async () => {
    const { token } = await w.bridgeServer({ game: "cs16" });
    const mock = w.mock(token, "cs16");
    const emu = { ...mockPlayer("cs16", 1), steam: false };
    const first = await w.bridge.players.createLinkCode(w.member);
    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const second = await w.bridge.players.createLinkCode(w.member);
    expect((await mock.link(emu, first.code)).json).toMatchObject({ error: "expired_code" });
    const ok = await mock.link(emu, second.code.toLowerCase());
    expect(ok).toMatchObject({ status: 200, json: { ok: true, user: "Mara" } });
    expect((await mock.link(emu, second.code)).json).toMatchObject({ error: "used_code" });
    const player = await w.db.gamePlayer.findFirstOrThrow({ where: { kind: "NONSTEAM" } });
    expect(player).toMatchObject({ userId: w.member.userId, linkSource: "CODE" });
    expect(await w.db.auditLog.count({ where: { action: "servers.player.link" } })).toBe(1);
  });

  it("codul expiră după 10 minute; Steam nu se leagă prin cod; o identitate legată de alt membru e refuzată", async () => {
    const { token } = await w.bridgeServer({ game: "cs16" });
    const mock = w.mock(token, "cs16");
    const code = await w.bridge.players.createLinkCode(w.member);
    w.clock.now += 11 * 60_000;
    expect((await mock.link({ ...mockPlayer("cs16", 1), steam: false }, code.code)).json).toMatchObject({ error: "expired_code" });

    const fresh = await w.bridge.players.createLinkCode(w.member);
    expect((await mock.link(mockPlayer("cs16", 2), fresh.code)).json).toMatchObject({ error: "steam_use_site" });
    expect((await mock.link({ auth: "STEAM_ID_LAN", name: "Ion" }, fresh.code)).json).toMatchObject({ error: "no_identity" });

    const other = await w.actorFor(await w.createUser("Ana", "member"));
    const emu = { ...mockPlayer("cs16", 3), steam: false };
    expect((await mock.link(emu, fresh.code)).status).toBe(200);
    const theirs = await w.bridge.players.createLinkCode(other);
    expect((await mock.link(emu, theirs.code)).json).toMatchObject({ error: "already_linked" });
  });

  it("încercările cu cod greșit sunt limitate (5 / minut / identitate); max 5 coduri pe oră pe membru", async () => {
    const { token } = await w.bridgeServer({ game: "cs16" });
    const mock = w.mock(token, "cs16");
    const emu = { ...mockPlayer("cs16", 1), steam: false };
    for (let i = 0; i < 5; i++) expect((await mock.link(emu, "AAAAAA")).json).toMatchObject({ error: "invalid_code" });
    const code = await w.bridge.players.createLinkCode(w.member);
    expect((await mock.link(emu, code.code)).json).toMatchObject({ error: "rate_limited" });
    for (let i = 0; i < 4; i++) await w.bridge.players.createLinkCode(w.member);
    await expect(w.bridge.players.createLinkCode(w.member)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(w.bridge.players.createLinkCode(w.guest)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("dezlegarea proprie (non-Steam) și legarea / dezlegarea de staff", async () => {
    const { token } = await w.bridgeServer({ game: "cs16" });
    const mock = w.mock(token, "cs16");
    const code = await w.bridge.players.createLinkCode(w.member);
    await mock.link({ ...mockPlayer("cs16", 1), steam: false }, code.code);
    const player = await w.db.gamePlayer.findFirstOrThrow();
    expect((await w.bridge.players.byUser(w.member.userId!)).map((p) => p.id)).toEqual([player.id]);
    await w.bridge.players.unlinkOwn(w.member, player.id);
    expect(await w.bridge.players.byUser(w.member.userId!)).toEqual([]);
    await expect(w.bridge.players.staffLink(w.member, player.id, w.member.userId)).rejects.toMatchObject({ code: "forbidden" });
    await w.bridge.players.staffLink(w.root, player.id, w.member.userId);
    expect(await w.db.gamePlayer.findUniqueOrThrow({ where: { id: player.id } })).toMatchObject({ userId: w.member.userId, linkSource: "STAFF" });
    expect((await w.bridge.players.search("Jucator1")).map((p) => p.id)).toEqual([player.id]);
    expect((await w.bridge.players.search(player.value)).map((p) => p.id)).toEqual([player.id]);
  });

  it("normalizarea codului scris în joc", () => {
    expect(normalizeLinkCode(" ab c2 3d ")).toBe("ABC23D");
    expect(normalizeLinkCode("ABC10O")).toBeNull();
    expect(normalizeLinkCode(42)).toBeNull();
  });
});
