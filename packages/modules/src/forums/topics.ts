import { GcsForbidden, GcsNotFound, GcsValidationError, type GcsActor } from "@gcs/core";
import type { Prisma } from "@gcs/db";
import { GcsForumPosting, POST_CONTENT_TYPE, WRITE_TX } from "./posting";
import { slugify } from "./slug";

export type GcsNewTopicInput = { forumId: number; title: string; content: unknown };
export type GcsNewTopicResult = { topicId: number; postId: number; pending: boolean };

/** Topicurile (specul etapei 2, §5). */
export class GcsTopicService {
  constructor(private readonly posting: GcsForumPosting) {}

  async create(actor: GcsActor, input: GcsNewTopicInput): Promise<GcsNewTopicResult> {
    const { posting } = this;
    const { db, bus, attachments } = posting.deps;

    const forum = await db.forum.findUnique({ where: { id: input.forumId } });
    if (!forum) throw new GcsNotFound();
    if (!actor.userId || !(await posting.canOnForum(actor, "forums.create", forum.id))) throw new GcsForbidden({ permission: "forums.create" });
    if (forum.type !== "FORUM" && forum.type !== "QA") throw new GcsValidationError({ forumId: "invalid_choice" });

    const title = posting.cleanTitle(input.title);
    const rendered = await posting.render(input.content);
    await posting.checkFlood(actor);
    const pending = await posting.needsApproval(actor, forum);
    const visibility = pending ? "PENDING" : "VISIBLE";
    const authorId = actor.userId;

    const result = await db.$transaction(async (tx) => {
      const topic = await tx.topic.create({ data: { forumId: forum.id, title, slug: slugify(title), authorId, visibility, lastPosterId: authorId } });
      const post = await tx.post.create({
        data: {
          topicId: topic.id,
          authorId,
          contentJson: rendered.json as Prisma.InputJsonValue,
          contentHtml: rendered.html,
          visibility,
          ip: actor.ip,
        },
      });
      await tx.topic.update({ where: { id: topic.id }, data: { firstPostId: post.id, lastPostId: post.id, lastPostAt: post.createdAt } });
      await posting.search.indexTopic(tx, topic.id);
      await posting.search.indexPost(tx, post.id, rendered.text);
      await attachments.attach(tx, rendered.attachments, { contentType: POST_CONTENT_TYPE, contentId: String(post.id), ownerId: authorId });

      let promoted = false;
      if (!pending) {
        await posting.counters.onTopicCreated(tx, { postId: post.id, topicId: topic.id, forumId: forum.id, authorId, createdAt: post.createdAt });
        promoted = await posting.promoteIfReady(tx, authorId);
      }
      return { topicId: topic.id, postId: post.id, promoted };
    }, WRITE_TX);

    await bus.emit({
      name: "topic.created",
      payload: { topicId: result.topicId, forumId: forum.id, pending },
      tags: ["forums-tree", `forum:${forum.id}`, `topic:${result.topicId}`],
    });
    if (result.promoted) await posting.emitPromoted(authorId);
    return { topicId: result.topicId, postId: result.postId, pending };
  }
}
