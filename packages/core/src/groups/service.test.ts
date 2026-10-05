import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testRegistry } from "../../test/fixtures";
import { testRedis } from "../../test/redis";
import { GcsAcpRoleService } from "../acp/roles";
import { GcsCache } from "../cache";
import { GcsConflict, GcsForbidden, GcsValidationError } from "../errors";
import { GcsEventBus, type GcsEvent } from "../events";
import { seedDefaults } from "../install/seed";
import { GcsPermissionService } from "../permissions/service";
import type { GcsActor } from "../permissions/types";
import { GcsGroupService } from "./service";

const db = testDb();
const redis = testRedis();
const cache = new GcsCache(redis);
const registry = testRegistry();

let groups: Record<string, number>;
let events: GcsEvent[];
let service: GcsGroupService;
let permissions: GcsPermissionService;
let root: GcsActor;
let member: GcsActor;

beforeEach(async () => {
  await truncateAll(db);
  await redis.flushdb();
  await seedDefaults(db, registry);
  groups = Object.fromEntries((await db.group.findMany()).map((g) => [g.key, g.id]));

  events = [];
  const bus = new GcsEventBus({ cache });
  bus.on("group.updated", async (e) => {
    events.push(e);
  });
  permissions = new GcsPermissionService({ db, cache, bus, registry });
  const acp = new GcsAcpRoleService({ db, registry });
  service = new GcsGroupService({ db, bus, permissions, acp });

  const rootGroup = groups.root_admin!;
  const memberGroup = groups.member!;
  root = { userId: "root", groupIds: [rootGroup], primaryGroupId: rootGroup, isBanned: false, ip: "10.0.0.1" };
  member = { userId: "m", groupIds: [memberGroup], primaryGroupId: memberGroup, isBanned: false, ip: "10.0.0.2" };
});

afterAll(async () => {
  await db.$disconnect();
  redis.disconnect();
});

async function createUser(name: string, primaryGroupId: number) {
  return db.user.create({
    data: { name, nameNormalized: name.toLowerCase(), email: `${name.toLowerCase()}@example.com`, primaryGroupId },
  });
}

describe("GcsGroupService", () => {
  test("create dă cheia custom_<id>, scrie audit și emite group.updated", async () => {
    const group = await service.create({ name: "Clan Alpha", color: "#22D3EE" }, root);
    expect(group.key).toBe(`custom_${group.id}`);
    expect(group.isProtected).toBe(false);

    const log = await db.auditLog.findFirstOrThrow({ where: { action: "group.create" } });
    expect(log).toMatchObject({ actorId: "root", targetType: "group", targetId: String(group.id) });
    expect(events[0]?.tags).toEqual(expect.arrayContaining([`group:${group.id}`, "name-styles"]));
  });

  test("un grup nou pornește cu setările și permisiunile pe container ale grupului „member”", async () => {
    await service.setContainerPermissions("forum", "1", { [groups.member!]: ["forums.view"] }, root);
    const group = await service.create({ name: "Clan Beta" }, root);
    const actor = { ...member, groupIds: [group.id], primaryGroupId: group.id };

    await expect(permissions.can(actor, "core.view_public")).resolves.toBe(true);
    await expect(permissions.groupValue(actor, "upload.max_mb")).resolves.toBe(10);
    await expect(permissions.can(actor, "forums.view", { type: "forum", id: "1" })).resolves.toBe(true);
  });

  test("update salvează valorile înainte/după în audit", async () => {
    await service.update(groups.member!, { color: "#22D3EE" }, root);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "group.update" } });
    expect(log.before).toMatchObject({ color: "#ECEDF1" });
    expect(log.after).toMatchObject({ color: "#22D3EE" });
  });

  test("o culoare invalidă → GcsValidationError", async () => {
    await expect(service.update(groups.member!, { color: "red;}" }, root)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("delete pe grupul member aruncă GcsConflict", async () => {
    await expect(service.delete(groups.member!, root)).rejects.toBeInstanceOf(GcsConflict);
    expect(await db.group.count({ where: { key: "member" } })).toBe(1);
  });

  test("delete pe un grup custom îi mută membrii principali în member", async () => {
    const custom = await service.create({ name: "Temporar" }, root);
    const user = await createUser("Vlad", custom.id);
    await service.delete(custom.id, root);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).primaryGroupId).toBe(groups.member);
    expect(await db.group.count({ where: { id: custom.id } })).toBe(0);
  });

  test("setPrimary păstrează grupul vechi în previousPrimaryGroupId", async () => {
    const user = await createUser("Ana", groups.member!);
    await service.setPrimary(user.id, groups.vip_gold!, root);
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.primaryGroupId).toBe(groups.vip_gold);
    expect(updated.previousPrimaryGroupId).toBe(groups.member);
  });

  test("addSecondary / removeSecondary", async () => {
    const user = await createUser("Dan", groups.member!);
    await service.addSecondary(user.id, groups.vip_silver!, root);
    await service.addSecondary(user.id, groups.vip_silver!, root); // idempotent
    expect(await db.userGroup.count({ where: { userId: user.id } })).toBe(1);
    await service.removeSecondary(user.id, groups.vip_silver!, root);
    expect(await db.userGroup.count({ where: { userId: user.id } })).toBe(0);
  });

  test("setSetting schimbă valoarea și invalidează imediat cache-ul de permisiuni", async () => {
    await expect(permissions.groupValue(member, "upload.max_mb")).resolves.toBe(10);
    await service.setSetting(groups.member!, "upload.max_mb", 30, root);
    await expect(permissions.groupValue(member, "upload.max_mb")).resolves.toBe(30);
  });

  test("setSetting cu o cheie necunoscută sau un tip greșit → GcsValidationError", async () => {
    await expect(service.setSetting(groups.member!, "nu.exista", true, root)).rejects.toBeInstanceOf(
      GcsValidationError,
    );
    await expect(service.setSetting(groups.member!, "upload.max_mb", "30", root)).rejects.toBeInstanceOf(
      GcsValidationError,
    );
  });

  test("setContainerPermissions înlocuiește matricea containerului", async () => {
    const forum = { type: "forum", id: "1" };
    await service.setContainerPermissions("forum", "1", { [groups.member!]: ["forums.view"] }, root);
    await expect(permissions.can(member, "forums.view", forum)).resolves.toBe(true);

    await service.setContainerPermissions("forum", "1", { [groups.guest!]: ["forums.view"] }, root);
    await expect(permissions.can(member, "forums.view", forum)).resolves.toBe(false);
    expect(await db.containerPermission.count()).toBe(1);
  });

  test("un actor fără drept → GcsForbidden, fără nicio scriere", async () => {
    await expect(service.create({ name: "X" }, member)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(service.update(groups.member!, { name: "Y" }, member)).rejects.toBeInstanceOf(GcsForbidden);
    const user = await createUser("Ion", groups.member!);
    await expect(service.setPrimary(user.id, groups.admin!, member)).rejects.toBeInstanceOf(GcsForbidden);
    expect(await db.auditLog.count()).toBe(0);
  });
});
