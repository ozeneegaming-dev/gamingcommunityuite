import type { Prisma } from "@gcs/db";

type Tx = Prisma.TransactionClient;

/** O postare tocmai publicată (vizibilă). */
export type GcsVisiblePost = { postId: number; topicId: number; forumId: number; authorId: string | null; createdAt: Date };

/**
 * Contoarele denormalizate ale forumului (specul etapei 2, §4). Singurul loc care le modifică.
 *
 * - Contoarele unui forum sunt **ale lui** (fără subforumuri). Totalurile unei categorii și ultimul mesaj din
 *   subforumuri se calculează la citire, din arborele cache-uit; astfel o postare nu blochează rândurile părinților.
 * - Un forum numără doar topicurile și postările vizibile, din topicuri vizibile.
 * - `users.postsCount` = postările vizibile din topicuri vizibile; `approvedPostsCount` = postările care nu (mai) așteaptă aprobare.
 *
 * Operațiile frecvente (topic nou, răspuns) fac incrementări; cele rare (ascundere, mutare, unire) recalculează din date.
 */
export class GcsForumCounters {
  /** Un topic nou, vizibil, cu prima lui postare. */
  async onTopicCreated(tx: Tx, post: GcsVisiblePost): Promise<void> {
    await tx.$executeRaw`UPDATE forums SET "topicsCount" = "topicsCount" + 1 WHERE id = ${post.forumId}`;
    await this.forumPost(tx, post);
    await this.userPost(tx, post.authorId, true);
  }

  /**
   * Un răspuns vizibil. Apelantul ține lock-ul pe topic (`SELECT … FOR UPDATE`), deci postarea e cea mai nouă din topic.
   * Forumul și contorul de postări ale userului se schimbă doar dacă topicul e vizibil.
   */
  async onReply(tx: Tx, post: GcsVisiblePost, topicVisible: boolean): Promise<void> {
    await tx.topic.update({
      where: { id: post.topicId },
      data: { repliesCount: { increment: 1 }, lastPostId: post.postId, lastPostAt: post.createdAt, lastPosterId: post.authorId },
    });
    if (topicVisible) await this.forumPost(tx, post);
    await this.userPost(tx, post.authorId, topicVisible);
  }

  /**
   * +1 postare în forum; ultimul mesaj se schimbă doar dacă postarea e mai nouă (tranzacțiile pot face commit în altă ordine).
   * Data se ia din `posts` în SQL: un `Date` trimis ca parametru ar fi convertit în fusul orar al sesiunii (coloana e `timestamp`).
   */
  private async forumPost(tx: Tx, p: GcsVisiblePost): Promise<void> {
    await tx.$executeRaw`
      UPDATE forums SET
        "postsCount" = "postsCount" + 1,
        "lastPostAt" = CASE WHEN "lastPostId" IS NULL OR "lastPostId" < ${p.postId}
          THEN (SELECT "createdAt" FROM posts WHERE id = ${p.postId}) ELSE "lastPostAt" END,
        "lastTopicId" = CASE WHEN "lastPostId" IS NULL OR "lastPostId" < ${p.postId} THEN ${p.topicId} ELSE "lastTopicId" END,
        "lastPosterId" = CASE WHEN "lastPostId" IS NULL OR "lastPostId" < ${p.postId} THEN ${p.authorId} ELSE "lastPosterId" END,
        "lastPostId" = CASE WHEN "lastPostId" IS NULL OR "lastPostId" < ${p.postId} THEN ${p.postId} ELSE "lastPostId" END
      WHERE id = ${p.forumId}`;
  }

  private async userPost(tx: Tx, userId: string | null, countsAsPost: boolean): Promise<void> {
    if (!userId) return;
    await tx.user.update({
      where: { id: userId },
      data: { approvedPostsCount: { increment: 1 }, ...(countsAsPost ? { postsCount: { increment: 1 } } : {}) },
    });
  }

  /** Contoarele unui topic, din date: răspunsurile vizibile și ultima postare vizibilă. */
  async recountTopic(tx: Tx, topicId: number): Promise<void> {
    const topic = await tx.topic.findUnique({ where: { id: topicId }, select: { firstPostId: true } });
    if (!topic) return;
    const [visible, last, first] = await Promise.all([
      tx.post.count({ where: { topicId, visibility: "VISIBLE" } }),
      tx.post.findFirst({ where: { topicId, visibility: "VISIBLE" }, orderBy: { id: "desc" }, select: { id: true, authorId: true, createdAt: true } }),
      topic.firstPostId === null ? null : tx.post.findUnique({ where: { id: topic.firstPostId }, select: { id: true, authorId: true, createdAt: true, visibility: true } }),
    ]);
    const ref = last ?? first;
    await tx.topic.update({
      where: { id: topicId },
      data: {
        repliesCount: Math.max(0, visible - (first?.visibility === "VISIBLE" ? 1 : 0)),
        lastPostId: ref?.id ?? null,
        lastPosterId: ref?.authorId ?? null,
        ...(ref ? { lastPostAt: ref.createdAt } : {}),
      },
    });
  }

  /** Contoarele și ultimul mesaj ale unui forum, din date. */
  async recountForum(tx: Tx, forumId: number): Promise<void> {
    const [topicsCount, postsCount, last] = await Promise.all([
      tx.topic.count({ where: { forumId, visibility: "VISIBLE" } }),
      tx.post.count({ where: { visibility: "VISIBLE", topic: { forumId, visibility: "VISIBLE" } } }),
      tx.post.findFirst({
        where: { visibility: "VISIBLE", topic: { forumId, visibility: "VISIBLE" } },
        orderBy: { id: "desc" },
        select: { id: true, topicId: true, authorId: true, createdAt: true },
      }),
    ]);
    await tx.forum.update({
      where: { id: forumId },
      data: {
        topicsCount,
        postsCount,
        lastPostId: last?.id ?? null,
        lastTopicId: last?.topicId ?? null,
        lastPosterId: last?.authorId ?? null,
        lastPostAt: last?.createdAt ?? null,
      },
    });
  }

  /** Contoarele unui user, din date. */
  async recountUser(tx: Tx, userId: string): Promise<void> {
    const [postsCount, approvedPostsCount, solutions] = await Promise.all([
      tx.post.count({ where: { authorId: userId, visibility: "VISIBLE", topic: { visibility: "VISIBLE" } } }),
      tx.post.count({ where: { authorId: userId, visibility: { not: "PENDING" } } }),
      // Răspunsurile marcate „cel mai bun răspuns” (etapa 3: regula Top helper).
      tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM topics t JOIN posts p ON p.id = t."solvedPostId" WHERE p."authorId" = ${userId}`,
    ]);
    await tx.user.update({ where: { id: userId }, data: { postsCount, approvedPostsCount, solutionsCount: solutions[0]?.n ?? 0 } });
  }

  /** Recalculează tot (sau doar forumurile date, cu topicurile și autorii lor): unealtă de reparare și oracolul testelor. */
  async recountAll(tx: Tx, forumIds?: number[]): Promise<void> {
    const forums = await tx.forum.findMany({ where: forumIds ? { id: { in: forumIds } } : {}, select: { id: true } });
    const ids = forums.map((f) => f.id);
    const topics = await tx.topic.findMany({ where: { forumId: { in: ids } }, select: { id: true } });
    for (const t of topics) await this.recountTopic(tx, t.id);
    for (const id of ids) await this.recountForum(tx, id);
    const authors = await tx.post.findMany({
      where: { topic: { forumId: { in: ids } }, authorId: { not: null } },
      distinct: ["authorId"],
      select: { authorId: true },
    });
    for (const a of authors) await this.recountUser(tx, a.authorId!);
  }
}
