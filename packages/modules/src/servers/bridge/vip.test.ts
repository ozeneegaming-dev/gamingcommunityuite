import { beforeEach, describe, expect, it } from "vitest";
import { GcsMembership } from "../../profile/membership";
import { GcsVipService } from "../../vip/vip";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

describe("VIP pe servere (§12)", () => {
  it("grupul VIP pornit pe server → identitățile Steam și non-Steam ale membrilor cu abonament activ; expirarea scoate drepturile", async () => {
    const server = await w.bridgeServer({ game: "cs16" });
    const mock = w.mock(server.token, "cs16");
    const gold = await w.db.group.findUniqueOrThrow({ where: { key: "vip_gold" } });
    const vip = new GcsVipService({ db: w.db, bus: w.bus, permissions: w.permissions, settings: w.settings, membership: new GcsMembership({ bus: w.bus, permissions: w.permissions }) });

    expect(await mock.pullVip()).toEqual([]);
    const mappings = await w.bridge.vip.mappings(w.root, server.id);
    expect(mappings.map((m) => m.enabled)).toEqual(mappings.map(() => false));
    await w.bridge.vip.saveMappings(w.root, server.id, [{ groupId: gold.id, enabled: true, flags: "bt" }]);

    await w.db.gamePlayer.createMany({
      data: [
        { kind: "STEAM", value: "76561197960287930", trust: "HIGH", userId: w.member.userId },
        { kind: "NONSTEAM", value: "VALVE_0:1:5", trust: "MEDIUM", userId: w.member.userId },
        { kind: "NAME", value: "mara", trust: "LOW", userId: w.member.userId },
      ],
    });
    const sub = await vip.grant(w.root, { userId: w.member.userId!, groupId: gold.id, days: 7 });
    const expiresAt = sub.expiresAt!;
    const list = (await mock.pullVip())!;
    expect(list).toEqual([
      { auth: { kind: "steam", steamId64: "76561197960287930", steam2: "STEAM_0:0:11101" }, flags: "bt", permissions: ["@css/reservation", "@gcs/custom_h"], expiresAt: Math.floor(expiresAt.getTime() / 1000), group: gold.name },
      { auth: { kind: "nonsteam", id: "VALVE_0:1:5" }, flags: "bt", permissions: ["@css/reservation", "@gcs/custom_h"], expiresAt: Math.floor(expiresAt.getTime() / 1000), group: gold.name },
    ]);
    expect((await mock.check({ auth: "STEAM_0:0:11101", steam: true, name: "Mara" })).vip).toMatchObject({ flags: "bt", group: gold.name });

    // Expirarea (jobul VIP) → evenimentul `vip.expired` → ETag nou → lista goală.
    await vip.sweep(new Date(expiresAt.getTime() + 1000));
    w.clock.now = expiresAt.getTime() + 2000;
    expect(await mock.pullVip()).toEqual([]);
  });

  it("dreptul ACP și grupurile invalide", async () => {
    const server = await w.bridgeServer();
    await expect(w.bridge.vip.saveMappings(w.member, server.id, [])).rejects.toMatchObject({ code: "forbidden" });
    const member = await w.db.group.findUniqueOrThrow({ where: { key: "member" } });
    await expect(w.bridge.vip.saveMappings(w.root, server.id, [{ groupId: member.id, enabled: true, flags: "b" }])).rejects.toMatchObject({ code: "validation" });
  });
});
