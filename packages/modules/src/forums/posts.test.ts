import { ftsIds } from "../../test/fts";
import { GcsForbidden, GcsNotFound, type GcsActor } from "@gcs/core";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createForumWorld, doc, snapshotCounters, type GcsForumWorld } from "../../test/world";

let w: GcsForumWorld;
let forumId: number;
let author: GcsActor;
let other: GcsActor;
let moderator: GcsActor;

beforeEach(async () => {
  w = await createForumWorld();
  forumId = (await w.createTree()).forum.id;
  author = w.member;
  other = await w.actorFor(await w.createUser("Krypt", "member"));
  moderator = await w.actorFor(await w.createUser("Neo", "super_moderator"));
});

afterEach(() => {
  vi.useRealTimers();
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

/** Un topic al autorului, cu un răspuns al altui membru. */
async function topicWithReply() {
  const t = await w.topics.create(author, { forumId, title: "Întrebare despre configuri", content: doc("prima") });
  const r = await w.posts.reply(other, { topicId: t.topicId, content: doc("răspuns") });
  return { topicId: t.topicId, firstPostId: t.postId, replyId: r.postId };
}

/** Mută „acum” cu `minutes` minute în viitor (doar `Date`, ca Prisma și Redis să meargă normal). */
function advanceMinutes(minutes: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.now() + minutes * 60_000));
}

describe("GcsPostService.edit", () => {
  test("autorul editează în fereastra de 60 de minute; versiunea veche intră în istoric", async () => {
    const { replyId } = await topicWithReply();
    advanceMinutes(59);
    await w.posts.edit(other, replyId, { content: doc("răspuns corectat") });

    const post = await w.db.post.findUniqueOrThrow({ where: { id: replyId } });
    expect(post).toMatchObject({ contentHtml: "<p>răspuns corectat</p>", editedById: other.userId });
    expect(post.editedAt).not.toBeNull();
    const revisions = await w.db.postRevision.findMany({ where: { postId: replyId } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ contentHtml: "<p>răspuns</p>", editorId: other.userId });
  });

  test("după 60 de minute, autorul nu mai poate; moderatorul poate oricând (și apare în jurnal)", async () => {
    const { replyId } = await topicWithReply();
    advanceMinutes(61);
    await expect(w.posts.edit(other, replyId, { content: doc("prea târziu") })).rejects.toBeInstanceOf(GcsForbidden);
    await w.posts.edit(moderator, replyId, { content: doc("editat de moderator") });
    expect(await w.db.auditLog.count({ where: { action: "mod.post.edit", targetId: String(replyId) } })).toBe(1);
  });

  test("altcineva (fără moderare) nu poate edita", async () => {
    const { replyId } = await topicWithReply();
    await expect(w.posts.edit(author, replyId, { content: doc("nu e a mea") })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("prima postare poate schimba și titlul; căutarea găsește titlul nou", async () => {
    const { topicId, firstPostId } = await topicWithReply();
    await w.posts.edit(author, firstPostId, { content: doc("prima, editată"), title: "Configuri pentru Mașina nouă" });
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: topicId } })).toMatchObject({
      title: "Configuri pentru Mașina nouă",
      slug: "configuri-pentru-masina-noua",
    });
    expect(await ftsIds(w.db, "topics", "masina")).toEqual([topicId]);
  });

  test("istoricul: moderatorul îl vede; autorul doar dacă setarea o permite", async () => {
    const { replyId } = await topicWithReply();
    await w.posts.edit(other, replyId, { content: doc("v2") });
    await expect(w.posts.revisions(moderator, replyId)).resolves.toHaveLength(1);
    await expect(w.posts.revisions(other, replyId)).resolves.toHaveLength(1);
    await w.settings.set("forums.revisions_visible_to_author", false, w.root);
    await expect(w.posts.revisions(other, replyId)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.posts.revisions(author, replyId)).rejects.toBeInstanceOf(GcsForbidden);
  });
});

describe("ascundere, restaurare, ștergere", () => {
  test("membrul își ascunde răspunsul: dispare din contoare și din ultimul mesaj", async () => {
    const { topicId, firstPostId, replyId } = await topicWithReply();
    await w.posts.hide(other, replyId);

    expect(await w.db.post.findUniqueOrThrow({ where: { id: replyId } })).toMatchObject({ visibility: "HIDDEN", hiddenById: other.userId });
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: topicId } })).toMatchObject({ repliesCount: 0, lastPostId: firstPostId });
    expect(await w.db.forum.findUniqueOrThrow({ where: { id: forumId } })).toMatchObject({ postsCount: 1, lastPostId: firstPostId });
    expect(await w.db.user.findUniqueOrThrow({ where: { id: other.userId! } })).toMatchObject({ postsCount: 0 });
    await expectCountersConsistent();
  });

  test("moderatorul restaurează; membrul nu-și poate restaura singur postarea", async () => {
    const { topicId, replyId } = await topicWithReply();
    await w.posts.hide(other, replyId);
    await expect(w.posts.restore(other, replyId)).rejects.toBeInstanceOf(GcsForbidden);
    await w.posts.restore(moderator, replyId);
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: topicId } })).toMatchObject({ repliesCount: 1, lastPostId: replyId });
    expect(await w.db.auditLog.count({ where: { action: "mod.post.restore" } })).toBe(1);
    await expectCountersConsistent();
  });

  test("ascunderea primei postări ascunde tot topicul", async () => {
    const { topicId, firstPostId } = await topicWithReply();
    await w.posts.hide(author, firstPostId);
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: topicId } })).toMatchObject({ visibility: "HIDDEN" });
    expect(await w.db.forum.findUniqueOrThrow({ where: { id: forumId } })).toMatchObject({ topicsCount: 0, postsCount: 0, lastPostId: null });
    await expectCountersConsistent();

    await w.posts.restore(moderator, firstPostId);
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: topicId } })).toMatchObject({ visibility: "VISIBLE" });
    await expectCountersConsistent();
  });

  test("`forums.hide_own` dezactivat → membrul nu-și mai poate ascunde postarea", async () => {
    const { replyId } = await topicWithReply();
    await w.groupService.setSetting(w.groups.member!, "forums.hide_own", false, w.root);
    await expect(w.posts.hide(other, replyId)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("ștergerea definitivă e doar a moderatorului; ultimul mesaj se reface din postarea anterioară", async () => {
    const { topicId, firstPostId, replyId } = await topicWithReply();
    await expect(w.posts.delete(other, replyId)).rejects.toBeInstanceOf(GcsForbidden);
    await w.posts.delete(moderator, replyId);

    expect(await w.db.post.findUnique({ where: { id: replyId } })).toBeNull();
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: topicId } })).toMatchObject({ repliesCount: 0, lastPostId: firstPostId });
    expect(await w.db.auditLog.count({ where: { action: "mod.post.delete" } })).toBe(1);
    await expectCountersConsistent();
  });

  test("ștergerea primei postări șterge tot topicul", async () => {
    const { topicId, firstPostId } = await topicWithReply();
    await w.posts.delete(moderator, firstPostId);
    expect(await w.db.topic.findUnique({ where: { id: topicId } })).toBeNull();
    expect(await w.db.forum.findUniqueOrThrow({ where: { id: forumId } })).toMatchObject({ topicsCount: 0, postsCount: 0 });
    await expectCountersConsistent();
  });

  test("un id inexistent → GcsNotFound", async () => {
    await expect(w.posts.hide(moderator, 99999)).rejects.toBeInstanceOf(GcsNotFound);
  });
});
