import type { GcsMemberDataHandler } from "@gcs/core";
import type { Prisma } from "@gcs/db";
import { POST_CONTENT_TYPE, WRITE_TX, type GcsForumPosting } from "./posting";

type Tx = Prisma.TransactionClient;
/** Rândurile actualizate într-o singură instrucțiune (anonimizarea, mutarea la unire). */
const BULK = 5000;

/**
 * Datele forumului la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri §2, §4).
 *
 * - „Păstrează conținutul”: topicurile, postările și reviziile rămân cu autorul gol („Membru șters”), IP-ul postărilor se
 *   golește, iar referințele fără cheie străină (ultimul mesaj, „editat de”, „ascuns de”) se golesc.
 * - „Șterge și conținutul”: topicurile pornite de membru se șterg cu tot cu răspunsuri, iar postările lui din alte
 *   topicuri se șterg una câte una; contoarele (topic, forum, autorii rămași), atașamentele, reacțiile pe postările șterse
 *   și evenimentele (`topic.deleted`, `post.deleted`) merg ca la ștergerea din moderare.
 * - Mereu: voturile în sondaje (cu `votesCount` corectat).
 * - Unirea: autorul devine ținta (postări, topicuri, revizii, ultimul mesaj), voturile și marcajele de citire trec fără
 *   dubluri, apoi contoarele țintei se recalculează.
 */
export function forumMemberData(posting: GcsForumPosting): GcsMemberDataHandler {
  const { db, bus, attachments } = posting.deps;
  const { counters } = posting;

  /** Voturile membrului: contorul opțiunii scade, apoi votul dispare (un lot). */
  async function dropVotes(userId: string, limit: number): Promise<number> {
    return db.$transaction(async (tx) => {
      const votes = await tx.pollVote.findMany({ where: { userId }, take: limit, select: { pollId: true, optionId: true } });
      for (const v of votes) {
        const { count } = await tx.pollVote.deleteMany({ where: { pollId: v.pollId, optionId: v.optionId, userId } });
        if (count > 0) await tx.$executeRaw`UPDATE poll_options SET "votesCount" = GREATEST(0, "votesCount" - 1) WHERE id = ${v.optionId}`;
      }
      return votes.length;
    });
  }

  /** Golește referințele fără cheie străină spre membru (ultimul mesaj, „editat de”, „ascuns de”, reviziile). */
  async function clearRefs(userId: string): Promise<number> {
    let n = 0;
    n += await db.$executeRaw`UPDATE topics SET "lastPosterId" = NULL WHERE "lastPosterId" = ${userId}`;
    n += await db.$executeRaw`UPDATE forums SET "lastPosterId" = NULL WHERE "lastPosterId" = ${userId}`;
    n += await db.$executeRaw`UPDATE posts SET "editedById" = NULL WHERE "editedById" = ${userId}`;
    n += await db.$executeRaw`UPDATE posts SET "hiddenById" = NULL WHERE "hiddenById" = ${userId}`;
    n += await db.$executeRaw`UPDATE post_revisions SET "editorId" = NULL WHERE "editorId" = ${userId}`;
    return n;
  }

  /** Ce rămâne după ștergerea unor postări: reacțiile lor și fișierele lor (după commit). */
  async function afterPostsDeleted(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.contentReaction.deleteMany({ where: { contentType: POST_CONTENT_TYPE, contentId: { in: ids } } });
    await attachments.deleteFor(POST_CONTENT_TYPE, ids);
  }

  /** Un topic pornit de membru, șters cu tot cu răspunsurile; contoarele forumului și ale autorilor rămași. */
  async function purgeTopic(topicId: number, userId: string): Promise<void> {
    const deleted = await db.$transaction(async (tx) => {
      const topic = await tx.topic.findUnique({ where: { id: topicId }, select: { forumId: true } });
      if (!topic) return null;
      const posts = await tx.post.findMany({ where: { topicId }, select: { id: true, authorId: true } });
      await tx.topic.delete({ where: { id: topicId } });
      await tx.follow.deleteMany({ where: { contentType: "topic", contentId: String(topicId) } });
      await counters.recountForum(tx, topic.forumId);
      for (const author of new Set(posts.map((p) => p.authorId).filter((id): id is string => id !== null && id !== userId))) {
        await counters.recountUser(tx, author);
      }
      return { forumId: topic.forumId, postIds: posts.map((p) => String(p.id)) };
    }, WRITE_TX);
    if (!deleted) return;
    await afterPostsDeleted(deleted.postIds);
    await bus.emit({ name: "topic.deleted", payload: { topicId, forumId: deleted.forumId, postId: null }, tags: ["forums-tree", `forum:${deleted.forumId}`, `topic:${topicId}`] });
  }

  /** O postare a membrului dintr-un topic al altcuiva; un topic rămas gol se șterge. */
  async function purgePost(postId: number): Promise<void> {
    const deleted = await db.$transaction(async (tx) => {
      const post = await tx.post.findUnique({ where: { id: postId }, select: { id: true, topicId: true, topic: { select: { forumId: true, firstPostId: true, solvedPostId: true } } } });
      if (!post) return null;
      await tx.post.delete({ where: { id: postId } });
      const remaining = await tx.post.findFirst({ where: { topicId: post.topicId }, orderBy: { id: "asc" }, select: { id: true } });
      let topicGone = false;
      if (!remaining) {
        await tx.topic.delete({ where: { id: post.topicId } });
        await tx.follow.deleteMany({ where: { contentType: "topic", contentId: String(post.topicId) } });
        topicGone = true;
      } else {
        const data: Prisma.TopicUpdateInput = {};
        if (post.topic.solvedPostId === postId) data.solvedPostId = null;
        // Prima postare a unui topic unit / despărțit poate fi a membrului: următoarea devine prima.
        if (post.topic.firstPostId === postId) data.firstPostId = remaining.id;
        if (Object.keys(data).length > 0) await tx.topic.update({ where: { id: post.topicId }, data });
        await counters.recountTopic(tx, post.topicId);
      }
      await counters.recountForum(tx, post.topic.forumId);
      return { topicId: post.topicId, forumId: post.topic.forumId, topicGone };
    }, WRITE_TX);
    if (!deleted) return;
    await afterPostsDeleted([String(postId)]);
    await bus.emit({
      name: deleted.topicGone ? "topic.deleted" : "post.deleted",
      payload: { postId, topicId: deleted.topicId, forumId: deleted.forumId },
      tags: ["forums-tree", `forum:${deleted.forumId}`, `topic:${deleted.topicId}`],
    });
  }

  /** Mută rândurile unui tabel de la sursă la țintă (un lot); `column` e una dintre coloanele de autor. */
  async function moveBatch(tx: Tx | typeof db, table: "posts" | "topics", sourceId: string, targetId: string): Promise<number> {
    if (table === "posts") {
      return tx.$executeRaw`UPDATE posts SET "authorId" = ${targetId} WHERE id IN (SELECT id FROM posts WHERE "authorId" = ${sourceId} LIMIT ${BULK})`;
    }
    return tx.$executeRaw`UPDATE topics SET "authorId" = ${targetId} WHERE id IN (SELECT id FROM topics WHERE "authorId" = ${sourceId} LIMIT ${BULK})`;
  }

  return {
    key: "forums",
    async summary(userId) {
      const [topics, posts, votes] = await Promise.all([
        db.topic.count({ where: { authorId: userId } }),
        db.post.count({ where: { authorId: userId } }),
        db.pollVote.count({ where: { userId } }),
      ]);
      return [
        { key: "forums.topics", count: topics },
        { key: "forums.posts", count: posts },
        { key: "forums.pollVotes", count: votes },
      ];
    },
    async deleteNotes(userId) {
      // Răspunsurile altor membri din topicurile lui: se șterg doar în modul „Șterge și conținutul”.
      const replies = await db.post.count({ where: { topic: { authorId: userId }, OR: [{ authorId: null }, { authorId: { not: userId } }] } });
      return replies > 0 ? [{ key: "topic_replies", level: "info", params: { count: replies } }] : [];
    },
    async erase({ userId, mode, batchSize }) {
      const votes = await dropVotes(userId, batchSize * 10);
      if (votes > 0) return votes;
      if (mode === "DELETE_CONTENT") {
        const topics = await db.topic.findMany({ where: { authorId: userId }, orderBy: { id: "asc" }, take: Math.max(1, Math.floor(batchSize / 10)), select: { id: true } });
        for (const t of topics) await purgeTopic(t.id, userId);
        if (topics.length > 0) return topics.length;
        const posts = await db.post.findMany({ where: { authorId: userId }, orderBy: { id: "asc" }, take: batchSize, select: { id: true } });
        for (const p of posts) await purgePost(p.id);
        if (posts.length > 0) return posts.length;
      } else {
        // Anonimizarea, pe loturi mari: autorul gol („Membru șters”) și fără IP.
        const posts = await db.$executeRaw`UPDATE posts SET "authorId" = NULL, ip = NULL WHERE id IN (SELECT id FROM posts WHERE "authorId" = ${userId} LIMIT ${BULK})`;
        if (posts > 0) return posts;
        const topics = await db.$executeRaw`UPDATE topics SET "authorId" = NULL WHERE id IN (SELECT id FROM topics WHERE "authorId" = ${userId} LIMIT ${BULK})`;
        if (topics > 0) return topics;
      }
      return clearRefs(userId);
    },
    async merge({ sourceId, targetId }) {
      // Voturile: dacă ținta votase deja în același sondaj, votul sursei dispare (cu contorul opțiunii).
      const votes = await db.$transaction(async (tx) => {
        const dropped = await tx.$queryRaw<{ optionId: number }[]>`
          DELETE FROM poll_votes s WHERE s."userId" = ${sourceId}
            AND EXISTS (SELECT 1 FROM poll_votes t WHERE t."userId" = ${targetId} AND t."pollId" = s."pollId")
          RETURNING "optionId"`;
        for (const d of dropped) await tx.$executeRaw`UPDATE poll_options SET "votesCount" = GREATEST(0, "votesCount" - 1) WHERE id = ${d.optionId}`;
        const moved = await tx.pollVote.updateMany({ where: { userId: sourceId }, data: { userId: targetId } });
        return dropped.length + moved.count;
      });
      if (votes > 0) return votes;
      const posts = await moveBatch(db, "posts", sourceId, targetId);
      if (posts > 0) return posts;
      const topics = await moveBatch(db, "topics", sourceId, targetId);
      if (topics > 0) return topics;
      const refs = await db.$transaction(async (tx) => {
        let n = 0;
        n += await tx.$executeRaw`UPDATE topics SET "lastPosterId" = ${targetId} WHERE "lastPosterId" = ${sourceId}`;
        n += await tx.$executeRaw`UPDATE forums SET "lastPosterId" = ${targetId} WHERE "lastPosterId" = ${sourceId}`;
        n += await tx.$executeRaw`UPDATE posts SET "editedById" = ${targetId} WHERE "editedById" = ${sourceId}`;
        n += await tx.$executeRaw`UPDATE posts SET "hiddenById" = ${targetId} WHERE "hiddenById" = ${sourceId}`;
        n += await tx.$executeRaw`UPDATE post_revisions SET "editorId" = ${targetId} WHERE "editorId" = ${sourceId}`;
        // Marcajele de citire: al țintei rămâne unde există, restul trec la ea.
        n += await tx.$executeRaw`DELETE FROM read_markers s WHERE s."userId" = ${sourceId} AND EXISTS (SELECT 1 FROM read_markers t WHERE t."userId" = ${targetId} AND t."topicId" = s."topicId")`;
        n += (await tx.readMarker.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        n += await tx.$executeRaw`DELETE FROM forum_read_marks s WHERE s."userId" = ${sourceId} AND EXISTS (SELECT 1 FROM forum_read_marks t WHERE t."userId" = ${targetId} AND t."forumId" = s."forumId")`;
        n += (await tx.forumReadMark.updateMany({ where: { userId: sourceId }, data: { userId: targetId } })).count;
        return n;
      });
      if (refs > 0) return refs;
      // Totul s-a mutat: contoarele țintei (postări, soluții) din date. Idempotent.
      await db.$transaction((tx) => counters.recountUser(tx, targetId), WRITE_TX);
      return 0;
    },
  };
}
