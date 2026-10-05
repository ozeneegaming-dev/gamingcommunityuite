import { GcsForbidden, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";

let w: GcsProfileWorld;
let admin: GcsActor;

beforeEach(async () => {
  w = await createProfileWorld();
  admin = await w.actorFor(await w.createUser("Admin", "admin"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const DAY = 86_400_000;
const user = (actor: GcsActor) => w.db.user.findUniqueOrThrow({ where: { id: actor.userId! }, include: { groups: true } });
const logActions = async (actor: GcsActor) => (await w.db.vipLog.findMany({ where: { userId: actor.userId! }, orderBy: { id: "asc" } })).map((l) => l.action);

describe("acordare (Review Focus #1)", () => {
  test("ca grup principal: VIP Gold devine principal, Membru e păstrat ca grup anterior; permVersion crește", async () => {
    const version = (await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } })).permVersion;
    const sub = await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 30 });
    expect(sub.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(await user(w.member)).toMatchObject({ primaryGroupId: w.groups.vip_gold, previousPrimaryGroupId: w.groups.member });
    expect((await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } })).permVersion).toBeGreaterThan(version);
    expect(await logActions(w.member)).toEqual(["GRANT"]);
  });

  test("doar cu `vip.manage` și doar pe grupuri VIP; zilele între 1 și 3650", async () => {
    await expect(w.vip.grant(w.moderator, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 30 })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.moderator!, days: 30 })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 0 })).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("schimbarea nivelului Gold → Legend: un singur abonament activ, istoricul are acordarea, retragerea și noua acordare", async () => {
    await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 30 });
    await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_legend!, days: null });
    expect(await w.db.vipSubscription.count({ where: { userId: w.member.userId!, status: "ACTIVE" } })).toBe(1);
    // Grupul anterior rămâne Membru (nu VIP Gold).
    expect(await user(w.member)).toMatchObject({ primaryGroupId: w.groups.vip_legend, previousPrimaryGroupId: w.groups.member });
    expect(await logActions(w.member)).toEqual(["GRANT", "REVOKE", "GRANT"]);
  });

  test("ca grup secundar: grupul principal rămâne, VIP-ul se adaugă și dispare la retragere", async () => {
    const sub = await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_silver!, days: 10, asPrimary: false });
    let u = await user(w.member);
    expect(u.primaryGroupId).toBe(w.groups.member);
    expect(u.groups.map((g) => g.groupId)).toEqual([w.groups.vip_silver]);
    await w.vip.revoke(admin, sub.id, "test");
    u = await user(w.member);
    expect(u.groups).toEqual([]);
    expect(await logActions(w.member)).toEqual(["GRANT", "REVOKE"]);
  });
});

describe("prelungire", () => {
  test("un VIP cu 10 zile rămase, prelungit cu 30 → 40 de zile; reacordarea aceluiași nivel prelungește", async () => {
    const sub = await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 10 });
    const extended = await w.vip.extend(admin, sub.id, 30);
    expect(Math.round((extended.expiresAt!.getTime() - Date.now()) / DAY)).toBe(40);
    const again = await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 5 });
    expect(again.id).toBe(sub.id);
    expect(Math.round((again.expiresAt!.getTime() - Date.now()) / DAY)).toBe(45);
    expect(await logActions(w.member)).toEqual(["GRANT", "EXTEND", "EXTEND"]);
  });

  test("prelungirea unui VIP expirat de mult pornește de acum", async () => {
    const sub = await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 10 });
    await w.db.vipSubscription.update({ where: { id: sub.id }, data: { expiresAt: new Date(Date.now() - 5 * DAY) } });
    const extended = await w.vip.extend(admin, sub.id, 30);
    expect(Math.round((extended.expiresAt!.getTime() - Date.now()) / DAY)).toBe(30);
  });
});

describe("expirare (Review Focus #1)", () => {
  test("după expirare: înapoi la Membru, rama Gold scoasă, istoric EXPIRE", async () => {
    const gold = await w.db.avatarFrame.findUniqueOrThrow({ where: { key: "gold" } });
    const sub = await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 30 });
    await w.cosmetics.choose(await w.actorFor({ id: w.member.userId! }), { avatarFrameId: gold.id });
    await w.db.vipSubscription.update({ where: { id: sub.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await w.vip.sweep()).toMatchObject({ expired: 1 });
    expect(await user(w.member)).toMatchObject({ primaryGroupId: w.groups.member, avatarFrameId: null });
    expect((await w.db.vipSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("EXPIRED");
    expect(await logActions(w.member)).toEqual(["GRANT", "EXPIRE"]);
  });

  test("dacă grupul anterior a fost șters între timp, revine la Membru", async () => {
    const custom = await w.db.group.create({ data: { key: "custom_x", name: "Clan" } });
    await w.db.user.update({ where: { id: w.member.userId! }, data: { primaryGroupId: custom.id } });
    const sub = await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 1 });
    await w.db.group.delete({ where: { id: custom.id } }).catch(() => w.db.$executeRaw`DELETE FROM groups WHERE id = ${custom.id}`);
    await w.db.vipSubscription.update({ where: { id: sub.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await w.vip.sweep();
    expect((await user(w.member)).primaryGroupId).toBe(w.groups.member);
  });

  test("două sweep-uri în paralel: o singură expirare, o singură intrare în istoric și un singur email", async () => {
    const sub = await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 2 });
    const soon = await w.vip.grant(admin, { userId: w.moderator.userId!, groupId: w.groups.vip_silver!, days: 2, asPrimary: false });
    await w.db.vipSubscription.update({ where: { id: sub.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const results = await Promise.all([w.vip.sweep(), w.vip.sweep(), w.vip.sweep()]);
    expect(results.reduce((n, r) => n + r.expired, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.warned, 0)).toBe(1);
    expect(await logActions(w.member)).toEqual(["GRANT", "EXPIRE"]);
    expect(w.outbox.map((m) => m.to)).toHaveLength(1);
    expect(w.outbox[0]!.subject).toContain("VIP Silver");
    expect((await w.db.vipSubscription.findUniqueOrThrow({ where: { id: soon.id } })).warnedAt).not.toBeNull();

    // A doua rulare nu mai trimite nimic.
    expect(await w.vip.sweep()).toEqual({ expired: 0, warned: 0 });
  });

  test("un VIP permanent nu expiră; un abonament pe 30 de zile nu e avertizat încă", async () => {
    await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_legend!, days: null });
    await w.vip.grant(admin, { userId: w.moderator.userId!, groupId: w.groups.vip_gold!, days: 30, asPrimary: false });
    expect(await w.vip.sweep(new Date(Date.now() + 365 * DAY * 5))).toMatchObject({ expired: 1 });
    expect((await user(w.member)).primaryGroupId).toBe(w.groups.vip_legend);
  });
});

describe("badge-ul VIP", () => {
  test("acordarea VIP-ului dă badge-ul la următoarea evaluare", async () => {
    await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 30 });
    await w.achievements.evaluate(w.member.userId!);
    const badges = await w.db.userBadge.findMany({ where: { userId: w.member.userId! }, include: { badge: true } });
    expect(badges.map((b) => b.badge.key)).toEqual(["vip"]);
  });
});
