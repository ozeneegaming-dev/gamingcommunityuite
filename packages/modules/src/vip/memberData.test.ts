import type { GcsActor } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";

let w: GcsRemovalWorld;
let root: GcsActor;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  root = await w.user("Fondator", "root_admin");
});

const active = (userId: string) => w.s.db.vipSubscription.findFirst({ where: { userId, status: "ACTIVE" } });
const primary = async (userId: string) => (await w.s.db.user.findUniqueOrThrow({ where: { id: userId }, select: { primaryGroup: { select: { key: true } } } })).primaryGroup.key;

describe("VIP-ul la ștergere și la unire", () => {
  test("la ștergere, abonamentele și istoricul VIP dispar", async () => {
    const vip = await w.user("Vip");
    await w.s.vip.grant(root, { userId: vip.userId!, groupId: w.group("vip_gold"), days: 30 });
    await w.s.memberRemoval.requestDelete(root, vip.userId!, { mode: "KEEP_CONTENT", keepMessages: false });
    expect(await w.s.db.vipSubscription.count()).toBe(0);
    expect(await w.s.db.vipLog.count()).toBe(0);
  });

  test("doar sursa are VIP: abonamentul trece pe țintă, cu grupul aplicat", async () => {
    const source = await w.user("Dublura");
    const target = await w.user("Principal");
    await w.s.vip.grant(root, { userId: source.userId!, groupId: w.group("vip_gold"), days: 30 });
    const preview = await w.s.memberRemoval.mergePreview(root, source.userId!, target.userId!);
    expect(preview.notes.map((n) => n.key)).toContain("vip_moves");
    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);
    expect(await active(target.userId!)).toMatchObject({ groupId: w.group("vip_gold") });
    expect(await primary(target.userId!)).toBe("vip_gold");
    expect(await w.s.db.vipLog.count({ where: { userId: target.userId! } })).toBeGreaterThanOrEqual(2);
  });

  test("amândouă au VIP: se păstrează cel mai lung (permanent > dată)", async () => {
    const source = await w.user("Dublura");
    const target = await w.user("Principal");
    await w.s.vip.grant(root, { userId: source.userId!, groupId: w.group("vip_legend"), days: null });
    await w.s.vip.grant(root, { userId: target.userId!, groupId: w.group("vip_bronze"), days: 10 });
    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);
    expect(await active(target.userId!)).toMatchObject({ groupId: w.group("vip_legend"), expiresAt: null });
    expect(await w.s.db.vipSubscription.count({ where: { userId: target.userId!, status: "ACTIVE" } })).toBe(1);
    expect(await primary(target.userId!)).toBe("vip_legend");

    // Invers: ținta are abonamentul mai lung → rămâne al ei.
    const s2 = await w.user("Dublura2");
    const t2 = await w.user("Principal2");
    await w.s.vip.grant(root, { userId: s2.userId!, groupId: w.group("vip_silver"), days: 5 });
    await w.s.vip.grant(root, { userId: t2.userId!, groupId: w.group("vip_gold"), days: 60 });
    expect((await w.s.memberRemoval.mergePreview(root, s2.userId!, t2.userId!)).notes.map((n) => n.key)).toContain("vip_target_kept");
    await w.s.memberRemoval.requestMerge(root, s2.userId!, t2.userId!);
    expect(await active(t2.userId!)).toMatchObject({ groupId: w.group("vip_gold") });
    expect(await primary(t2.userId!)).toBe("vip_gold");
  });
});
