import { GcsForbidden, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, doc, snapshotCounters, type GcsForumWorld } from "../../test/world";

let w: GcsForumWorld;
let tree: Awaited<ReturnType<GcsForumWorld["createTree"]>>;
let forumB: number;
let localMod: GcsActor;
let krypt: GcsActor;

beforeEach(async () => {
  w = await createForumWorld();
  tree = await w.createTree();
  forumB = (await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "Minecraft" }, w.root)).id;
  localMod = await w.actorFor(await w.createUser("Local", "moderator"));
  await w.db.moderator.create({
    data: {
      containerType: "forum",
      containerId: String(tree.forum.id),
      userId: localMod.userId,
      powers: ["pin", "lock", "feature", "move", "merge", "split", "approve", "hide", "edit"],
    },
  });
  await w.permissions.bumpVersion();
  krypt = await w.actorFor(await w.createUser("Krypt", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function expectCountersConsistent() {
  const before = await snapshotCounters(w.db);
  await w.db.$transaction((tx) => w.counters.recountAll(tx));
  expect(await snapshotCounters(w.db)).toEqual(before);
}

async function topic(forumId: number, title: string, replies = 0) {
  const t = await w.topics.create(w.root, { forumId, title, content: doc(title) });
  const ids = [t.postId];
  for (let i = 0; i < replies; i++) ids.push((await w.posts.reply(w.root, { topicId: t.topicId, content: doc(`${title} r${i}`) })).postId);
  return { topicId: t.topicId, ids };
}

describe("acțiuni pe topicuri", () => {
  test("fixează, blochează, evidențiază (în masă) și jurnalul", async () => {
    const a = await topic(tree.forum.id, "Primul");
    const b = await topic(tree.forum.id, "Al doilea");
    await w.moderation.setPinned(localMod, [a.topicId, b.topicId], true);
    await w.moderation.setLocked(localMod, [a.topicId], true);
    await w.moderation.setFeatured(localMod, [b.topicId], true);

    expect(await w.db.topic.findUniqueOrThrow({ where: { id: a.topicId } })).toMatchObject({ pinned: true, locked: true, featured: false });
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: b.topicId } })).toMatchObject({ pinned: true, featured: true });
    expect(await w.db.auditLog.count({ where: { action: { startsWith: "mod.topic." } } })).toBe(4);
  });

  test("un moderator al forumului A nu poate acționa în forumul B; `forums.moderate_all` poate", async () => {
    const b = await topic(forumB, "În B");
    await expect(w.moderation.setLocked(localMod, [b.topicId], true)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.moderation.setLocked(krypt, [b.topicId], true)).rejects.toBeInstanceOf(GcsForbidden);
    const supermod = await w.actorFor(await w.createUser("Super", "super_moderator"));
    await w.moderation.setLocked(supermod, [b.topicId], true);
    expect((await w.db.topic.findUniqueOrThrow({ where: { id: b.topicId } })).locked).toBe(true);
  });

  test("mutarea actualizează contoarele ambelor forumuri", async () => {
    const a = await topic(tree.forum.id, "De mutat", 2);
    await topic(tree.forum.id, "Rămâne");
    await w.moderation.move(localMod, [a.topicId], forumB);

    expect(await w.db.forum.findUniqueOrThrow({ where: { id: tree.forum.id } })).toMatchObject({ topicsCount: 1, postsCount: 1 });
    expect(await w.db.forum.findUniqueOrThrow({ where: { id: forumB } })).toMatchObject({ topicsCount: 1, postsCount: 3 });
    await expectCountersConsistent();
    // Topicul e acum în forumul B; Root Admin-ul încearcă să-l mute într-o categorie.
    await expect(w.moderation.move(w.root, [a.topicId], tree.category.id)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("Review Focus #1: unirea a două topicuri păstrează ordinea cronologică și contoarele", async () => {
    const target = await topic(tree.forum.id, "Țintă", 1);
    const source = await topic(tree.forum.id, "Sursă", 2);
    await w.moderation.merge(localMod, [source.topicId], target.topicId);

    expect(await w.db.topic.findUnique({ where: { id: source.topicId } })).toBeNull();
    const posts = await w.db.post.findMany({ where: { topicId: target.topicId }, orderBy: { id: "asc" } });
    expect(posts.map((p) => p.id)).toEqual([...target.ids, ...source.ids]);
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: target.topicId } })).toMatchObject({
      firstPostId: target.ids[0],
      repliesCount: 4,
      lastPostId: source.ids[2],
    });
    await expectCountersConsistent();
  });

  test("despărțirea a 3 postări într-un topic nou: prima devine prima postare", async () => {
    const t = await topic(tree.forum.id, "Lung", 4);
    const moved = t.ids.slice(2);
    const created = await w.moderation.split(localMod, moved, { title: "Discuție separată", forumId: forumB });

    expect(await w.db.topic.findUniqueOrThrow({ where: { id: created } })).toMatchObject({
      forumId: forumB,
      title: "Discuție separată",
      firstPostId: moved[0],
      lastPostId: moved[2],
      repliesCount: 2,
    });
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: t.topicId } })).toMatchObject({ repliesCount: 1, lastPostId: t.ids[1] });
    await expectCountersConsistent();

    await expect(w.moderation.split(localMod, t.ids.slice(0, 2), { title: "Tot topicul", forumId: forumB })).rejects.toBeInstanceOf(
      GcsValidationError,
    );
  });
});

describe("coada de aprobare", () => {
  test("aprobarea unei postări o publică și numără pentru promovare; coada arată doar forumurile moderatorului", async () => {
    const newbie = await w.actorFor(await w.createUser("Nou", "new_member"));
    const open = await topic(tree.forum.id, "Deschis");
    const reply = await w.posts.reply(newbie, { topicId: open.topicId, content: doc("în așteptare") });
    await w.clearFlood(newbie);
    const inB = await w.topics.create(newbie, { forumId: forumB, title: "Topic în B", content: doc("x") });

    const queue = await w.moderation.queue(localMod, { page: 1 });
    expect(queue.pending.map((p) => p.postId)).toEqual([reply.postId]);
    expect(await w.moderation.queueCount(localMod)).toEqual({ pending: 1, reports: 0 });
    expect((await w.moderation.queue(w.root, { page: 1 })).pending.map((p) => p.postId).sort()).toEqual([reply.postId, inB.postId].sort());

    await w.moderation.approve(localMod, [reply.postId]);
    expect(await w.db.post.findUniqueOrThrow({ where: { id: reply.postId } })).toMatchObject({ visibility: "VISIBLE" });
    expect(await w.db.user.findUniqueOrThrow({ where: { id: newbie.userId! } })).toMatchObject({ approvedPostsCount: 1, postsCount: 1 });
    await expect(w.moderation.approve(localMod, [inB.postId])).rejects.toBeInstanceOf(GcsForbidden);

    await w.moderation.approve(w.root, [inB.postId]);
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: inB.topicId } })).toMatchObject({ visibility: "VISIBLE" });
    expect(await w.db.forum.findUniqueOrThrow({ where: { id: forumB } })).toMatchObject({ topicsCount: 1, postsCount: 1 });
    await expectCountersConsistent();
  });

  test("respingerea ascunde postarea; după 2 aprobări, a treia postare a membrului nou e publică direct", async () => {
    const newbie = await w.actorFor(await w.createUser("Nou", "new_member"));
    const open = await topic(tree.forum.id, "Deschis");
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      await w.clearFlood(newbie);
      ids.push((await w.posts.reply(newbie, { topicId: open.topicId, content: doc(`p${i}`) })).postId);
    }
    await w.moderation.reject(localMod, [ids[2]!], "spam");
    expect(await w.db.post.findUniqueOrThrow({ where: { id: ids[2]! } })).toMatchObject({ visibility: "HIDDEN", hiddenReason: "spam" });

    await w.moderation.approve(localMod, [ids[0]!, ids[1]!]);
    await w.clearFlood(newbie);
    expect((await w.posts.reply(newbie, { topicId: open.topicId, content: doc("liber") })).pending).toBe(false);
    await expectCountersConsistent();
  });

  test("rapoartele din forumurile moderatorului apar în coadă", async () => {
    const t = await topic(tree.forum.id, "Raportat");
    await w.reports.report(krypt, { contentType: "forums.post", contentId: String(t.ids[0]), reason: "limbaj nepotrivit" });
    const queue = await w.moderation.queue(localMod, { page: 1 });
    expect(queue.reports).toMatchObject([{ contentId: String(t.ids[0]), reasons: [{ reason: "limbaj nepotrivit" }], topicId: t.topicId }]);
    expect(await w.moderation.queueCount(localMod)).toEqual({ pending: 0, reports: 1 });
  });
});

describe("acțiuni salvate", () => {
  test("„blochează + mută + răspuns predefinit” face toți pașii", async () => {
    const t = await topic(tree.forum.id, "Rezolvat deja");
    const action = await w.moderation.saveAction(w.root, {
      name: "Închide și arhivează",
      forumIds: [],
      actions: { lock: true, moveTo: forumB, reply: "Topic închis de moderator." },
    });
    const supermod = await w.actorFor(await w.createUser("Super", "super_moderator"));
    await w.moderation.applySavedAction(supermod, action.id, [t.topicId]);

    const after = await w.db.topic.findUniqueOrThrow({ where: { id: t.topicId } });
    expect(after).toMatchObject({ locked: true, forumId: forumB, repliesCount: 1 });
    const last = await w.db.post.findUniqueOrThrow({ where: { id: after.lastPostId! } });
    expect(last).toMatchObject({ authorId: supermod.userId, contentHtml: "<p>Topic închis de moderator.</p>" });
    await expectCountersConsistent();
  });

  test("răspunsul predefinit trece prin filtrul post.before_save și emite post.created, ca orice răspuns", async () => {
    const a = await topic(tree.forum.id, "Primul topic");
    const b = await topic(tree.forum.id, "Al doilea topic");
    const filtered: { kind: string; topicId: number | null; forumId: number; authorId: string | null }[] = [];
    w.posting.deps.contentFilter = async (data) => {
      filtered.push({ kind: data.kind, topicId: data.topicId, forumId: data.forumId, authorId: data.authorId });
      return { ...data, content: doc(`Filtrat #${data.topicId}`) };
    };
    const created: unknown[] = [];
    w.bus.on("post.created", async (e) => {
      created.push(e.payload);
    });
    const action = await w.moderation.saveAction(w.root, { name: "Mută cu răspuns", forumIds: [], actions: { moveTo: forumB, reply: "Mutat." } });
    await w.moderation.applySavedAction(w.root, action.id, [a.topicId, b.topicId]);

    const authorId = w.root.userId;
    expect(filtered).toEqual([
      { kind: "reply", topicId: a.topicId, forumId: forumB, authorId },
      { kind: "reply", topicId: b.topicId, forumId: forumB, authorId },
    ]);
    for (const t of [a, b]) {
      const after = await w.db.topic.findUniqueOrThrow({ where: { id: t.topicId } });
      const last = await w.db.post.findUniqueOrThrow({ where: { id: after.lastPostId! } });
      expect(last.contentHtml).toBe(`<p>Filtrat #${t.topicId}</p>`);
      expect(created).toContainEqual({ postId: last.id, topicId: t.topicId, forumId: forumB, pending: false, authorId });
    }
    expect(created).toHaveLength(2);
  });

  test("un filtru care respinge răspunsul predefinit oprește toată acțiunea", async () => {
    const t = await topic(tree.forum.id, "Topic filtrat");
    w.posting.deps.contentFilter = async () => {
      throw new GcsValidationError({ content: "blocked" });
    };
    const action = await w.moderation.saveAction(w.root, { name: "Blochează cu răspuns", forumIds: [], actions: { lock: true, reply: "Închis." } });
    await expect(w.moderation.applySavedAction(w.root, action.id, [t.topicId])).rejects.toBeInstanceOf(GcsValidationError);
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: t.topicId } })).toMatchObject({ locked: false, repliesCount: 0 });
  });

  test("o acțiune restrânsă la alt forum nu se aplică; fără puterea cerută → GcsForbidden", async () => {
    const t = await topic(tree.forum.id, "Topic oarecare");
    const onlyB = await w.moderation.saveAction(w.root, { name: "Doar B", forumIds: [forumB], actions: { pin: true } });
    await expect(w.moderation.applySavedAction(w.root, onlyB.id, [t.topicId])).rejects.toBeInstanceOf(GcsValidationError);

    const deleteLike = await w.moderation.saveAction(w.root, { name: "Mută", forumIds: [], actions: { moveTo: forumB } });
    await w.db.moderator.updateMany({ where: { userId: localMod.userId }, data: { powers: ["pin"] } });
    await w.permissions.bumpVersion();
    await expect(w.moderation.applySavedAction(localMod, deleteLike.id, [t.topicId])).rejects.toBeInstanceOf(GcsForbidden);
  });
});
