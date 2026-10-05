import type { Prisma } from "@gcs/db";

type Tx = Prisma.TransactionClient;

/**
 * Contoarele denormalizate ale forumului (specul etapei 2, §4). Singurul loc care le modifică.
 *
 * Contoarele unui forum sunt **ale lui** (fără subforumuri). Totalurile unei categorii și ultimul mesaj din
 * subforumuri se calculează la citire, din arborele cache-uit; astfel o postare nu blochează rândurile părinților.
 */
export class GcsForumCounters {
  /**
   * Recalculează din date contoarele și ultimul mesaj al unui forum: doar topicurile și postările vizibile.
   * E și oracolul testelor (valorile denormalizate trebuie să fie egale cu ale lui).
   */
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
}
