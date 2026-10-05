import { GcsForbidden, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import type { GcsPromotionInput } from "./promotions";

let w: GcsProfileWorld;
let admin: GcsActor;
let active: number;

beforeEach(async () => {
  w = await createProfileWorld();
  await w.grantAdmin(["members.promotions"]);
  admin = await w.actorFor(await w.createUser("Admin", "admin"));
  active = (await w.db.group.create({ data: { key: "custom_active", name: "Membru activ", position: 20 } })).id;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const rule = (patch: Partial<GcsPromotionInput> = {}): GcsPromotionInput => ({
  name: "Membru activ",
  fromGroupIds: [w.groups.member!],
  toGroupId: active,
  asPrimary: true,
  minPosts: 100,
  minDays: null,
  minReputation: null,
  minPoints: null,
  enabled: true,
  ...patch,
});
const primary = async (actor: GcsActor) => (await w.db.user.findUniqueOrThrow({ where: { id: actor.userId! } })).primaryGroupId;

describe("GcsPromotionService", () => {
  test("din Membru, după 100 de postări → Membru activ (principal); permVersion crește; intră în jurnal", async () => {
    await w.promotions.save(admin, null, rule());
    await w.db.user.update({ where: { id: w.member.userId! }, data: { postsCount: 99 } });
    expect(await w.promotions.evaluateUser(w.member.userId!)).toBe(0);
    const version = (await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } })).permVersion;

    await w.db.user.update({ where: { id: w.member.userId! }, data: { postsCount: 100 } });
    expect(await w.promotions.evaluateUser(w.member.userId!)).toBe(1);
    expect(await primary(w.member)).toBe(active);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: w.member.userId! } })).previousPrimaryGroupId).toBe(w.groups.member);
    expect((await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } })).permVersion).toBeGreaterThan(version);
    expect(await w.db.auditLog.count({ where: { action: "group.promoted" } })).toBe(1);
    expect(await w.promotions.evaluateUser(w.member.userId!)).toBe(0);
  });

  test("ca grup secundar: membrul rămâne Membru și primește grupul în plus", async () => {
    await w.promotions.save(admin, null, rule({ asPrimary: false, minPosts: 1 }));
    await w.db.user.update({ where: { id: w.member.userId! }, data: { postsCount: 1 } });
    await w.promotions.evaluateUser(w.member.userId!);
    expect(await primary(w.member)).toBe(w.groups.member);
    expect(await w.db.userGroup.count({ where: { userId: w.member.userId!, groupId: active } })).toBe(1);
  });

  test("o regulă cu vechime se aplică prin sweep-ul zilnic, fără activitate", async () => {
    await w.promotions.save(admin, null, rule({ minPosts: null, minDays: 30 }));
    await w.db.user.update({ where: { id: w.member.userId! }, data: { createdAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect(await w.promotions.dailySweep()).toBe(1);
    expect(await primary(w.member)).toBe(active);
  });

  test("un Moderator și un membru banat nu sunt promovați niciodată", async () => {
    await w.promotions.save(admin, null, rule({ fromGroupIds: [w.groups.member!, w.groups.moderator!], minPosts: 1 }));
    await w.db.user.update({ where: { id: w.moderator.userId! }, data: { postsCount: 500 } });
    expect(await w.promotions.evaluateUser(w.moderator.userId!)).toBe(0);
    await w.db.user.update({ where: { id: w.member.userId! }, data: { postsCount: 500 } });
    await w.db.ban.create({ data: { type: "ACCOUNT", value: w.member.userId!, userId: w.member.userId!, reason: "spam" } });
    expect(await w.promotions.evaluateUser(w.member.userId!)).toBe(0);
  });

  test("cu VIP activ ca grup principal, promovarea schimbă grupul la care revine (nu VIP-ul)", async () => {
    const vip = await w.actorFor(await w.createUser("Shadow", "vip_gold"));
    await w.db.user.update({ where: { id: vip.userId! }, data: { previousPrimaryGroupId: w.groups.member!, postsCount: 150 } });
    await w.db.vipSubscription.create({ data: { userId: vip.userId!, groupId: w.groups.vip_gold!, madePrimary: true } });
    await w.promotions.save(admin, null, rule());
    expect(await w.promotions.evaluateUser(vip.userId!)).toBe(1);
    const u = await w.db.user.findUniqueOrThrow({ where: { id: vip.userId! } });
    expect(u).toMatchObject({ primaryGroupId: w.groups.vip_gold, previousPrimaryGroupId: active });
  });

  test("evaluarea realizărilor rulează și promovările", async () => {
    await w.promotions.save(admin, null, rule({ minPosts: 1 }));
    await w.db.user.update({ where: { id: w.member.userId! }, data: { postsCount: 1 } });
    await w.achievements.evaluate(w.member.userId!);
    expect(await primary(w.member)).toBe(active);
  });

  test("ACP: validare (fără praguri, țintă = staff) și drepturi", async () => {
    await expect(w.promotions.save(w.member, null, rule())).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.promotions.save(admin, null, rule({ minPosts: null }))).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.promotions.save(admin, null, rule({ toGroupId: w.groups.admin! }))).rejects.toBeInstanceOf(GcsValidationError);
    const saved = await w.promotions.save(admin, null, rule());
    await w.promotions.delete(admin, saved.id);
    expect(await w.promotions.list()).toEqual([]);
  });
});
