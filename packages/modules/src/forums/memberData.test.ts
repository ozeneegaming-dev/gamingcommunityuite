import type { GcsActor } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { snapshotCounters } from "../../test/world";
import { GcsForumCounters } from "./counters";

let w: GcsRemovalWorld;
let root: GcsActor;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  root = await w.user("Fondator", "root_admin");
});

/** Contoarele denormalizate sunt cele recalculate din date (oracolul `recountAll`). */
async function expectCountersConsistent() {
  const before = await snapshotCounters(w.s.db);
  await w.s.db.$transaction((tx) => new GcsForumCounters().recountAll(tx), { timeout: 30_000 });
  expect(await snapshotCounters(w.s.db)).toEqual(before);
}

describe("forumul la ștergerea unui cont", () => {
  test("„Păstrează conținutul”: postările rămân fără autor și fără IP; contoarele forumului nu se schimbă", async () => {
    const forumId = await w.forum();
    const leaving = await w.user("Pleaca");
    const other = await w.user("Ramane");
    const t1 = await w.topic(leaving, forumId, "Topicul lui", "Primul");
    await w.reply(other, t1.topicId, "Răspunsul altuia");
    const t2 = await w.topic(other, forumId, "Topicul altuia");
    const mine = await w.reply(leaving, t2.topicId, "Ultimul cuvânt");
    await w.s.db.post.updateMany({ where: { authorId: leaving.userId }, data: { ip: "198.51.100.4" } });
    const forumBefore = await w.s.db.forum.findUniqueOrThrow({ where: { id: forumId } });
    expect(forumBefore.lastPosterId).toBe(leaving.userId);

    await w.s.memberRemoval.requestDelete(root, leaving.userId!, { mode: "KEEP_CONTENT", keepMessages: false });

    const posts = await w.s.db.post.findMany({ orderBy: { id: "asc" }, select: { id: true, authorId: true, ip: true } });
    expect(posts).toHaveLength(4);
    expect(posts.filter((p) => p.authorId === null).map((p) => p.id)).toEqual([t1.postId, mine.postId]);
    expect(posts.every((p) => p.ip === null || p.authorId !== null)).toBe(true);
    expect(await w.s.db.topic.findUniqueOrThrow({ where: { id: t1.topicId } })).toMatchObject({ authorId: null });
    const forum = await w.s.db.forum.findUniqueOrThrow({ where: { id: forumId } });
    expect(forum).toMatchObject({ topicsCount: 2, postsCount: 4, lastPosterId: null, lastPostId: mine.postId });
    await expectCountersConsistent();
  });

  test("„Șterge și conținutul”: topicurile lui (cu răspunsuri) și postările lui din alte topicuri dispar; contoarele rămân corecte", async () => {
    const forumId = await w.forum();
    const leaving = await w.user("Spammer");
    const other = await w.user("Ramane");
    const t1 = await w.topic(leaving, forumId, "Spam 1");
    await w.reply(other, t1.topicId, "Răspuns care dispare cu topicul");
    await w.topic(leaving, forumId, "Spam 2");
    const t3 = await w.topic(other, forumId, "Topic curat");
    const keep = await w.reply(other, t3.topicId, "Rămâne");
    await w.reply(leaving, t3.topicId, "Spam în topicul altuia");
    // Un fișier atașat unei postări a lui: se șterge cu postarea.
    const spamPost = (await w.s.db.post.findFirstOrThrow({ where: { topicId: t3.topicId, authorId: leaving.userId } })).id;
    await w.s.db.attachment.create({ data: { ownerId: leaving.userId, storageKey: "spam.png", filename: "spam.png", mime: "image/png", size: 1, contentType: "forums.post", contentId: String(spamPost) } });
    const deleted: string[] = [];
    w.s.bus.on("topic.deleted", async () => void deleted.push("topic"));
    w.s.bus.on("post.deleted", async () => void deleted.push("post"));

    await w.s.memberRemoval.requestDelete(root, leaving.userId!, { mode: "DELETE_CONTENT", keepMessages: false });

    expect(await w.s.db.topic.findMany({ select: { id: true } })).toEqual([{ id: t3.topicId }]);
    expect((await w.s.db.post.findMany({ select: { id: true } })).map((p) => p.id)).toEqual([t3.postId, keep.postId]);
    expect(await w.s.db.attachment.count()).toBe(0);
    expect(deleted.sort()).toEqual(["post", "topic", "topic"]);
    const forum = await w.s.db.forum.findUniqueOrThrow({ where: { id: forumId } });
    expect(forum).toMatchObject({ topicsCount: 1, postsCount: 2, lastPostId: keep.postId, lastPosterId: other.userId });
    expect(await w.s.db.user.findUniqueOrThrow({ where: { id: other.userId! } })).toMatchObject({ postsCount: 2 });
    await expectCountersConsistent();
  });

  test("voturile în sondaje se șterg, cu contorul opțiunii corectat", async () => {
    const forumId = await w.forum();
    const author = await w.user("Autor");
    const voter = await w.user("Votant");
    const t = await w.topic(author, forumId, "Sondaj", "Alege", { poll: { question: "Hartă?", options: ["dust2", "inferno"] } });
    const poll = await w.s.db.poll.findUniqueOrThrow({ where: { topicId: t.topicId }, include: { options: { orderBy: { position: "asc" } } } });
    await w.s.polls.vote(voter, poll.id, [poll.options[0]!.id]);
    await w.s.memberRemoval.requestDelete(root, voter.userId!, { mode: "KEEP_CONTENT", keepMessages: false });
    expect((await w.s.db.pollOption.findUniqueOrThrow({ where: { id: poll.options[0]!.id } })).votesCount).toBe(0);
    expect(await w.s.db.pollVote.count()).toBe(0);
  });
});

describe("forumul la unirea conturilor", () => {
  test("postările, topicurile și ultimul mesaj trec la țintă; contoarele țintei se recalculează; voturile fără dubluri", async () => {
    const forumId = await w.forum();
    const source = await w.user("Dublura");
    const target = await w.user("Principal");
    const t1 = await w.topic(source, forumId, "Topic din dublură");
    await w.reply(target, t1.topicId);
    const t2 = await w.topic(target, forumId, "Sondaj", "Alege", { poll: { question: "Hartă?", options: ["dust2", "inferno"] } });
    const last = await w.reply(source, t2.topicId, "Ultimul");
    const poll = await w.s.db.poll.findUniqueOrThrow({ where: { topicId: t2.topicId }, include: { options: { orderBy: { position: "asc" } } } });
    await w.s.polls.vote(source, poll.id, [poll.options[0]!.id]);
    await w.s.polls.vote(target, poll.id, [poll.options[1]!.id]);
    await w.s.readMarkers.markRead(source.userId!, t1.topicId, last.postId);
    await w.s.readMarkers.markRead(target.userId!, t1.topicId, t1.postId);

    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);

    expect(await w.s.db.post.count({ where: { authorId: target.userId } })).toBe(4);
    expect(await w.s.db.topic.findUniqueOrThrow({ where: { id: t1.topicId } })).toMatchObject({ authorId: target.userId });
    expect(await w.s.db.forum.findUniqueOrThrow({ where: { id: forumId } })).toMatchObject({ lastPosterId: target.userId });
    expect(await w.s.db.user.findUniqueOrThrow({ where: { id: target.userId! } })).toMatchObject({ postsCount: 4 });
    const options = await w.s.db.pollOption.findMany({ where: { pollId: poll.id }, orderBy: { position: "asc" } });
    expect(options.map((o) => o.votesCount)).toEqual([0, 1]);
    expect(await w.s.db.pollVote.findMany({ select: { userId: true } })).toEqual([{ userId: target.userId }]);
    // Marcajul de citire al țintei rămâne (unul singur pe topic).
    expect(await w.s.db.readMarker.findMany({ where: { topicId: t1.topicId }, select: { userId: true, lastReadPostId: true } })).toEqual([{ userId: target.userId, lastReadPostId: t1.postId }]);
    await expectCountersConsistent();
  });
});
