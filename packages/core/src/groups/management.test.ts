import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsValidationError } from "../errors";

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("ordinea grupurilor și moștenirea pe container", () => {
  test("reorder salvează pozițiile în ordinea dată", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const ids = (await w.db.group.findMany({ orderBy: { position: "asc" } })).map((g) => g.id);
    const reversed = [...ids].reverse();
    await w.groupService.reorder(reversed, root);
    const after = (await w.db.group.findMany({ orderBy: { position: "asc" } })).map((g) => g.id);
    expect(after).toEqual(reversed);
    expect(await w.db.auditLog.count({ where: { action: "group.reorder" } })).toBe(1);
  });

  test("reorder cu o listă incompletă → GcsValidationError", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    await expect(w.groupService.reorder([w.groups.member!], root)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("setContainerInherit face containerul să folosească permisiunile părintelui, imediat", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const member = await w.actorFor(await w.createUser("Membru", "member"));
    await w.groupService.setContainerPermissions("forum", "1", { [w.groups.member!]: ["forums.view"] }, root);
    await expect(w.permissions.can(member, "forums.view", { type: "forum", id: "2" })).resolves.toBe(false);

    await w.groupService.setContainerInherit("forum", "2", { parentId: "1", inherits: true }, root);
    await expect(w.permissions.can(member, "forums.view", { type: "forum", id: "2" })).resolves.toBe(true);

    await w.groupService.setContainerInherit("forum", "2", { parentId: "1", inherits: false }, root);
    await expect(w.permissions.can(member, "forums.view", { type: "forum", id: "2" })).resolves.toBe(false);
  });

  test("un membru nu poate reordona grupuri", async () => {
    const member = await w.actorFor(await w.createUser("Membru", "member"));
    await expect(w.groupService.reorder([], member)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("currentVersion urmărește bumpVersion", async () => {
    const before = await w.permissions.currentVersion();
    await w.permissions.bumpVersion();
    await expect(w.permissions.currentVersion()).resolves.toBe(before + 1);
  });
});
