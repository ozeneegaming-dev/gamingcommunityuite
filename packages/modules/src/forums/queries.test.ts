import { GcsForbidden, GcsNotFound, type GcsActor } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, doc, type GcsForumWorld } from "../../test/world";
import { GcsForumQueries } from "./queries";

let w: GcsForumWorld;
let q: GcsForumQueries;
let tree: Awaited<ReturnType<GcsForumWorld["createTree"]>>;

beforeEach(async () => {
  w = await createForumWorld();
  q = w.queries;
  tree = await w.createTree({ subforum: true });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

async function newMember(name: string, group = "member"): Promise<GcsActor> {
  return w.actorFor(await w.createUser(name, group));
}

/** Scoate o permisiune unui grup pe un forum care până acum moștenea (forumul primește matricea proprie). */
async function revoke(forumId: number, groupKey: string, actions: string[]) {
  const forum = String(forumId);
  // Matricea efectivă: urcă pe lanțul de moștenire până la containerul cu permisiuni proprii.
  let source = forum;
  for (;;) {
    const inherit = await w.db.containerInherit.findFirst({ where: { containerType: "forum", containerId: source } });
    if (!inherit?.inherits || !inherit.parentId) break;
    source = inherit.parentId;
  }
  const rows = await w.db.containerPermission.findMany({ where: { containerType: "forum", containerId: source } });
  const matrix: Record<number, string[]> = {};
  for (const r of rows) (matrix[r.groupId] ??= []).push(r.action);
  matrix[w.groups[groupKey]!] = (matrix[w.groups[groupKey]!] ?? []).filter((a) => !actions.includes(a));
  await w.groupService.setContainerInherit("forum", forum, { inherits: false, parentId: null }, w.root);
  await w.groupService.setContainerPermissions("forum", forum, matrix, w.root);
}

describe("index", () => {
  test("categoriile cu forumurile, subforumurile și totalurile (inclusiv subforumurile)", async () => {
    await w.topics.create(w.root, { forumId: tree.forum.id, title: "În forum", content: doc("a") });
    const sub = await w.topics.create(w.root, { forumId: tree.subforum!.id, title: "În subforum", content: doc("b") });

    const [category] = await q.index(w.member);
    expect(category).toMatchObject({ id: tree.category.id, name: "Servere de joc" });
    const [forum] = category!.forums;
    expect(forum).toMatchObject({
      id: tree.forum.id,
      topicsCount: 2,
      postsCount: 2,
      subforums: [{ id: tree.subforum!.id, name: "Configuri", slug: "configuri" }],
    });
    expect(forum!.last).toMatchObject({ topicId: sub.topicId, topicTitle: "În subforum", user: { name: "Fondator", groupKey: "root_admin" } });
  });

  test("fără `forums.view` forumul lipsește; fără `forums.read` apare, dar fără ultimul mesaj", async () => {
    await w.topics.create(w.root, { forumId: tree.forum.id, title: "Secret", content: doc("a") });
    await revoke(tree.forum.id, "guest", ["forums.read"]);
    const [category] = await q.index(w.guest);
    expect(category!.forums[0]).toMatchObject({ id: tree.forum.id, last: null });

    await revoke(tree.forum.id, "guest", ["forums.view", "forums.read"]);
    const after = await q.index(w.guest);
    expect(after[0]?.forums ?? []).toEqual([]);
  });

  test("o categorie fără forumuri vizibile pentru actor nu apare", async () => {
    await w.forums.create({ parentId: null, type: "CATEGORY", name: "Goală" }, w.root);
    const names = (await q.index(w.member)).map((c) => c.name);
    expect(names).toEqual(["Servere de joc"]);
  });

  test("structura modificată din ACP apare imediat (cache invalidat de forum.updated)", async () => {
    await q.index(w.member);
    await w.forums.update(tree.forum.id, { name: "CS2" }, w.root);
    expect((await q.index(w.member))[0]!.forums[0]!.name).toBe("CS2");
  });
});

describe("forum", () => {
  test("topicurile: fixate primele, apoi după ultimul mesaj; autorul și ultimul autor cu grupul", async () => {
    const a = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Vechi fixat", content: doc("a") });
    const b = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Mai vechi", content: doc("b") });
    const c = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Cel mai nou", content: doc("c") });
    await w.db.topic.update({ where: { id: a.topicId }, data: { pinned: true } });
    const other = await newMember("Krypt");
    await w.posts.reply(other, { topicId: b.topicId, content: doc("up") });

    const page = await q.forum(w.member, tree.forum.id, { page: 1 });
    expect(page.topics.map((t) => t.id)).toEqual([a.topicId, b.topicId, c.topicId]);
    expect(page.topics[1]).toMatchObject({
      title: "Mai vechi",
      repliesCount: 1,
      author: { name: "Fondator", groupKey: "root_admin" },
      last: { user: { name: "Krypt", groupKey: "member" } },
    });
    expect(page.breadcrumb.map((f) => f.name)).toEqual(["Servere de joc", "Counter-Strike 2"]);
    expect(page.subforums.map((f) => f.name)).toEqual(["Configuri"]);
    expect(page.canCreate).toBe(true);
  });

  test("paginarea folosește `forums.topics_per_page`", async () => {
    await w.settings.set("forums.topics_per_page", 5, w.root);
    for (let i = 0; i < 7; i++) await w.topics.create(w.root, { forumId: tree.forum.id, title: `Topic ${i}`, content: doc("x") });
    const p2 = await q.forum(w.member, tree.forum.id, { page: 2 });
    expect(p2.topics).toHaveLength(2);
    expect(p2.pagination).toEqual({ page: 2, pages: 2, perPage: 5, total: 7 });
  });

  test("Review Focus #2: un topic în așteptare apare doar autorului (marcat) și moderatorilor", async () => {
    const newbie = await newMember("Nou", "new_member");
    const t = await w.topics.create(newbie, { forumId: tree.forum.id, title: "Aștept aprobarea", content: doc("x") });
    expect(t.pending).toBe(true);

    expect((await q.forum(w.member, tree.forum.id, { page: 1 })).topics).toEqual([]);
    expect((await q.forum(newbie, tree.forum.id, { page: 1 })).topics).toMatchObject([{ id: t.topicId, visibility: "PENDING" }]);
    expect((await q.forum(w.root, tree.forum.id, { page: 1 })).topics).toMatchObject([{ id: t.topicId, visibility: "PENDING" }]);
  });

  test("fără `forums.view` → GcsNotFound; doar cu `view` → GcsForbidden", async () => {
    await revoke(tree.forum.id, "guest", ["forums.read"]);
    await expect(q.forum(w.guest, tree.forum.id, { page: 1 })).rejects.toBeInstanceOf(GcsForbidden);
    await revoke(tree.forum.id, "guest", ["forums.view", "forums.read"]);
    await expect(q.forum(w.guest, tree.forum.id, { page: 1 })).rejects.toBeInstanceOf(GcsNotFound);
    await expect(q.forum(w.member, 99999, { page: 1 })).rejects.toBeInstanceOf(GcsNotFound);
  });
});

describe("topic", () => {
  test("postările paginii, cu autorii (grup, postări, reputație) și drepturile actorului", async () => {
    const t = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Întrebare", content: doc("prima") });
    const other = await newMember("Krypt");
    const r = await w.posts.reply(other, { topicId: t.topicId, content: doc("răspuns") });

    const page = await q.topic(w.member, t.topicId, { page: 1 });
    expect(page.topic).toMatchObject({ id: t.topicId, title: "Întrebare", repliesCount: 1, locked: false });
    expect(page.posts.map((p) => [p.id, p.number, p.html])).toEqual([
      [t.postId, 1, "<p>prima</p>"],
      [r.postId, 2, "<p>răspuns</p>"],
    ]);
    expect(page.posts[1]!.author).toMatchObject({ name: "Krypt", groupKey: "member", groupName: "Membru", postsCount: 1 });
    expect(page.posts.map((p) => p.canEdit)).toEqual([true, false]);
    expect(page.canReply).toBe(true);
    expect(page.breadcrumb.map((f) => f.name)).toEqual(["Servere de joc", "Counter-Strike 2"]);
  });

  test("Review Focus #2: o postare în așteptare apare autorului și moderatorului, nu altui membru", async () => {
    const t = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Deschis", content: doc("x") });
    const newbie = await newMember("Nou", "new_member");
    const r = await w.posts.reply(newbie, { topicId: t.topicId, content: doc("în așteptare") });
    expect(r.pending).toBe(true);

    const ids = async (actor: GcsActor) => (await q.topic(actor, t.topicId, { page: 1 })).posts.map((p) => [p.id, p.visibility]);
    expect(await ids(w.member)).toEqual([[t.postId, "VISIBLE"]]);
    expect(await ids(newbie)).toEqual([
      [t.postId, "VISIBLE"],
      [r.postId, "PENDING"],
    ]);
    expect(await ids(w.root)).toEqual([
      [t.postId, "VISIBLE"],
      [r.postId, "PENDING"],
    ]);
  });

  test("un topic ascuns → GcsNotFound pentru membri; moderatorul îl vede", async () => {
    const t = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Va fi ascuns", content: doc("x") });
    await w.posts.hide(w.root, t.postId);
    await expect(q.topic(w.member, t.topicId, { page: 1 })).rejects.toBeInstanceOf(GcsNotFound);
    await expect(q.topic(w.root, t.topicId, { page: 1 })).resolves.toMatchObject({ topic: { visibility: "HIDDEN" } });
  });

  test("numărul de interogări nu crește cu numărul de postări sau de autori (fără N+1)", async () => {
    let count = 0;
    const counting = w.db.$extends({
      query: {
        $allOperations({ args, query }) {
          count++;
          return query(args);
        },
      },
    }) as unknown as PrismaClient;
    const cq = new GcsForumQueries({ ...w.queries.deps, db: counting });

    const t = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Multe postări", content: doc("start") });
    const users = await Promise.all(Array.from({ length: 19 }, (_, i) => newMember(`Autor${i}`)));
    for (const u of users) await w.posts.reply(u, { topicId: t.topicId, content: doc(`de la ${u.userId}`) });

    await cq.topic(w.member, t.topicId, { page: 1 }); // încălzește cache-ul de permisiuni și setări
    count = 0;
    const page = await cq.topic(w.member, t.topicId, { page: 1 });
    expect(page.posts).toHaveLength(20);
    expect(count).toBeLessThanOrEqual(8);
  });
});

describe("coloana din dreapta", () => {
  test("topicuri recente (doar din forumurile citibile) și statistici", async () => {
    await w.topics.create(w.root, { forumId: tree.forum.id, title: "Public", content: doc("a") });
    await w.topics.create(w.root, { forumId: tree.subforum!.id, title: "Privat", content: doc("b") });
    await revoke(tree.subforum!.id, "guest", ["forums.read"]);

    expect((await q.recentTopics(w.guest, 5)).map((t) => t.title)).toEqual(["Public"]);
    expect((await q.recentTopics(w.member, 5)).map((t) => t.title)).toEqual(["Privat", "Public"]);
    expect(await q.stats()).toMatchObject({ topics: 2, posts: 2, members: 2, newestMember: { name: "Mara" } });
  });
});
