import { GcsForbidden, GcsNotFound, GcsTagService, GcsValidationError, normalizeTag, writeAudit, type GcsActor } from "@gcs/core";
import { Prisma } from "@gcs/db";
import { GcsPollService, validatePoll, type GcsPollInput } from "./polls";
import { GcsForumPosting, POST_CONTENT_TYPE, WRITE_TX } from "./posting";
import type { GcsPrefixService } from "./prefixes";
import { slugify } from "./slug";

export type GcsNewTopicInput = {
  forumId: number;
  title: string;
  content: unknown;
  prefixId?: number | null;
  tags?: string[];
  poll?: GcsPollInput | null;
};
export type GcsNewTopicResult = { topicId: number; postId: number; pending: boolean };

/** Topicurile (specul etapei 2, §5): creare (cu prefix, tag-uri, sondaj) și cel mai bun răspuns pe forumurile Q&A. */
export class GcsTopicService {
  private readonly tags = new GcsTagService();

  constructor(
    private readonly posting: GcsForumPosting,
    private readonly extras: { polls: GcsPollService; prefixes: GcsPrefixService },
  ) {}

  async create(actor: GcsActor, input: GcsNewTopicInput): Promise<GcsNewTopicResult> {
    const { posting } = this;
    const { db, bus, attachments, permissions } = posting.deps;

    const forum = await db.forum.findUnique({ where: { id: input.forumId }, include: { page: { select: { allowTopics: true } } } });
    if (!forum) throw new GcsNotFound();
    if (!actor.userId || !(await posting.canOnForum(actor, "forums.create", forum.id))) throw new GcsForbidden({ permission: "forums.create" });
    // Forum v2: și o pagină („Pagină / Anunț”) cu topicuri dedesubt.
    if (forum.type !== "FORUM" && forum.type !== "QA" && !(forum.type === "PAGE" && forum.page?.allowTopics)) throw new GcsValidationError({ forumId: "invalid_choice" });
    await posting.checkForumOptions(actor, forum, { poll: Boolean(input.poll), tags: input.tags?.length ?? 0 });

    const filtered = await posting.filterContent(actor, { kind: "topic", title: input.title, content: input.content, forumId: forum.id, topicId: null, authorId: actor.userId });
    const title = posting.cleanTitle(filtered.title ?? input.title);
    const rendered = await posting.render(filtered.content, { actor, cooldown: true, blocks: true });
    if (input.prefixId != null && !(await this.extras.prefixes.allowedFor(forum.id)).some((p) => p.id === input.prefixId)) {
      throw new GcsValidationError({ prefixId: "invalid_choice" });
    }
    const tagsValue = await permissions.groupValue<number | boolean>(actor, "forums.tags_max");
    const maxTags = tagsValue === -1 ? Number.POSITIVE_INFINITY : typeof tagsValue === "number" ? tagsValue : 0;
    // Validat înainte de flood control: o eroare de validare nu trebuie să consume pauza dintre postări.
    const slugs = new Set((input.tags ?? []).map(normalizeTag));
    if (slugs.has(null)) throw new GcsValidationError({ tags: "invalid" });
    if (slugs.size > maxTags) throw new GcsValidationError({ tags: "too_many" });
    const poll = input.poll ? validatePoll(input.poll) : null;
    if (poll && (await permissions.groupValue<boolean>(actor, "forums.poll_create")) !== true) throw new GcsForbidden({ permission: "forums.poll_create" });

    const spamModerated = await posting.checkSpam(actor, rendered, { forumId: forum.id, title });
    await posting.checkFlood(actor);
    const pending = spamModerated || (await posting.needsApproval(actor, forum));
    const visibility = pending ? "PENDING" : "VISIBLE";
    const authorId = actor.userId;

    const result = await db.$transaction(async (tx) => {
      const tags = await this.tags.ensure(tx, input.tags ?? [], maxTags);
      const topic = await tx.topic.create({
        data: {
          forumId: forum.id,
          title,
          slug: slugify(title),
          authorId,
          visibility,
          lastPosterId: authorId,
          prefixId: input.prefixId ?? null,
          tags: { create: tags.map((t) => ({ tagId: t.id })) },
        },
      });
      const post = await tx.post.create({
        data: {
          topicId: topic.id,
          authorId,
          contentJson: rendered.json as Prisma.InputJsonValue,
          contentHtml: rendered.html,
          hiddenParts: rendered.hiddenParts.length > 0 ? (rendered.hiddenParts as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          visibility,
          ip: actor.ip,
        },
      });
      await tx.topic.update({ where: { id: topic.id }, data: { firstPostId: post.id, lastPostId: post.id, lastPostAt: post.createdAt } });
      if (poll) await this.extras.polls.createInTx(tx, topic.id, poll);
      await posting.search.indexTopic(tx, topic.id);
      await posting.search.indexPost(tx, post.id, rendered.text);
      await attachments.attach(tx, rendered.attachments, { contentType: POST_CONTENT_TYPE, contentId: String(post.id), ownerId: authorId });
      // Autorul își urmărește automat topicul.
      await tx.follow.createMany({ data: [{ userId: authorId, contentType: "topic", contentId: String(topic.id) }], skipDuplicates: true });

      let promoted = false;
      if (!pending) {
        await posting.counters.onTopicCreated(tx, { postId: post.id, topicId: topic.id, forumId: forum.id, authorId, createdAt: post.createdAt, countPosts: forum.countPosts });
        promoted = await posting.promoteIfReady(tx, authorId);
      }
      return { topicId: topic.id, postId: post.id, promoted };
    }, WRITE_TX);
    await posting.markGroupMentions(actor, rendered);

    await bus.emit({
      name: "topic.created",
      payload: { topicId: result.topicId, postId: result.postId, forumId: forum.id, pending, authorId },
      tags: ["forums-tree", `forum:${forum.id}`, `topic:${result.topicId}`],
    });
    if (result.promoted) await posting.emitPromoted(authorId);
    return { topicId: result.topicId, postId: result.postId, pending };
  }

  /**
   * Cel mai bun răspuns pe un forum Q&A (spec §7): autorul topicului sau un moderator cu puterea `edit`.
   * `postId: null` anulează marcajul. Postarea trebuie să fie un răspuns vizibil din topic.
   */
  async markSolved(actor: GcsActor, topicId: number, postId: number | null): Promise<void> {
    const { posting } = this;
    const { db, bus, permissions } = posting.deps;
    const topic = await db.topic.findUnique({ where: { id: topicId }, include: { forum: { select: { type: true } } } });
    if (!topic || !(await permissions.can(actor, "forums.read", { type: "forum", id: String(topic.forumId) }))) throw new GcsNotFound();
    if (topic.forum.type !== "QA") throw new GcsValidationError({ forum: "not_qa" });
    const isMod = await posting.isModerator(actor, "edit", topic.forumId);
    if (!isMod && (actor.userId === null || actor.userId !== topic.authorId)) throw new GcsForbidden({ permission: "forums.solve" });

    if (postId !== null) {
      const post = await db.post.findUnique({ where: { id: postId }, select: { topicId: true, visibility: true } });
      if (!post || post.topicId !== topicId || post.visibility !== "VISIBLE" || postId === topic.firstPostId) {
        throw new GcsValidationError({ postId: "invalid_choice" });
      }
    }
    // Autorii răspunsului marcat înainte și acum: `solutionsCount` se recalculează pentru amândoi (etapa 3).
    const solvers = await db.post.findMany({
      where: { id: { in: [topic.solvedPostId, postId].filter((id): id is number => id !== null) } },
      select: { id: true, authorId: true },
    });
    const solverOf = (id: number | null) => solvers.find((p) => p.id === id)?.authorId ?? null;
    await db.$transaction(async (tx) => {
      await tx.topic.update({ where: { id: topicId }, data: { solvedPostId: postId } });
      for (const userId of new Set(solvers.map((p) => p.authorId).filter((id): id is string => id !== null))) {
        await posting.counters.recountUser(tx, userId);
      }
      if (isMod && actor.userId !== topic.authorId) {
        await writeAudit(tx, {
          actorId: actor.userId,
          action: "mod.topic.solved",
          targetType: "topic",
          targetId: String(topicId),
          before: { solvedPostId: topic.solvedPostId },
          after: { solvedPostId: postId },
          ip: actor.ip,
        });
      }
    });
    await bus.emit({ name: "topic.updated", payload: { topicId }, tags: [`topic:${topicId}`, `forum:${topic.forumId}`] });
    if (topic.solvedPostId !== postId) {
      await bus.emit({
        name: "topic.solved",
        payload: { topicId, postId, solverId: solverOf(postId), previousSolverId: solverOf(topic.solvedPostId), actorId: actor.userId },
        tags: [`topic:${topicId}`],
      });
    }
  }
}
