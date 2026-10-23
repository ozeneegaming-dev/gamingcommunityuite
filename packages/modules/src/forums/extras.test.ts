import { GcsConflict, GcsForbidden, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, doc, type GcsForumWorld } from "../../test/world";

let w: GcsForumWorld;
let tree: Awaited<ReturnType<GcsForumWorld["createTree"]>>;
let krypt: GcsActor;

beforeEach(async () => {
  w = await createForumWorld();
  tree = await w.createTree();
  krypt = await w.actorFor(await w.createUser("Krypt", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const poll = { question: "Ce hartă preferi?", options: ["Mirage", "Inferno", "Nuke"], multiple: false };

describe("prefixe", () => {
  test("ACP: creare, reordonare; un prefix restrâns la alt forum e refuzat la topic", async () => {
    const help = await w.prefixes.create(w.root, { name: "Ajutor", color: "#5EA2FF" });
    const news = await w.prefixes.create(w.root, { name: "Anunț", color: "#D62839" });
    await w.prefixes.reorder(w.root, [news.id, help.id]);
    expect((await w.prefixes.list()).map((p) => p.name)).toEqual(["Anunț", "Ajutor"]);

    const other = await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "Altul" }, w.root);
    await w.prefixes.setForumPrefixes(w.root, other.id, [news.id]);
    expect((await w.prefixes.allowedFor(other.id)).map((p) => p.name)).toEqual(["Anunț"]);
    expect((await w.prefixes.allowedFor(tree.forum.id)).map((p) => p.name)).toEqual(["Anunț", "Ajutor"]);

    await expect(
      w.topics.create(w.member, { forumId: other.id, title: "Cu prefix greșit", content: doc("x"), prefixId: help.id }),
    ).rejects.toBeInstanceOf(GcsValidationError);
    const ok = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Cu prefix", content: doc("x"), prefixId: help.id });
    expect((await w.queries.forum(w.member, tree.forum.id, { page: 1 })).topics[0]).toMatchObject({
      id: ok.topicId,
      prefix: { name: "Ajutor", color: "#5EA2FF" },
    });
  });

  test("validări și drept ACP", async () => {
    await expect(w.prefixes.create(w.root, { name: "", color: "#5EA2FF" })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.prefixes.create(w.root, { name: "X", color: "blue" })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.prefixes.create(w.member, { name: "X", color: "#5EA2FF" })).rejects.toBeInstanceOf(GcsForbidden);
  });
});

describe("tag-uri pe topicuri", () => {
  test("tag-urile se normalizează; peste `forums.tags_max` → GcsValidationError", async () => {
    const t = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Cu tag-uri", content: doc("x"), tags: ["CS2", "Configurație"] });
    expect((await w.queries.topic(w.member, t.topicId, { page: 1 })).topic.tags).toEqual([
      { name: "cs2", slug: "cs2" },
      { name: "configuratie", slug: "configuratie" },
    ]);
    await w.clearFlood(w.member);
    await expect(
      w.topics.create(w.member, { forumId: tree.forum.id, title: "Prea multe", content: doc("x"), tags: ["a1", "a2", "a3", "a4", "a5", "a6"] }),
    ).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("pagina unui tag: doar topicurile vizibile, din forumuri citibile", async () => {
    const t = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Vizibil", content: doc("x"), tags: ["cs2"] });
    const hidden = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Ascuns", content: doc("x"), tags: ["cs2"] });
    await w.posts.hide(w.root, hidden.postId);
    const page = await w.queries.topicsByTag(w.member, "cs2", { page: 1 });
    expect(page.tag).toEqual({ name: "cs2", slug: "cs2" });
    expect(page.topics.map((x) => x.id)).toEqual([t.topicId]);
  });
});

describe("sondaje", () => {
  test("un topic cu sondaj: votul unic, rezultatele, votul meu", async () => {
    const t = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Sondaj hărți", content: doc("votați"), poll });
    const view = await w.queries.topic(krypt, t.topicId, { page: 1 });
    const options = view.poll!.options;
    expect(options.map((o) => o.text)).toEqual(["Mirage", "Inferno", "Nuke"]);

    await w.polls.vote(krypt, view.poll!.id, [options[1]!.id]);
    await expect(w.polls.vote(krypt, view.poll!.id, [options[0]!.id])).rejects.toBeInstanceOf(GcsConflict);
    const after = (await w.queries.topic(krypt, t.topicId, { page: 1 })).poll!;
    expect(after).toMatchObject({ voters: 1, myVotes: [options[1]!.id], closed: false });
    expect(after.options.map((o) => o.votes)).toEqual([0, 1, 0]);
  });

  test("Review Focus #5: voturi simultane ale aceluiași user → un singur vot", async () => {
    const t = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Sondaj concurent", content: doc("x"), poll });
    const p = (await w.queries.topic(krypt, t.topicId, { page: 1 })).poll!;
    await Promise.allSettled(p.options.map((o) => w.polls.vote(krypt, p.id, [o.id])));
    expect(await w.db.pollVote.count({ where: { pollId: p.id } })).toBe(1);
    expect((await w.db.pollOption.findMany({ where: { pollId: p.id } })).reduce((n, o) => n + o.votesCount, 0)).toBe(1);
  });

  test("alegere multiplă; votul după închidere → GcsConflict; opțiuni străine → GcsValidationError", async () => {
    const t = await w.topics.create(w.member, {
      forumId: tree.forum.id,
      title: "Multiplu",
      content: doc("x"),
      poll: { ...poll, multiple: true, closesAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
    const p = (await w.queries.topic(krypt, t.topicId, { page: 1 })).poll!;
    await w.polls.vote(krypt, p.id, [p.options[0]!.id, p.options[2]!.id]);
    expect((await w.queries.topic(krypt, t.topicId, { page: 1 })).poll!.options.map((o) => o.votes)).toEqual([1, 0, 1]);

    await expect(w.polls.vote(w.root, p.id, [99999])).rejects.toBeInstanceOf(GcsValidationError);
    await w.db.poll.update({ where: { id: p.id }, data: { closesAt: new Date(Date.now() - 1000) } });
    await expect(w.polls.vote(w.root, p.id, [p.options[0]!.id])).rejects.toBeInstanceOf(GcsConflict);
  });

  test("validarea sondajului și `forums.poll_create`", async () => {
    const bad = { question: "Ce?", options: ["Doar una"], multiple: false };
    await expect(w.topics.create(w.member, { forumId: tree.forum.id, title: "Sondaj rău", content: doc("x"), poll: bad })).rejects.toBeInstanceOf(
      GcsValidationError,
    );
    await w.groupService.setSetting(w.groups.member!, "forums.poll_create", false, w.root);
    await w.clearFlood(w.member);
    await expect(w.topics.create(w.member, { forumId: tree.forum.id, title: "Fără drept", content: doc("x"), poll })).rejects.toBeInstanceOf(
      GcsForbidden,
    );
  });
});

describe("Q&A: cel mai bun răspuns", () => {
  test("autorul marchează un răspuns; topicul apare rezolvat", async () => {
    const qa = await w.forums.create({ parentId: tree.category.id, type: "QA", name: "Ajutor tehnic" }, w.root);
    const t = await w.topics.create(w.member, { forumId: qa.id, title: "Nu pornește jocul", content: doc("ajutor") });
    const r = await w.posts.reply(krypt, { topicId: t.topicId, content: doc("reinstalează") });

    await expect(w.topics.markSolved(krypt, t.topicId, r.postId)).rejects.toBeInstanceOf(GcsForbidden);
    await w.topics.markSolved(w.member, t.topicId, r.postId);
    expect((await w.queries.topic(w.member, t.topicId, { page: 1 })).topic.solvedPostId).toBe(r.postId);
    expect((await w.queries.forum(w.member, qa.id, { page: 1 })).topics[0]!.solved).toBe(true);

    await expect(w.topics.markSolved(w.member, t.topicId, t.postId)).rejects.toBeInstanceOf(GcsValidationError);
    await w.topics.markSolved(w.root, t.topicId, null);
    expect((await w.queries.topic(w.member, t.topicId, { page: 1 })).topic.solvedPostId).toBeNull();
  });

  test("pe un forum obișnuit → GcsValidationError", async () => {
    const t = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Nu e Q&A", content: doc("x") });
    const r = await w.posts.reply(krypt, { topicId: t.topicId, content: doc("y") });
    await expect(w.topics.markSolved(w.member, t.topicId, r.postId)).rejects.toBeInstanceOf(GcsValidationError);
  });
});

describe("reacții pe postări", () => {
  test("Like pe o postare: reputația autorului și sumarul din pagina topicului", async () => {
    const t = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Reacții", content: doc("x") });
    const like = await w.db.reaction.findUniqueOrThrow({ where: { key: "like" } });
    await w.reactions.react(krypt, { contentType: "forums.post", contentId: String(t.postId), reactionId: like.id });

    expect((await w.db.user.findUniqueOrThrow({ where: { id: w.member.userId! } })).reputation).toBe(1);
    const view = await w.queries.topic(krypt, t.topicId, { page: 1 });
    expect(view.posts[0]).toMatchObject({ reactions: [{ reactionId: like.id, count: 1 }], myReaction: like.id });
    expect(view.posts[0]!.author!.reputation).toBe(1);
    expect(view.reactions.map((r) => r.key)).toEqual(["like", "gg", "thanks", "haha", "disagree"]);
  });

  test("pe o postare dintr-un forum necitibil → refuzat", async () => {
    const t = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Reacții", content: doc("x") });
    const like = await w.db.reaction.findUniqueOrThrow({ where: { key: "like" } });
    await expect(
      w.reactions.react(w.guest, { contentType: "forums.post", contentId: String(t.postId), reactionId: like.id }),
    ).rejects.toBeInstanceOf(GcsForbidden);
  });
});
