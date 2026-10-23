import type { GcsActor } from "@gcs/core";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createForumWorld, doc, type GcsForumWorld } from "../../test/world";

let w: GcsForumWorld;
let tree: Awaited<ReturnType<GcsForumWorld["createTree"]>>;
let reader: GcsActor;

beforeEach(async () => {
  w = await createForumWorld();
  tree = await w.createTree({ subforum: true });
  // Cititorul s-a înregistrat înainte de toate topicurile din test.
  const user = await w.createUser("Cititor", "member");
  await w.db.user.update({ where: { id: user.id }, data: { createdAt: new Date(Date.now() - 86_400_000) } });
  reader = await w.actorFor(user);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function topicWithPosts(forumId: number, posts: number) {
  const t = await w.topics.create(w.root, { forumId, title: "Topic lung", content: doc("1") });
  const ids = [t.postId];
  for (let i = 2; i <= posts; i++) ids.push((await w.posts.reply(w.root, { topicId: t.topicId, content: doc(String(i)) })).postId);
  return { topicId: t.topicId, ids };
}

const unreadIds = async (actor: GcsActor) => (await w.queries.forum(actor, tree.forum.id, { page: 1 })).topics.filter((t) => t.unread).map((t) => t.id);

describe("GcsReadMarkerService", () => {
  test("Review Focus #6: marker pe pagina 1 dintr-un topic cu 45 de postări → prima necitită e #21, pagina 2", async () => {
    const { topicId, ids } = await topicWithPosts(tree.forum.id, 45);
    await w.readMarkers.markRead(reader.userId!, topicId, ids[19]!);
    await expect(w.readMarkers.firstUnread(reader, topicId)).resolves.toEqual({ postId: ids[20], page: 2 });
  });

  test("fără marker, prima necitită e prima postare; totul citit → ultima postare", async () => {
    const { topicId, ids } = await topicWithPosts(tree.forum.id, 3);
    await expect(w.readMarkers.firstUnread(reader, topicId)).resolves.toEqual({ postId: ids[0], page: 1 });
    await w.readMarkers.markRead(reader.userId!, topicId, ids[2]!);
    await expect(w.readMarkers.firstUnread(reader, topicId)).resolves.toEqual({ postId: ids[2], page: 1 });
  });

  test("un marker mai vechi nu suprascrie unul mai nou", async () => {
    const { topicId, ids } = await topicWithPosts(tree.forum.id, 3);
    await w.readMarkers.markRead(reader.userId!, topicId, ids[2]!);
    await w.readMarkers.markRead(reader.userId!, topicId, ids[0]!);
    expect((await w.db.readMarker.findFirstOrThrow({ where: { topicId } })).lastReadPostId).toBe(ids[2]);
  });

  test("un topic e necitit până îl citești; un răspuns nou îl face din nou necitit", async () => {
    const { topicId, ids } = await topicWithPosts(tree.forum.id, 2);
    expect(await unreadIds(reader)).toEqual([topicId]);
    await w.readMarkers.markRead(reader.userId!, topicId, ids[1]!);
    expect(await unreadIds(reader)).toEqual([]);
    await w.posts.reply(w.root, { topicId, content: doc("nou") });
    expect(await unreadIds(reader)).toEqual([topicId]);
  });

  test("Review Focus #6: o postare nouă ascunsă nu face topicul necitit", async () => {
    const { topicId, ids } = await topicWithPosts(tree.forum.id, 2);
    await w.readMarkers.markRead(reader.userId!, topicId, ids[1]!);
    const hidden = await w.posts.reply(w.root, { topicId, content: doc("ascunsă") });
    await w.posts.hide(w.root, hidden.postId);
    expect(await unreadIds(reader)).toEqual([]);
  });

  test("Review Focus #6: „marchează tot citit” pe categorie acoperă și subforumurile", async () => {
    await topicWithPosts(tree.forum.id, 1);
    await topicWithPosts(tree.subforum!.id, 1);
    const [before] = await w.queries.index(reader);
    expect(before!.forums[0]!.unread).toBe(true);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 1000));
    await w.readMarkers.markForumRead(reader.userId!, tree.category.id);
    vi.useRealTimers();

    const [after] = await w.queries.index(reader);
    expect(after!.forums[0]!.unread).toBe(false);
    expect((await w.queries.forum(reader, tree.subforum!.id, { page: 1 })).topics.every((t) => !t.unread)).toBe(true);
  });

  test("vizitatorii nu au necitite; topicurile de dinaintea înregistrării sunt citite", async () => {
    await topicWithPosts(tree.forum.id, 1);
    expect(await unreadIds(w.guest)).toEqual([]);
    const newcomer = await w.actorFor(await w.createUser("Nou", "member"));
    expect(await unreadIds(newcomer)).toEqual([]);
  });

  test("autorul își urmărește automat topicul", async () => {
    const { topicId } = await topicWithPosts(tree.forum.id, 1);
    expect(await w.db.follow.count({ where: { contentType: "topic", contentId: String(topicId), userId: w.root.userId! } })).toBe(1);
    expect((await w.queries.topic(w.root, topicId, { page: 1 })).follow).toEqual({ count: 1, following: true });
  });
});
