import { readFileSync } from "node:fs";
import path from "node:path";
import { GcsConflict, GcsForbidden, GcsValidationError } from "@gcs/core";
import { testOnMysql } from "@gcs/db/test/url";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, type GcsForumWorld } from "../../test/world";

let w: GcsForumWorld;

beforeEach(async () => {
  w = await createForumWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const forumRef = (id: number) => ({ type: "forum", id: String(id) });

/** Un topic minim, scris direct în bază (serviciile de topicuri vin în Task 6). */
async function addTopic(forumId: number, authorId: string) {
  const topic = await w.db.topic.create({ data: { forumId, title: "Salut", slug: "salut", authorId } });
  const post = await w.db.post.create({ data: { topicId: topic.id, authorId, contentJson: {}, contentHtml: "<p>x</p>" } });
  await w.db.topic.update({ where: { id: topic.id }, data: { firstPostId: post.id, lastPostId: post.id } });
  await w.db.forum.update({
    where: { id: forumId },
    data: { topicsCount: { increment: 1 }, postsCount: { increment: 1 }, lastPostId: post.id, lastTopicId: topic.id, lastPostAt: post.createdAt },
  });
  return { topic, post };
}

describe("GcsForumService.create", () => {
  test("creează un arbore categorie → forum → subforum, cu slug și poziții", async () => {
    const { category, forum, subforum } = await w.createTree({ subforum: true });
    expect(category).toMatchObject({ type: "CATEGORY", parentId: null, slug: "servere-de-joc", position: 0 });
    expect(forum).toMatchObject({ parentId: category.id, slug: "counter-strike-2", position: 0 });
    expect(subforum).toMatchObject({ parentId: forum.id });

    const second = await w.forums.create({ parentId: category.id, type: "FORUM", name: "Minecraft" }, w.root);
    expect(second.position).toBe(1);
  });

  test("categoria de la rădăcină primește permisiunile implicite ale modulului", async () => {
    const { category } = await w.createTree();
    await expect(w.permissions.can(w.guest, "forums.read", forumRef(category.id))).resolves.toBe(true);
    await expect(w.permissions.can(w.guest, "forums.reply", forumRef(category.id))).resolves.toBe(false);
    await expect(w.permissions.can(w.member, "forums.reply", forumRef(category.id))).resolves.toBe(true);
  });

  test("un subforum moștenește permisiunile părintelui", async () => {
    const { forum, subforum } = await w.createTree({ subforum: true });
    await expect(w.permissions.can(w.member, "forums.read", forumRef(subforum!.id))).resolves.toBe(true);
    expect(await w.db.containerInherit.findFirst({ where: { containerType: "forum", containerId: String(subforum!.id) } })).toMatchObject({
      parentId: String(forum.id),
      inherits: true,
    });
  });

  test("Review Focus #3: scoaterea `forums.read` pe părinte refuză imediat următorul request pe subforum", async () => {
    const { category, subforum } = await w.createTree({ subforum: true });
    await expect(w.permissions.can(w.member, "forums.read", forumRef(subforum!.id))).resolves.toBe(true); // intră în cache

    const rows = await w.db.containerPermission.findMany({ where: { containerType: "forum", containerId: String(category.id) } });
    const matrix: Record<number, string[]> = {};
    for (const r of rows) (matrix[r.groupId] ??= []).push(r.action);
    matrix[w.groups.member!] = matrix[w.groups.member!]!.filter((a) => a !== "forums.read");
    await w.groupService.setContainerPermissions("forum", String(category.id), matrix, w.root);

    await expect(w.permissions.can(w.member, "forums.read", forumRef(subforum!.id))).resolves.toBe(false);
  });

  test("validări: categoria doar la rădăcină, forumul doar sub un părinte, linkul cere URL http(s), culoare hex", async () => {
    const { category } = await w.createTree();
    await expect(w.forums.create({ parentId: category.id, type: "CATEGORY", name: "X" }, w.root)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.forums.create({ parentId: null, type: "FORUM", name: "X" }, w.root)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.forums.create({ parentId: category.id, type: "LINK", name: "X" }, w.root)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(
      w.forums.create({ parentId: category.id, type: "LINK", name: "X", linkUrl: "javascript:alert(1)" }, w.root),
    ).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.forums.create({ parentId: category.id, type: "FORUM", name: "X", color: "red;}" }, w.root)).rejects.toBeInstanceOf(
      GcsValidationError,
    );
    await expect(w.forums.create({ parentId: category.id, type: "FORUM", name: "  " }, w.root)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.forums.create({ parentId: 9999, type: "FORUM", name: "X" }, w.root)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("scrie audit și emite forum.updated cu tag-ul forums-tree", async () => {
    const tags: string[][] = [];
    w.bus.on("forum.updated", async (e) => {
      tags.push(e.tags);
    });
    const { category } = await w.createTree();
    expect(await w.db.auditLog.count({ where: { action: "forum.create" } })).toBe(2);
    expect(tags[0]).toEqual(expect.arrayContaining(["forums-tree", `forum:${category.id}`]));
  });

  test("un actor fără drept ACP → GcsForbidden, fără nicio scriere", async () => {
    await expect(w.forums.create({ parentId: null, type: "CATEGORY", name: "X" }, w.member)).rejects.toBeInstanceOf(GcsForbidden);
    const admin = await w.actorFor(await w.createUser("Adi", "admin"));
    await expect(w.forums.create({ parentId: null, type: "CATEGORY", name: "X" }, admin)).rejects.toBeInstanceOf(GcsForbidden);
    expect(await w.db.forum.count()).toBe(0);

    await w.grantAdmin(["community.forums"]);
    await expect(w.forums.create({ parentId: null, type: "CATEGORY", name: "X" }, admin)).resolves.toMatchObject({ name: "X" });
  });
});

describe("GcsForumService.update / reorder", () => {
  test("update schimbă numele (și slug-ul), descrierea și aprobarea obligatorie", async () => {
    const { forum } = await w.createTree();
    const updated = await w.forums.update(forum.id, { name: "CS2 — discuții", description: "Configuri", requireApproval: true }, w.root);
    expect(updated).toMatchObject({ name: "CS2 — discuții", slug: "cs2-discutii", description: "Configuri", requireApproval: true });
    expect(await w.db.auditLog.count({ where: { action: "forum.update" } })).toBe(1);
  });

  test("reorder mută un forum în altă categorie; moștenirea urmează noul părinte", async () => {
    const { forum } = await w.createTree();
    const other = await w.forums.create({ parentId: null, type: "CATEGORY", name: "Comunitate" }, w.root);
    await w.forums.reorder([{ id: forum.id, parentId: other.id, position: 0 }], w.root);

    expect((await w.db.forum.findUniqueOrThrow({ where: { id: forum.id } })).parentId).toBe(other.id);
    expect(await w.db.containerInherit.findFirst({ where: { containerType: "forum", containerId: String(forum.id) } })).toMatchObject({
      parentId: String(other.id),
    });
  });

  test("reorder care face un forum copilul propriului copil → GcsValidationError", async () => {
    const { forum, subforum } = await w.createTree({ subforum: true });
    await expect(w.forums.reorder([{ id: forum.id, parentId: subforum!.id, position: 0 }], w.root)).rejects.toBeInstanceOf(
      GcsValidationError,
    );
  });

  test("reorder nu poate muta o categorie sub alt forum", async () => {
    const { category, forum } = await w.createTree();
    await expect(w.forums.reorder([{ id: category.id, parentId: forum.id, position: 0 }], w.root)).rejects.toBeInstanceOf(
      GcsValidationError,
    );
  });
});

describe("GcsForumService.delete", () => {
  test("un forum cu topicuri, fără destinație → GcsConflict", async () => {
    const { forum } = await w.createTree();
    await addTopic(forum.id, w.member.userId!);
    await expect(w.forums.delete(forum.id, {}, w.root)).rejects.toBeInstanceOf(GcsConflict);
  });

  test("cu destinație: topicurile se mută, iar contoarele ambelor forumuri sunt corecte", async () => {
    const { category, forum } = await w.createTree();
    const target = await w.forums.create({ parentId: category.id, type: "FORUM", name: "Arhivă" }, w.root);
    const { topic, post } = await addTopic(forum.id, w.member.userId!);
    await addTopic(forum.id, w.member.userId!);

    await w.forums.delete(forum.id, { moveContentTo: target.id }, w.root);

    expect(await w.db.forum.findUnique({ where: { id: forum.id } })).toBeNull();
    expect((await w.db.topic.findUniqueOrThrow({ where: { id: topic.id } })).forumId).toBe(target.id);
    expect(await w.db.forum.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ topicsCount: 2, postsCount: 2 });
    expect((await w.db.forum.findUniqueOrThrow({ where: { id: target.id } })).lastPostId).toBeGreaterThanOrEqual(post.id);
    expect(await w.db.containerPermission.count({ where: { containerType: "forum", containerId: String(forum.id) } })).toBe(0);
  });

  test("subforumurile urcă la părintele forumului șters; o categorie cu forumuri nu se șterge", async () => {
    const { category, forum, subforum } = await w.createTree({ subforum: true });
    await w.forums.delete(forum.id, {}, w.root);
    expect((await w.db.forum.findUniqueOrThrow({ where: { id: subforum!.id } })).parentId).toBe(category.id);
    await expect(w.permissions.can(w.member, "forums.read", forumRef(subforum!.id))).resolves.toBe(true);

    await expect(w.forums.delete(category.id, {}, w.root)).rejects.toBeInstanceOf(GcsConflict);
  });

  test("destinația nu poate fi forumul însuși, o categorie sau un link", async () => {
    const { category, forum } = await w.createTree();
    await addTopic(forum.id, w.member.userId!);
    await expect(w.forums.delete(forum.id, { moveContentTo: forum.id }, w.root)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.forums.delete(forum.id, { moveContentTo: category.id }, w.root)).rejects.toBeInstanceOf(GcsValidationError);
  });
});

describe("iconițe și coloanele subforumurilor (etapa 5)", () => {
  test("doar iconițe Font Awesome valide; coloanele subforumurilor între 1 și 4 ajung în listă", async () => {
    const category = await w.forums.create({ parentId: null, type: "CATEGORY", name: "Jocuri" }, w.root);
    await expect(w.forums.create({ parentId: category.id, type: "FORUM", name: "X", icon: "megaphone" }, w.root)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.forums.create({ parentId: category.id, type: "FORUM", name: "X", icon: "fa-solid fa-nu-exista" }, w.root)).rejects.toBeInstanceOf(GcsValidationError);
    const forum = await w.forums.create({ parentId: category.id, type: "FORUM", name: "CS2", icon: "fa-solid fa-gamepad", subforumColumns: 3 }, w.root);
    await w.forums.create({ parentId: forum.id, type: "FORUM", name: "Configuri", icon: "fa-solid fa-gear" }, w.root);
    await expect(w.forums.update(forum.id, { subforumColumns: 6 }, w.root)).rejects.toBeInstanceOf(GcsValidationError);

    const index = await w.queries.index(w.root);
    const row = index.find((c) => c.id === category.id)!.forums[0]!;
    expect(row).toMatchObject({ icon: "fa-solid fa-gamepad", subforumColumns: 3, subforums: [{ name: "Configuri", icon: "fa-solid fa-gear", topicsCount: 0 }] });
  });

  // Rulează SQL-ul migrației PostgreSQL; pe MySQL schema de bază vine deja migrată.
  test.skipIf(testOnMysql())("migrația etapei 5 transformă iconițele vechi în iconițe Font Awesome", async () => {
    const category = await w.forums.create({ parentId: null, type: "CATEGORY", name: "Vechi" }, w.root);
    const legacy = await w.db.forum.create({ data: { parentId: category.id, type: "FORUM", name: "Anunțuri", slug: "anunturi", icon: "megaphone", position: 9 } });
    const custom = await w.db.forum.create({ data: { parentId: category.id, type: "FORUM", name: "Altul", slug: "altul", icon: "fa-solid fa-star", position: 10 } });
    const sql = readFileSync(path.resolve(__dirname, "../../../db/prisma/migrations/20261009000000_ui_modern/migration.sql"), "utf8");
    const update = sql.slice(sql.indexOf('UPDATE "forums" SET "icon"'));
    await w.db.$executeRawUnsafe(update.slice(0, update.indexOf(";") + 1));
    expect((await w.db.forum.findUniqueOrThrow({ where: { id: legacy.id } })).icon).toBe("fa-solid fa-bullhorn");
    expect((await w.db.forum.findUniqueOrThrow({ where: { id: custom.id } })).icon).toBe("fa-solid fa-star");
  });
});
