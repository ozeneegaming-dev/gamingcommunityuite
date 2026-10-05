import { GcsForbidden, GcsNotFound, type GcsActor } from "@gcs/core";
import type { Prisma } from "@gcs/db";
import { GcsForumPosting, POST_CONTENT_TYPE, WRITE_TX } from "./posting";

export type GcsReplyInput = { topicId: number; content: unknown };
export type GcsReplyResult = { postId: number; pending: boolean; page: number };

/** Postările (specul etapei 2, §5). */
export class GcsPostService {
  constructor(private readonly posting: GcsForumPosting) {}

  async reply(actor: GcsActor, input: GcsReplyInput): Promise<GcsReplyResult> {
    const { posting } = this;
    const { db, bus, attachments } = posting.deps;

    const topic = await db.topic.findUnique({ where: { id: input.topicId }, include: { forum: true } });
    if (!topic) throw new GcsNotFound();
    const forumId = topic.forumId;
    if (!actor.userId || !(await posting.canOnForum(actor, "forums.reply", forumId))) throw new GcsForbidden({ permission: "forums.reply" });
    // Un topic în așteptare sau ascuns primește răspunsuri doar de la moderatori.
    if (topic.visibility !== "VISIBLE" && !(await posting.isModerator(actor, "approve", forumId))) throw new GcsForbidden({ reason: "not_visible" });
    if (topic.locked && !(await posting.isModerator(actor, "lock", forumId))) throw new GcsForbidden({ reason: "locked" });

    const rendered = await posting.render(input.content);
    await posting.checkFlood(actor);
    const pending = await posting.needsApproval(actor, topic.forum);
    const authorId = actor.userId;

    const result = await db.$transaction(async (tx) => {
      // Lock pe topic: răspunsurile simultane se serializează, deci ultima postare e mereu cea cu id-ul cel mai mare.
      const [locked] = await tx.$queryRaw<{ visibility: string }[]>`SELECT visibility FROM topics WHERE id = ${topic.id} FOR UPDATE`;
      if (!locked) throw new GcsNotFound();
      const post = await tx.post.create({
        data: {
          topicId: topic.id,
          authorId,
          contentJson: rendered.json as Prisma.InputJsonValue,
          contentHtml: rendered.html,
          visibility: pending ? "PENDING" : "VISIBLE",
          ip: actor.ip,
        },
      });
      await posting.search.indexPost(tx, post.id, rendered.text);
      await attachments.attach(tx, rendered.attachments, { contentType: POST_CONTENT_TYPE, contentId: String(post.id), ownerId: authorId });

      let promoted = false;
      if (!pending) {
        await posting.counters.onReply(
          tx,
          { postId: post.id, topicId: topic.id, forumId, authorId, createdAt: post.createdAt },
          locked.visibility === "VISIBLE",
        );
        promoted = await posting.promoteIfReady(tx, authorId);
      }
      return { postId: post.id, promoted };
    }, WRITE_TX);

    await bus.emit({
      name: "post.created",
      payload: { postId: result.postId, topicId: topic.id, forumId, pending },
      tags: ["forums-tree", `forum:${forumId}`, `topic:${topic.id}`],
    });
    if (result.promoted) await posting.emitPromoted(authorId);
    return { postId: result.postId, pending, page: await posting.pageOf(topic.id, result.postId) };
  }
}
