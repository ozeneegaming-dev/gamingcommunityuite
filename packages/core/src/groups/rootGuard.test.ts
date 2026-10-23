import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsConflict, GcsForbidden } from "../errors";

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld();
  // Adminul are drepturi ACP complete pe membri, grupuri și avertismente: doar garda îl poate opri.
  await w.grantAdmin(["members.members", "members.groups", "members.warnings"]);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function conflictCode(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GcsConflict);
  return (error as GcsConflict).params?.reason;
}

describe("protecția Root Admin (Review Focus #4)", () => {
  test("un Admin încearcă setPrimary(rootUser, member) → GcsForbidden", async () => {
    const rootUser = await w.createUser("Root", "root_admin");
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    await expect(w.groupService.setPrimary(rootUser.id, w.groups.member!, admin)).rejects.toBeInstanceOf(GcsForbidden);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: rootUser.id } })).primaryGroupId).toBe(w.groups.root_admin);
  });

  test("Adminul poate gestiona un membru obișnuit", async () => {
    const member = await w.createUser("Membru", "member");
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    await expect(w.groupService.setPrimary(member.id, w.groups.vip_gold!, admin)).resolves.toBeUndefined();
  });

  test("singurul Root Admin se retrogradează singur → GcsConflict last_root", async () => {
    const rootUser = await w.createUser("Root", "root_admin");
    const root = await w.actorFor(rootUser);
    expect(await conflictCode(w.groupService.setPrimary(rootUser.id, w.groups.member!, root))).toBe("last_root");
  });

  test("cu doi Root Admini, unul îl poate retrograda pe celălalt", async () => {
    const first = await w.createUser("Root1", "root_admin");
    const second = await w.createUser("Root2", "root_admin");
    const root = await w.actorFor(first);
    await expect(w.groupService.setPrimary(second.id, w.groups.admin!, root)).resolves.toBeUndefined();
    // Acum a rămas unul singur.
    expect(await conflictCode(w.groupService.setPrimary(first.id, w.groups.admin!, root))).toBe("last_root");
  });

  test("Root ca grup secundar: scoaterea lui pe ultimul root → last_root", async () => {
    const rootUser = await w.createUser("Root", "admin", ["root_admin"]);
    const root = await w.actorFor(rootUser);
    expect(await conflictCode(w.groupService.removeSecondary(rootUser.id, w.groups.root_admin!, root))).toBe("last_root");
  });

  test("un Admin nu își poate da singur grupul root_admin și nu poate edita grupul Root", async () => {
    await w.createUser("Root", "root_admin");
    const adminUser = await w.createUser("Admin", "admin");
    const admin = await w.actorFor(adminUser);
    await expect(w.groupService.addSecondary(adminUser.id, w.groups.root_admin!, admin)).rejects.toBeInstanceOf(
      GcsForbidden,
    );
    await expect(w.groupService.setPrimary(adminUser.id, w.groups.root_admin!, admin)).rejects.toBeInstanceOf(
      GcsForbidden,
    );
    await expect(w.groupService.update(w.groups.root_admin!, { name: "Eu" }, admin)).rejects.toBeInstanceOf(
      GcsForbidden,
    );
    await expect(
      w.groupService.setSetting(w.groups.root_admin!, "upload.max_mb", 1, admin),
    ).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("un Admin încearcă ban pe un Root Admin → GcsForbidden", async () => {
    const rootUser = await w.createUser("Root", "root_admin");
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    await expect(
      w.bans.ban({ type: "ACCOUNT", value: rootUser.id, userId: rootUser.id, reason: "x" }, admin),
    ).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.bans.activeFor({ userId: rootUser.id })).resolves.toBeNull();
  });

  test("un Admin încearcă un avertisment pe un Root Admin → GcsForbidden", async () => {
    const rootUser = await w.createUser("Root", "root_admin");
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    await expect(w.warnings.warn({ userId: rootUser.id, points: 1, reason: "x" }, admin)).rejects.toBeInstanceOf(
      GcsForbidden,
    );
  });

  test("ultimul Root Admin nu poate fi banat, nici de el însuși", async () => {
    const rootUser = await w.createUser("Root", "root_admin");
    const root = await w.actorFor(rootUser);
    expect(
      await conflictCode(w.bans.ban({ type: "ACCOUNT", value: rootUser.id, userId: rootUser.id, reason: "x" }, root)),
    ).toBe("last_root");
  });
});
