import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testOnMysql } from "./url";
import { testDb, truncateAll } from "./helpers";

const db = testDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function seedTopic() {
  const group = await db.group.create({ data: { key: "member", name: "Membru" } });
  const user = await db.user.create({
    data: { name: "Ștefan", nameNormalized: "stefan", email: "stefan@example.com", primaryGroupId: group.id },
  });
  const category = await db.forum.create({ data: { type: "CATEGORY", name: "General", slug: "general" } });
  const forum = await db.forum.create({ data: { type: "FORUM", parentId: category.id, name: "Discuții", slug: "discutii" } });
  const topic = await db.topic.create({
    data: { forumId: forum.id, title: "Mașina lui Ștefan", slug: "masina-lui-stefan", authorId: user.id },
  });
  const post = await db.post.create({
    data: { topicId: topic.id, authorId: user.id, contentJson: { type: "doc" }, contentHtml: "<p>Salut</p>" },
  });
  return { user, forum, topic, post };
}

describe("schema forum", () => {
  // Doar PostgreSQL: pe MySQL (ediția Lite) căutarea e FULLTEXT (testată în core), fără `gcs_ro` și `pg_trgm`.
  test.skipIf(testOnMysql())("configurația gcs_ro ignoră diacriticele și flexiunile", async () => {
    const [row] = await db.$queryRaw<{ hit: boolean; flex: boolean }[]>`
      SELECT
        to_tsvector('gcs_ro', 'Mașina lui Ștefan') @@ plainto_tsquery('gcs_ro', 'masina stefan') AS hit,
        to_tsvector('gcs_ro', 'Am cumpărat două mașini') @@ plainto_tsquery('gcs_ro', 'mașina') AS flex`;
    expect(row).toEqual({ hit: true, flex: true });
  });

  test.skipIf(testOnMysql())("cuvintele cu litere și cifre (ex. nume de jucători) ignoră și ele diacriticele", async () => {
    const [row] = await db.$queryRaw<{ numword: boolean; hyphen: boolean }[]>`
      SELECT
        to_tsvector('gcs_ro', 'Ștefan99 și Mașina2') @@ plainto_tsquery('gcs_ro', 'stefan99 masina2') AS numword,
        to_tsvector('gcs_ro', 'clan Șoim-2 România') @@ plainto_tsquery('gcs_ro', 'soim-2') AS hyphen`;
    expect(row).toEqual({ numword: true, hyphen: true });
  });

  test.skipIf(testOnMysql())("search_vector pe topicuri e indexat și interogabil", async () => {
    const { topic } = await seedTopic();
    await db.$executeRaw`
      UPDATE topics SET "searchVector" = setweight(to_tsvector('gcs_ro', title), 'A') WHERE id = ${topic.id}`;
    const hits = await db.$queryRaw<{ id: number }[]>`
      SELECT id FROM topics WHERE "searchVector" @@ plainto_tsquery('gcs_ro', 'stefan')`;
    expect(hits.map((h) => h.id)).toEqual([topic.id]);
  });

  test.skipIf(testOnMysql())("pg_trgm găsește numele de membri aproximativ", async () => {
    await seedTopic();
    const rows = await db.$queryRaw<{ name: string }[]>`
      SELECT name FROM users WHERE "nameNormalized" % 'stefn' OR "nameNormalized" LIKE 'ste%'`;
    expect(rows.map((r) => r.name)).toEqual(["Ștefan"]);
  });

  test("ștergerea unui topic șterge în cascadă postările, sondajul, tag-urile și marker-ii", async () => {
    const { user, topic, post } = await seedTopic();
    await db.postRevision.create({ data: { postId: post.id, contentJson: {}, contentHtml: "", editorId: user.id } });
    const poll = await db.poll.create({ data: { topicId: topic.id, question: "?" } });
    const option = await db.pollOption.create({ data: { pollId: poll.id, text: "Da" } });
    await db.pollVote.create({ data: { pollId: poll.id, optionId: option.id, userId: user.id } });
    const tag = await db.tag.create({ data: { name: "cs2", slug: "cs2" } });
    await db.topicTag.create({ data: { topicId: topic.id, tagId: tag.id } });
    await db.readMarker.create({ data: { userId: user.id, topicId: topic.id, lastReadPostId: post.id } });

    await db.topic.delete({ where: { id: topic.id } });

    expect(await db.post.count()).toBe(0);
    expect(await db.postRevision.count()).toBe(0);
    expect(await db.poll.count()).toBe(0);
    expect(await db.pollVote.count()).toBe(0);
    expect(await db.topicTag.count()).toBe(0);
    expect(await db.readMarker.count()).toBe(0);
    expect(await db.tag.count()).toBe(1);
  });

  test("o reacție per user per conținut și un vot per opțiune", async () => {
    const { user, topic, post } = await seedTopic();
    const like = await db.reaction.create({ data: { key: "like", label: "Like", symbol: "▲", color: "#FF6B74", weight: 1 } });
    const ref = { contentType: "forums.post", contentId: String(post.id), userId: user.id };
    await db.contentReaction.create({ data: { ...ref, reactionId: like.id } });
    await expect(db.contentReaction.create({ data: { ...ref, reactionId: like.id } })).rejects.toMatchObject({ code: "P2002" });

    const poll = await db.poll.create({ data: { topicId: topic.id, question: "?" } });
    const option = await db.pollOption.create({ data: { pollId: poll.id, text: "Da" } });
    await db.pollVote.create({ data: { pollId: poll.id, optionId: option.id, userId: user.id } });
    await expect(db.pollVote.create({ data: { pollId: poll.id, optionId: option.id, userId: user.id } })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  test("contoarele userului pornesc de la 0", async () => {
    const { user } = await seedTopic();
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      postsCount: 0,
      approvedPostsCount: 0,
      reputation: 0,
    });
  });
});
