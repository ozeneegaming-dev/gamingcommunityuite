import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testRedis } from "../../test/redis";
import { GcsCache } from "../cache";
import { GcsEventBus } from "../events";
import { GcsModuleRegistry, type GcsMemberGrant } from "../modules/registry";
import { GcsPermissionService } from "./service";
import type { GcsActor } from "./types";

const db = testDb();
const redis = testRedis();
const cache = new GcsCache(redis);

const clanForum = { type: "forum", id: "7" };
const publicForum = { type: "forum", id: "1" };

/** Drepturile date de modulul de test (ca un clan cu forum privat), pe membru; `calls` numără calculele. */
let grants: Map<string, GcsMemberGrant[]>;
let calls: number;
let g: Record<"member" | "banned" | "root_admin" | "guest", number>;
let perms: GcsPermissionService;

function actor(groupIds: number[], extra: Partial<GcsActor> = {}): GcsActor {
  return { userId: "u1", groupIds, primaryGroupId: groupIds[0] ?? 0, isBanned: false, ip: "127.0.0.1", ...extra };
}

const FORUM_ACTIONS = ["forums.view", "forums.read", "forums.reply"];

beforeEach(async () => {
  await truncateAll(db);
  await redis.flushdb();
  const make = (key: string) => db.group.create({ data: { key, name: key } }).then((r) => r.id);
  g = { member: await make("member"), banned: await make("banned"), root_admin: await make("root_admin"), guest: await make("guest") };
  grants = new Map();
  calls = 0;
  const registry = new GcsModuleRegistry();
  registry.register({
    key: "grants",
    settings: [],
    acpMenu: [],
    eventListeners: [],
    permissions: [
      { key: "forums.view", scope: "container", containerType: "forum", labelKey: "p", default: {} },
      { key: "forums.read", scope: "container", containerType: "forum", labelKey: "p", default: {} },
      { key: "forums.reply", scope: "container", containerType: "forum", labelKey: "p", default: {} },
    ],
    memberGrants: async (_ctx, userId) => {
      calls++;
      return grants.get(userId) ?? [];
    },
  });
  perms = new GcsPermissionService({ db, cache, bus: new GcsEventBus({ cache }), registry });
});

afterAll(async () => {
  await db.$disconnect();
  redis.disconnect();
});

describe("drepturile date membrilor (forumul privat al unui clan)", () => {
  test("membrul primește acțiunile pe container, peste grupuri; ceilalți și vizitatorii nu", async () => {
    grants.set("u1", [{ ...clanForum, actions: FORUM_ACTIONS, powers: [] }]);
    await expect(perms.can(actor([g.member]), "forums.read", clanForum)).resolves.toBe(true);
    await expect(perms.can(actor([g.member]), "forums.read", publicForum)).resolves.toBe(false);
    await expect(perms.can(actor([g.member], { userId: "u2" }), "forums.read", clanForum)).resolves.toBe(false);
    await expect(perms.can(actor([g.guest], { userId: null }), "forums.read", clanForum)).resolves.toBe(false);
    // O acțiune nedată (ex. crearea de topicuri) rămâne refuzată.
    await db.containerPermission.create({ data: { containerType: "forum", containerId: "7", groupId: g.root_admin, action: "forums.view" } });
    await expect(perms.can(actor([g.member]), "forums.create", clanForum)).resolves.toBe(false);
  });

  test("bannul anulează și drepturile date membrului; root_admin le are oricum", async () => {
    grants.set("u1", [{ ...clanForum, actions: FORUM_ACTIONS, powers: ["hide"] }]);
    await expect(perms.can(actor([g.member], { isBanned: true }), "forums.read", clanForum)).resolves.toBe(false);
    await expect(perms.can(actor([g.member, g.banned]), "forums.read", clanForum)).resolves.toBe(false);
    await expect(perms.moderatorPowers(actor([g.member], { isBanned: true }), clanForum)).resolves.toEqual([]);
    await expect(perms.can(actor([g.root_admin], { userId: "u9" }), "forums.read", clanForum)).resolves.toBe(true);
  });

  test("filterContainers și moderatorPowers folosesc aceleași drepturi; un subforum care moștenește le primește", async () => {
    grants.set("u1", [{ ...clanForum, actions: FORUM_ACTIONS, powers: ["hide", "pin"] }]);
    await db.containerInherit.create({ data: { containerType: "forum", containerId: "8", parentId: "7", inherits: true } });
    const refs = ["1", "7", "8"].map((id) => ({ type: "forum", id }));
    await expect(perms.filterContainers(actor([g.member]), "forums.read", refs)).resolves.toEqual(new Set(["7", "8"]));
    await expect(perms.filterContainers(actor([g.member], { userId: "u2" }), "forums.read", refs)).resolves.toEqual(new Set());
    await expect(perms.moderatorPowers(actor([g.member]), clanForum)).resolves.toEqual(["hide", "pin"]);
    await expect(perms.moderatorPowers(actor([g.member]), { type: "forum", id: "8" })).resolves.toEqual(["hide", "pin"]);
    await expect(perms.canModerate(actor([g.member]), "delete", clanForum)).resolves.toBe(false);
  });

  test("rezultatul e cache-uit pe membru; invalidarea îl recalculează imediat (un membru scos pierde accesul)", async () => {
    grants.set("u1", [{ ...clanForum, actions: FORUM_ACTIONS, powers: [] }]);
    await expect(perms.can(actor([g.member]), "forums.read", clanForum)).resolves.toBe(true);
    await expect(perms.can(actor([g.member]), "forums.view", clanForum)).resolves.toBe(true);
    expect(calls).toBe(1);

    grants.delete("u1");
    // Fără invalidare, valoarea din cache rămâne (cache-ul nu citește din nou).
    await expect(perms.can(actor([g.member]), "forums.read", clanForum)).resolves.toBe(true);
    await perms.invalidateMemberGrants(["u1"]);
    await expect(perms.can(actor([g.member]), "forums.read", clanForum)).resolves.toBe(false);
    expect(calls).toBe(2);
  });

  test("o valoare veche scrisă după invalidare (request început înainte de schimbare) nu mai e citită", async () => {
    grants.set("u1", [{ ...clanForum, actions: FORUM_ACTIONS, powers: [] }]);
    await expect(perms.can(actor([g.member]), "forums.read", clanForum)).resolves.toBe(true);
    const version = await perms.currentVersion();
    const stale = await redis.keys(`gcs:k:perm:${version}:grants:u1:*`);
    expect(stale).toHaveLength(1);
    await perms.invalidateMemberGrants(["u1"]);
    grants.delete("u1");
    // Requestul vechi își scrie rezultatul sub cheia generației vechi: nu mai contează.
    await cache.set(stale[0]!.replace("gcs:k:", ""), { actions: ["forum:7:forums.read"], powers: {} }, { ttlSec: 60, tags: [] });
    await expect(perms.can(actor([g.member]), "forums.read", clanForum)).resolves.toBe(false);
  });
});
