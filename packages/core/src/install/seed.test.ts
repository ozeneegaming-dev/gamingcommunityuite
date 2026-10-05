import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testRegistry } from "../../test/fixtures";
import { seedDefaults } from "./seed";

const db = testDb();
const registry = testRegistry();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("seedDefaults", () => {
  test("rulat de două ori produce tot 12 grupuri și nu dublează nimic", async () => {
    await seedDefaults(db, registry);
    await seedDefaults(db, registry);

    expect(await db.group.count()).toBe(12);
    expect(await db.acpRole.count()).toBe(1);
    expect(await db.acpRoleAssignment.count()).toBe(1);
    expect(await db.warningAction.count()).toBe(3);
    expect(await db.systemState.count()).toBe(1);
  });

  test("nu suprascrie modificările făcute din ACP", async () => {
    await seedDefaults(db, registry);
    await db.group.update({ where: { key: "member" }, data: { name: "Jucător" } });
    const member = await db.group.findUniqueOrThrow({ where: { key: "member" } });
    await db.groupSetting.update({
      where: { groupId_key: { groupId: member.id, key: "upload.max_mb" } },
      data: { value: 25 },
    });

    await seedDefaults(db, registry);

    expect((await db.group.findUniqueOrThrow({ where: { key: "member" } })).name).toBe("Jucător");
    const setting = await db.groupSetting.findUniqueOrThrow({
      where: { groupId_key: { groupId: member.id, key: "upload.max_mb" } },
    });
    expect(setting.value).toBe(25);
  });

  test("grupurile implicite sunt protejate, VIP-urile sunt marcate isVip", async () => {
    await seedDefaults(db, registry);
    const groups = await db.group.findMany();
    const byKey = new Map(groups.map((g) => [g.key, g]));
    for (const key of ["root_admin", "admin", "super_moderator", "moderator", "member", "new_member", "banned", "guest"]) {
      expect(byKey.get(key)?.isProtected, key).toBe(true);
    }
    for (const key of ["vip_bronze", "vip_silver", "vip_gold", "vip_legend"]) {
      expect(byKey.get(key)?.isVip, key).toBe(true);
      expect(byKey.get(key)?.isProtected, key).toBe(false);
    }
    expect(byKey.get("admin")?.color).toBe("#FF4D57");
    expect(byKey.get("vip_gold")?.nameStyle).toMatchObject({
      gradient: ["#F4B740", "#FFF0B8", "#E8961C"],
      animated: true,
    });
  });

  test("setările de grup implicite vin din permisiunile modulelor", async () => {
    await seedDefaults(db, registry);
    const admin = await db.group.findUniqueOrThrow({ where: { key: "admin" }, include: { settings: true } });
    const values = Object.fromEntries(admin.settings.map((s) => [s.key, s.value]));
    expect(values).toMatchObject({ "acp.access": true, "upload.max_mb": -1, "core.view_public": true });
  });

  test("rolul ACP Root are toate secțiunile și e atribuit grupului root_admin", async () => {
    await seedDefaults(db, registry);
    const role = await db.acpRole.findUniqueOrThrow({
      where: { name: "Root" },
      include: { permissions: true, assignments: { include: { group: true } } },
    });
    expect(role.permissions.map((p) => p.section).sort()).toEqual(["members.groups", "members.members", "members.warnings", "vip.tiers"]);
    expect(role.permissions.every((p) => p.canView && p.canEdit && p.canDelete)).toBe(true);
    expect(role.assignments[0]?.group?.key).toBe("root_admin");
  });

  test("pragurile de avertisment 3, 5, 10", async () => {
    await seedDefaults(db, registry);
    const actions = await db.warningAction.findMany({ orderBy: { threshold: "asc" } });
    expect(actions.map((a) => [a.threshold, a.action, a.durationHours])).toEqual([
      [3, "MODERATE_POSTS", 72],
      [5, "RESTRICT", 168],
      [10, "BAN", null],
    ]);
  });
});
