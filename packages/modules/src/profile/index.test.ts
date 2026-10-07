import { seedDefaults } from "@gcs/core";
import { createWorld, type GcsTestWorld } from "@gcs/core/test/world";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { realRegistry } from "../../test/world";

let world: GcsTestWorld;

beforeEach(async () => {
  world = await createWorld([], realRegistry);
});

afterAll(async () => {
  await world.db.$disconnect();
  world.redis.disconnect();
});

describe("modulele Profil, Mesaje și VIP", () => {
  test("se înregistrează lângă core și forum, fără chei duplicate", () => {
    expect(world.registry.all().map((m) => m.key)).toEqual(["core", "forums", "profile", "messages", "vip", "chat"]);
    expect(world.registry.permissionDef("pm.max_participants")).toMatchObject({ merge: "max" });
    expect(world.registry.acpMenu().some((s) => s.app === "vip")).toBe(true);
  });

  test("seed-ul creează rangurile, badge-urile, regulile, câmpurile, ramele și stilurile implicite", async () => {
    const { db } = world;
    const ranks = await db.rank.findMany({ orderBy: { position: "asc" } });
    expect(ranks.map((r) => [r.name, r.minPosts])).toEqual([
      ["Recrut", 0],
      ["Jucător", 10],
      ["Activ", 50],
      ["Veteran", 250],
      ["Elită", 1000],
      ["Legendă", 3000],
    ]);
    expect(await db.badge.count()).toBe(10);
    expect(await db.badge.count({ where: { manual: true } })).toBe(2);
    // Insignele implicite (specul 2026-10-07-insigne-grafice, §8.1).
    expect(await db.badge.findUniqueOrThrow({ where: { key: "vip" } })).toMatchObject({ artShape: "diamond", artTier: "platinum", artIcon: "fa-solid fa-gem" });
    expect(await db.badge.count({ where: { artShape: null } })).toBe(0);
    expect(await db.achievementRule.count({ where: { badgeId: { not: null } } })).toBe(8);
    expect(await db.achievementRule.count({ where: { trigger: { in: ["EACH_POST", "EACH_REACTION_RECEIVED", "EACH_SOLUTION"] } } })).toBe(3);
    expect((await db.profileField.findMany({ orderBy: { position: "asc" } })).map((f) => f.key)).toEqual(["country", "platform", "twitch"]);
    expect((await db.avatarFrame.findMany({ orderBy: { position: "asc" } })).map((f) => f.key)).toEqual(["fire", "gold", "neon"]);
    expect(await db.nameStyle.count()).toBe(3);
  });

  test("rama Neon e disponibilă doar pentru VIP Legend și admini; Fire pentru toate nivelurile VIP", async () => {
    const g = world.groups;
    const neon = await world.db.avatarFrame.findUniqueOrThrow({ where: { key: "neon" } });
    expect([...neon.groupIds].sort()).toEqual([g.vip_legend!, g.root_admin!, g.admin!].sort());
    const fire = await world.db.avatarFrame.findUniqueOrThrow({ where: { key: "fire" } });
    expect(fire.groupIds).toEqual(expect.arrayContaining([g.vip_bronze!, g.vip_silver!, g.vip_gold!, g.vip_legend!]));
    expect(fire.groupIds).not.toContain(g.member!);
  });

  test("staff-ul afișează „Staff” în locul rangului; membrii nu au înlocuire", async () => {
    const value = async (group: string) =>
      (await world.db.groupSetting.findFirst({ where: { groupId: world.groups[group]!, key: "profile.rank_override" } }))?.value;
    expect(await value("moderator")).toBe("Staff");
    expect(await value("member")).toBeUndefined();
  });

  test("seed-ul rulat din nou nu dublează nimic și nu suprascrie modificările din ACP", async () => {
    const { db } = world;
    await db.achievementRule.update({ where: { key: "posts_100" }, data: { threshold: 150 } });
    await db.rank.deleteMany({ where: { name: "Elită" } });
    await db.avatarFrame.update({ where: { key: "fire" }, data: { name: "Foc" } });

    await seedDefaults(db, world.registry);
    await seedDefaults(db, world.registry);

    expect(await db.badge.count()).toBe(10);
    expect(await db.achievementRule.count()).toBe(11);
    expect((await db.achievementRule.findUniqueOrThrow({ where: { key: "posts_100" } })).threshold).toBe(150);
    expect(await db.rank.count()).toBe(5);
    expect((await db.avatarFrame.findUniqueOrThrow({ where: { key: "fire" } })).name).toBe("Foc");
  });
});
