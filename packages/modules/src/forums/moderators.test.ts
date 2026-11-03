import { GcsForbidden, GcsNotFound, GcsValidationError } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, type GcsForumWorld } from "../../test/world";
import { GcsForumModeratorService } from "./moderators";

let w: GcsForumWorld;
let mods: GcsForumModeratorService;
let tree: Awaited<ReturnType<GcsForumWorld["createTree"]>>;

beforeEach(async () => {
  w = await createForumWorld();
  mods = new GcsForumModeratorService({ db: w.db, permissions: w.permissions, acp: w.acp });
  tree = await w.createTree();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("GcsForumModeratorService", () => {
  test("un user devine moderator pe forumul ales, cu puterile bifate, imediat", async () => {
    const neo = await w.actorFor(await w.createUser("Neo", "moderator"));
    const ref = { type: "forum", id: String(tree.forum.id) };
    await expect(w.permissions.canModerate(neo, "lock", ref)).resolves.toBe(false);

    await mods.add(w.root, { forumIds: [tree.forum.id], userName: "neo", powers: ["lock", "pin"] });
    await expect(w.permissions.canModerate(neo, "lock", ref)).resolves.toBe(true);
    await expect(w.permissions.canModerate(neo, "delete", ref)).resolves.toBe(false);

    const [row] = await mods.list();
    expect(row).toMatchObject({ forumName: "Counter-Strike 2", userName: "Neo", groupName: null, powers: ["lock", "pin"] });
    expect(await w.db.auditLog.count({ where: { action: "moderator.add" } })).toBe(1);

    await mods.remove(w.root, row!.id);
    await expect(w.permissions.canModerate(neo, "lock", ref)).resolves.toBe(false);
  });

  test("un grup poate fi moderator pe mai multe forumuri deodată", async () => {
    const other = await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "Minecraft" }, w.root);
    await mods.add(w.root, { forumIds: [tree.forum.id, other.id], groupId: w.groups.moderator!, powers: ["hide"] });
    expect((await mods.list()).map((r) => [r.forumName, r.groupName])).toEqual([
      ["Counter-Strike 2", "Moderator"],
      ["Minecraft", "Moderator"],
    ]);
  });

  test("editarea schimbă doar puterile, imediat și cu jurnal; puteri goale sau necunoscute → GcsValidationError", async () => {
    const neo = await w.actorFor(await w.createUser("Neo", "moderator"));
    const ref = { type: "forum", id: String(tree.forum.id) };
    await mods.add(w.root, { forumIds: [tree.forum.id], userName: "neo", powers: ["pin"] });
    const [row] = await mods.list();
    await expect(w.permissions.canModerate(neo, "lock", ref)).resolves.toBe(false);

    await mods.update(w.root, row!.id, { powers: ["lock", "approve", "lock"] });
    await expect(w.permissions.canModerate(neo, "lock", ref)).resolves.toBe(true);
    await expect(w.permissions.canModerate(neo, "pin", ref)).resolves.toBe(false);
    expect((await mods.list())[0]).toMatchObject({ id: row!.id, forumId: tree.forum.id, userName: "Neo", powers: ["lock", "approve"] });
    expect(await w.db.auditLog.count({ where: { action: "moderator.update" } })).toBe(1);

    await expect(mods.update(w.root, row!.id, { powers: [] })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(mods.update(w.root, row!.id, { powers: ["root"] })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(mods.update(w.root, row!.id + 999, { powers: ["pin"] })).rejects.toBeInstanceOf(GcsNotFound);
    await expect(mods.update(w.member, row!.id, { powers: ["pin"] })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("validări: putere necunoscută, fără țintă, user inexistent; fără drept ACP → GcsForbidden", async () => {
    await expect(mods.add(w.root, { forumIds: [tree.forum.id], userName: "neo", powers: ["root"] })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(mods.add(w.root, { forumIds: [tree.forum.id], powers: ["pin"] })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(mods.add(w.root, { forumIds: [tree.forum.id], userName: "nimeni", powers: ["pin"] })).rejects.toBeInstanceOf(GcsNotFound);
    await expect(mods.add(w.member, { forumIds: [tree.forum.id], groupId: w.groups.moderator!, powers: ["pin"] })).rejects.toBeInstanceOf(
      GcsForbidden,
    );
  });
});
