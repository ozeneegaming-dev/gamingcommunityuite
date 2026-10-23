import { GcsForbidden, GcsRateLimited, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, doc, snapshotCounters, type GcsForumWorld } from "../../test/world";

let w: GcsForumWorld;
let forumId: number;

beforeEach(async () => {
  w = await createForumWorld();
  forumId = (await w.createTree()).forum.id;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function newActor(name: string, group: string): Promise<GcsActor> {
  return w.actorFor(await w.createUser(name, group));
}

/** Contoarele denormalizate trebuie să fie egale cu cele recalculate din date (Review Focus #1). */
async function expectCountersConsistent() {
  const before = await snapshotCounters(w.db);
  await w.db.$transaction((tx) => w.counters.recountAll(tx));
  expect(await snapshotCounters(w.db)).toEqual(before);
}

describe("GcsTopicService.create", () => {
  test("un membru deschide un topic: contoare, ultimul mesaj, contorul userului", async () => {
    const res = await w.topics.create(w.member, { forumId, title: "  Cel mai bun   crosshair pentru 1440p? ", content: doc("Salut!") });
    expect(res.pending).toBe(false);

    const topic = await w.db.topic.findUniqueOrThrow({ where: { id: res.topicId } });
    expect(topic).toMatchObject({
      title: "Cel mai bun crosshair pentru 1440p?",
      slug: "cel-mai-bun-crosshair-pentru-1440p",
      visibility: "VISIBLE",
      firstPostId: res.postId,
      lastPostId: res.postId,
      repliesCount: 0,
      authorId: w.member.userId,
    });
    expect(await w.db.forum.findUniqueOrThrow({ where: { id: forumId } })).toMatchObject({
      topicsCount: 1,
      postsCount: 1,
      lastPostId: res.postId,
      lastTopicId: res.topicId,
      lastPosterId: w.member.userId,
    });
    expect(await w.db.user.findUniqueOrThrow({ where: { id: w.member.userId! } })).toMatchObject({ postsCount: 1, approvedPostsCount: 1 });
    expect((await w.db.post.findUniqueOrThrow({ where: { id: res.postId } })).contentHtml).toBe("<p>Salut!</p>");
    await expectCountersConsistent();
  });

  test("topicul e indexat pentru căutare (titlu și conținut), fără diacritice", async () => {
    const res = await w.topics.create(w.member, { forumId, title: "Mașina lui Ștefan", content: doc("Am cumpărat două mașini noi") });
    const topics = await w.db.$queryRaw<{ id: number }[]>`SELECT id FROM topics WHERE "searchVector" @@ plainto_tsquery('gcs_ro', 'masina stefan')`;
    const posts = await w.db.$queryRaw<{ id: number }[]>`SELECT id FROM posts WHERE "searchVector" @@ plainto_tsquery('gcs_ro', 'masina')`;
    expect(topics.map((t) => t.id)).toEqual([res.topicId]);
    expect(posts.map((p) => p.id)).toEqual([res.postId]);
  });

  test("validări: titlu prea scurt, conținut invalid sau prea lung, forum categorie/link", async () => {
    const { category } = await w.createTree();
    await expect(w.topics.create(w.member, { forumId, title: "ab", content: doc("x") })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.topics.create(w.member, { forumId, title: "Titlu bun", content: { type: "doc", content: [] } })).rejects.toBeInstanceOf(
      GcsValidationError,
    );
    await w.settings.set("forums.post_max_chars", 100, w.root);
    await expect(w.topics.create(w.member, { forumId, title: "Titlu bun", content: doc("x".repeat(101)) })).rejects.toBeInstanceOf(
      GcsValidationError,
    );
    await expect(w.topics.create(w.root, { forumId: category.id, title: "Titlu bun", content: doc("x") })).rejects.toBeInstanceOf(
      GcsValidationError,
    );
  });

  test("vizitatorul și un forum fără `forums.create` → GcsForbidden", async () => {
    await expect(w.topics.create(w.guest, { forumId, title: "Titlu bun", content: doc("x") })).rejects.toBeInstanceOf(GcsForbidden);
    const forum = String(forumId);
    await w.groupService.setContainerInherit("forum", forum, { inherits: false, parentId: null }, w.root);
    await w.groupService.setContainerPermissions("forum", forum, { [w.groups.member!]: ["forums.view", "forums.read", "forums.reply"] }, w.root);
    await expect(w.topics.create(w.member, { forumId, title: "Titlu bun", content: doc("x") })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("a doua postare înainte de `forums.flood_seconds` → GcsRateLimited", async () => {
    await w.topics.create(w.member, { forumId, title: "Primul topic", content: doc("x") });
    await expect(w.topics.create(w.member, { forumId, title: "Al doilea topic", content: doc("x") })).rejects.toBeInstanceOf(GcsRateLimited);
  });
});

describe("aprobarea postărilor", () => {
  test("un Membru nou: primele postări așteaptă aprobare și nu schimbă contoarele publice", async () => {
    const newbie = await newActor("Nou", "new_member");
    const open = await w.topics.create(w.member, { forumId, title: "Topic deschis", content: doc("x") });

    const topic = await w.topics.create(newbie, { forumId, title: "Primul meu topic", content: doc("salut") });
    expect(topic.pending).toBe(true);
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: topic.topicId } })).toMatchObject({ visibility: "PENDING" });

    await w.clearFlood(newbie);
    const reply = await w.posts.reply(newbie, { topicId: open.topicId, content: doc("și eu") });
    expect(reply.pending).toBe(true);

    expect(await w.db.forum.findUniqueOrThrow({ where: { id: forumId } })).toMatchObject({ topicsCount: 1, postsCount: 1, lastPostId: open.postId });
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: open.topicId } })).toMatchObject({ repliesCount: 0, lastPostId: open.postId });
    expect(await w.db.user.findUniqueOrThrow({ where: { id: newbie.userId! } })).toMatchObject({ postsCount: 0, approvedPostsCount: 0 });
    await expectCountersConsistent();
  });

  test("după 2 postări aprobate, următoarea se publică direct", async () => {
    const newbie = await newActor("Nou", "new_member");
    await w.db.user.update({ where: { id: newbie.userId! }, data: { approvedPostsCount: 2 } });
    const res = await w.topics.create(newbie, { forumId, title: "Acum merge", content: doc("x") });
    expect(res.pending).toBe(false);
  });

  test("la pragul `new_member.post_threshold` (5), Membrul nou devine Membru", async () => {
    const newbie = await newActor("Nou", "new_member");
    await w.db.user.update({ where: { id: newbie.userId! }, data: { approvedPostsCount: 4 } });
    await w.topics.create(newbie, { forumId, title: "A cincea postare", content: doc("x") });

    const user = await w.db.user.findUniqueOrThrow({ where: { id: newbie.userId! } });
    expect(user).toMatchObject({ primaryGroupId: w.groups.member, previousPrimaryGroupId: w.groups.new_member, approvedPostsCount: 5 });
    expect(await w.db.auditLog.count({ where: { action: "user.promoted", targetId: newbie.userId! } })).toBe(1);
  });

  test("un forum cu aprobare obligatorie: membrii așteaptă, moderatorii nu", async () => {
    await w.forums.update(forumId, { requireApproval: true }, w.root);
    const res = await w.topics.create(w.member, { forumId, title: "Așteaptă", content: doc("x") });
    expect(res.pending).toBe(true);

    const supermod = await newActor("Neo", "super_moderator");
    expect((await w.topics.create(supermod, { forumId, title: "Direct", content: doc("x") })).pending).toBe(false);

    const mod = await newActor("Local", "moderator");
    await w.db.moderator.create({ data: { containerType: "forum", containerId: String(forumId), userId: mod.userId, powers: ["approve"] } });
    await w.permissions.bumpVersion();
    expect((await w.topics.create(mod, { forumId, title: "Tot direct", content: doc("x") })).pending).toBe(false);
  });
});

describe("GcsPostService.reply", () => {
  test("un răspuns actualizează topicul, forumul și userul; întoarce pagina", async () => {
    const t = await w.topics.create(w.member, { forumId, title: "Întrebare", content: doc("?") });
    const other = await newActor("Krypt", "member");
    const r = await w.posts.reply(other, { topicId: t.topicId, content: doc("Răspuns") });

    expect(r).toMatchObject({ pending: false, page: 1 });
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: t.topicId } })).toMatchObject({
      repliesCount: 1,
      lastPostId: r.postId,
      lastPosterId: other.userId,
    });
    expect(await w.db.forum.findUniqueOrThrow({ where: { id: forumId } })).toMatchObject({ postsCount: 2, lastPostId: r.postId });
    await expectCountersConsistent();
  });

  test("pagina răspunsului ține cont de `forums.posts_per_page`", async () => {
    await w.settings.set("forums.posts_per_page", 5, w.root);
    const t = await w.topics.create(w.root, { forumId, title: "Lung", content: doc("1") });
    let last = { page: 0 };
    for (let i = 0; i < 5; i++) last = await w.posts.reply(w.root, { topicId: t.topicId, content: doc(`r${i}`) });
    expect(last.page).toBe(2);
  });

  test("un topic blocat refuză membrii; moderatorii pot răspunde", async () => {
    const t = await w.topics.create(w.member, { forumId, title: "Blocat", content: doc("x") });
    await w.db.topic.update({ where: { id: t.topicId }, data: { locked: true } });
    const other = await newActor("Krypt", "member");
    await expect(w.posts.reply(other, { topicId: t.topicId, content: doc("x") })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.posts.reply(w.root, { topicId: t.topicId, content: doc("x") })).resolves.toMatchObject({ pending: false });
  });

  test("un topic în așteptare nu primește răspunsuri de la membri", async () => {
    await w.forums.update(forumId, { requireApproval: true }, w.root);
    const t = await w.topics.create(w.member, { forumId, title: "În așteptare", content: doc("x") });
    const other = await newActor("Krypt", "member");
    await expect(w.posts.reply(other, { topicId: t.topicId, content: doc("x") })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("Review Focus #5: 10 răspunsuri simultane → contoare și ultimul mesaj corecte", async () => {
    const t = await w.topics.create(w.root, { forumId, title: "Concurență", content: doc("start") });
    const users = await Promise.all(Array.from({ length: 10 }, (_, i) => newActor(`Jucator${i}`, "member")));
    const replies = await Promise.all(users.map((u, i) => w.posts.reply(u, { topicId: t.topicId, content: doc(`r${i}`) })));

    const maxId = Math.max(...replies.map((r) => r.postId));
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: t.topicId } })).toMatchObject({ repliesCount: 10, lastPostId: maxId });
    expect(await w.db.forum.findUniqueOrThrow({ where: { id: forumId } })).toMatchObject({ postsCount: 11, lastPostId: maxId });
    await expectCountersConsistent();
  });
});
