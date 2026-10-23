import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testKv } from "../../test/kv";
import { GcsCache } from "../cache";
import { GcsForbidden } from "../errors";
import { GcsEventBus, type GcsEvent } from "../events";
import { GcsModuleRegistry } from "../modules/registry";
import { GcsPermissionService } from "./service";
import type { GcsActor } from "./types";

const db = testDb();
const kv = testKv();
const cache = new GcsCache(kv);

const forum1 = { type: "forum", id: "1" };
const forum2 = { type: "forum", id: "2" };

let g: Record<"member" | "vip_gold" | "banned" | "root_admin" | "guest" | "unlimited", number>;
let events: GcsEvent[];
let perms: GcsPermissionService;

function actor(groupIds: number[], extra: Partial<GcsActor> = {}): GcsActor {
  return { userId: "u1", groupIds, primaryGroupId: groupIds[0] ?? 0, isBanned: false, ip: "127.0.0.1", ...extra };
}

beforeEach(async () => {
  await truncateAll(db);
  await kv.flushAll();

  const make = (key: string) => db.group.create({ data: { key, name: key } }).then((r) => r.id);
  g = {
    member: await make("member"),
    vip_gold: await make("vip_gold"),
    banned: await make("banned"),
    root_admin: await make("root_admin"),
    guest: await make("guest"),
    unlimited: await make("custom_1"),
  };

  const registry = new GcsModuleRegistry();
  registry.register({
    key: "test",
    settings: [],
    acpMenu: [],
    eventListeners: [],
    permissions: [
      { key: "core.view_public", scope: "group", labelKey: "p", default: { member: true, guest: true, banned: true } },
      { key: "forums.view", scope: "container", containerType: "forum", labelKey: "p", default: {} },
      { key: "profile.styled_name", scope: "group", labelKey: "p", default: {} },
      { key: "upload.max_mb", scope: "group", labelKey: "p", default: { member: 10 } },
      { key: "pm.flood_seconds", scope: "group", labelKey: "p", default: { member: 30 }, merge: "min" },
    ],
  });
  events = [];
  const bus = new GcsEventBus({ cache });
  bus.on("permissions.updated", async (e) => {
    events.push(e);
  });
  perms = new GcsPermissionService({ db, cache, bus, registry });
});

afterAll(async () => {
  await db.$disconnect();
  kv.disconnect();
});

const allow = (groupId: number, container: { type: string; id: string }, action: string) =>
  db.containerPermission.create({
    data: { containerType: container.type, containerId: container.id, groupId, action },
  });

describe("GcsPermissionService.can", () => {
  test("member cu forums.view pe forum:1 → true; vizitatorul fără rând → false", async () => {
    await allow(g.member, forum1, "forums.view");
    await expect(perms.can(actor([g.member]), "forums.view", forum1)).resolves.toBe(true);
    await expect(perms.can(actor([g.guest], { userId: null }), "forums.view", forum1)).resolves.toBe(false);
    await expect(perms.can(actor([g.member]), "forums.view", forum2)).resolves.toBe(false);
  });

  test("uniune permisivă: doar vip_gold are profile.styled_name → true pentru member + vip_gold", async () => {
    await db.groupSetting.create({ data: { groupId: g.vip_gold, key: "profile.styled_name", value: true } });
    await expect(perms.can(actor([g.member, g.vip_gold]), "profile.styled_name")).resolves.toBe(true);
    await expect(perms.can(actor([g.member]), "profile.styled_name")).resolves.toBe(false);
  });

  test("isBanned → false pentru forums.view, true pentru core.view_public", async () => {
    await allow(g.member, forum1, "forums.view");
    const banned = actor([g.member], { isBanned: true });
    await expect(perms.can(banned, "forums.view", forum1)).resolves.toBe(false);
    await expect(perms.can(banned, "core.view_public")).resolves.toBe(true);
  });

  test("un user în grupul banned e tratat ca banat", async () => {
    await allow(g.member, forum1, "forums.view");
    await expect(perms.can(actor([g.member, g.banned]), "forums.view", forum1)).resolves.toBe(false);
    await expect(perms.can(actor([g.banned]), "core.view_public")).resolves.toBe(true);
  });

  test("forum:2 moștenește de la forum:1 → aceleași rezultate", async () => {
    await allow(g.member, forum1, "forums.view");
    await db.containerInherit.create({
      data: { containerType: "forum", containerId: "2", parentId: "1", inherits: true },
    });
    await expect(perms.can(actor([g.member]), "forums.view", forum2)).resolves.toBe(true);
    await expect(perms.can(actor([g.guest]), "forums.view", forum2)).resolves.toBe(false);
  });

  test("un container cu inherits=false își folosește propriile permisiuni", async () => {
    await allow(g.member, forum1, "forums.view");
    await db.containerInherit.create({
      data: { containerType: "forum", containerId: "2", parentId: "1", inherits: false },
    });
    await expect(perms.can(actor([g.member]), "forums.view", forum2)).resolves.toBe(false);
  });

  test("un ciclu de moștenire → false, fără buclă infinită", async () => {
    await allow(g.member, forum1, "forums.view");
    await db.containerInherit.createMany({
      data: [
        { containerType: "forum", containerId: "3", parentId: "4", inherits: true },
        { containerType: "forum", containerId: "4", parentId: "3", inherits: true },
      ],
    });
    await expect(perms.can(actor([g.member]), "forums.view", { type: "forum", id: "3" })).resolves.toBe(false);
  });

  test("root_admin → true pentru o cheie inexistentă de tip container", async () => {
    await expect(perms.can(actor([g.root_admin]), "nu.exista", { type: "album", id: "9" })).resolves.toBe(true);
    await expect(perms.can(actor([g.root_admin]), "profile.styled_name")).resolves.toBe(true);
  });

  test("Review Focus #2: după ștergerea permisiunii și bumpVersion, următorul can e refuzat", async () => {
    const row = await allow(g.member, forum1, "forums.view");
    await expect(perms.can(actor([g.member]), "forums.view", forum1)).resolves.toBe(true); // intră în cache

    await db.containerPermission.delete({ where: { id: row.id } });
    await perms.bumpVersion();

    await expect(perms.can(actor([g.member]), "forums.view", forum1)).resolves.toBe(false);
    expect(events.map((e) => e.name)).toEqual(["permissions.updated"]);
    const state = await db.systemState.findUnique({ where: { id: 1 } });
    expect(state?.permVersion).toBe(1);
  });
});

describe("GcsPermissionService.assert", () => {
  test("aruncă GcsForbidden când can e false", async () => {
    await expect(perms.assert(actor([g.guest]), "forums.view", forum1)).rejects.toBeInstanceOf(GcsForbidden);
    await allow(g.guest, forum1, "forums.view");
    await perms.bumpVersion();
    await expect(perms.assert(actor([g.guest]), "forums.view", forum1)).resolves.toBeUndefined();
  });
});

describe("GcsPermissionService.groupValue", () => {
  test("upload.max_mb: member 10, vip_gold 50 → 50; un grup cu -1 → -1", async () => {
    await db.groupSetting.create({ data: { groupId: g.vip_gold, key: "upload.max_mb", value: 50 } });
    await db.groupSetting.create({ data: { groupId: g.unlimited, key: "upload.max_mb", value: -1 } });
    await expect(perms.groupValue(actor([g.member]), "upload.max_mb")).resolves.toBe(10);
    await expect(perms.groupValue(actor([g.member, g.vip_gold]), "upload.max_mb")).resolves.toBe(50);
    await expect(perms.groupValue(actor([g.member, g.vip_gold, g.unlimited]), "upload.max_mb")).resolves.toBe(-1);
  });

  test("un rând din group_settings înlocuiește valoarea implicită a grupului", async () => {
    await db.groupSetting.create({ data: { groupId: g.member, key: "upload.max_mb", value: 3 } });
    await expect(perms.groupValue(actor([g.member]), "upload.max_mb")).resolves.toBe(3);
  });

  test("merge: min → câștigă valoarea cea mai mică", async () => {
    await db.groupSetting.create({ data: { groupId: g.vip_gold, key: "pm.flood_seconds", value: 5 } });
    await expect(perms.groupValue(actor([g.member, g.vip_gold]), "pm.flood_seconds")).resolves.toBe(5);
  });
});

describe("GcsPermissionService.canModerate", () => {
  test("moderator pe container, ca user sau prin grup, doar cu puterea dată", async () => {
    await db.user.create({
      data: { id: "u1", name: "Mod", nameNormalized: "mod", email: "mod@example.com", primaryGroupId: g.member },
    });
    await db.moderator.create({
      data: { containerType: "forum", containerId: "1", userId: "u1", powers: ["edit", "pin"] },
    });
    await db.moderator.create({
      data: { containerType: "forum", containerId: "2", groupId: g.vip_gold, powers: ["hide"] },
    });

    await expect(perms.canModerate(actor([g.member]), "pin", forum1)).resolves.toBe(true);
    await expect(perms.canModerate(actor([g.member]), "delete", forum1)).resolves.toBe(false);
    await expect(perms.canModerate(actor([g.member]), "pin", forum2)).resolves.toBe(false);
    await expect(perms.canModerate(actor([g.vip_gold], { userId: "u2" }), "hide", forum2)).resolves.toBe(true);
    await expect(perms.canModerate(actor([g.root_admin], { userId: "u3" }), "delete", forum2)).resolves.toBe(true);
    await expect(perms.canModerate(actor([g.member], { isBanned: true }), "pin", forum1)).resolves.toBe(false);
  });
});

describe("GcsPermissionService.filterContainers / moderatorPowers", () => {
  test("filterContainers dă aceleași rezultate ca `can` pe fiecare container (cu moștenire și ban)", async () => {
    await db.containerPermission.create({ data: { containerType: "forum", containerId: "1", groupId: g.member, action: "forums.view" } });
    await db.containerInherit.create({ data: { containerType: "forum", containerId: "2", parentId: "1", inherits: true } });
    const refs = ["1", "2", "3"].map((id) => ({ type: "forum", id }));

    await expect(perms.filterContainers(actor([g.member]), "forums.view", refs)).resolves.toEqual(new Set(["1", "2"]));
    await expect(perms.filterContainers(actor([g.guest]), "forums.view", refs)).resolves.toEqual(new Set());
    await expect(perms.filterContainers(actor([g.member], { isBanned: true }), "forums.view", refs)).resolves.toEqual(new Set());
    await expect(perms.filterContainers(actor([g.root_admin]), "forums.view", refs)).resolves.toEqual(new Set(["1", "2", "3"]));
  });

  test("moderatorPowers întoarce puterile actorului pe container; root_admin le are pe toate", async () => {
    await db.user.create({ data: { id: "u1", name: "Mod", nameNormalized: "mod", email: "mod@example.com", primaryGroupId: g.member } });
    await db.moderator.create({ data: { containerType: "forum", containerId: "1", userId: "u1", powers: ["edit", "pin"] } });
    await db.moderator.create({ data: { containerType: "forum", containerId: "1", groupId: g.vip_gold, powers: ["pin", "hide"] } });

    await expect(perms.moderatorPowers(actor([g.member, g.vip_gold]), forum1)).resolves.toEqual(["edit", "hide", "pin"]);
    await expect(perms.moderatorPowers(actor([g.member], { userId: "u2" }), forum1)).resolves.toEqual([]);
    await expect(perms.moderatorPowers(actor([g.root_admin]), forum1)).resolves.toEqual(["*"]);
  });
});
