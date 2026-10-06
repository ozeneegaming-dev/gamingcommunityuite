import { GcsForbidden, GcsNotFound, writeAudit, type GcsActor } from "@gcs/core";
import type { Post, Prisma, Topic } from "@gcs/db";
import { GcsForumPosting, POST_CONTENT_TYPE, WRITE_TX } from "./posting";
import { slugify } from "./slug";

export type GcsReplyInput = { topicId: number; content: unknown };
export type GcsReplyResult = { postId: number; pending: boolean; page: number };
export type GcsEditInput = { content: unknown; title?: string };
export type GcsRevisionView = { id: number; contentHtml: string; createdAt: Date; editor: { id: string; name: string } | null };

type Tx = Prisma.TransactionClient;
type PostWithTopic = Post & { topic: Topic };

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

    const filtered = await posting.filterContent(actor, { kind: "reply", title: null, content: input.content, forumId, topicId: topic.id, authorId: actor.userId });
    const rendered = await posting.render(filtered.content);
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
      payload: { postId: result.postId, topicId: topic.id, forumId, pending, authorId },
      tags: ["forums-tree", `forum:${forumId}`, `topic:${topic.id}`],
    });
    if (result.promoted) await posting.emitPromoted(authorId);
    return { postId: result.postId, pending, page: await posting.pageOf(topic.id, result.postId) };
  }

  /**
   * Editarea unei postări: autorul, în `forums.edit_own_minutes` de la publicare (și nu într-un topic blocat sau
   * într-o postare ascunsă), sau moderatorul cu puterea `edit`. Versiunea veche intră în `post_revisions`.
   */
  async edit(actor: GcsActor, postId: number, input: GcsEditInput): Promise<void> {
    const { posting } = this;
    const { db, bus, attachments, permissions } = posting.deps;
    const post = await this.visiblePost(actor, postId);
    const forumId = post.topic.forumId;
    const isMod = await posting.isModerator(actor, "edit", forumId);

    if (!isMod) {
      if (!actor.userId || actor.userId !== post.authorId || post.visibility === "HIDDEN" || post.topic.locked) {
        throw new GcsForbidden({ permission: "forums.edit" });
      }
      const minutes = await permissions.groupValue<number | boolean>(actor, "forums.edit_own_minutes");
      const inWindow =
        minutes === -1 || (typeof minutes === "number" && minutes > 0 && Date.now() - post.createdAt.getTime() <= minutes * 60_000);
      if (!inWindow) throw new GcsForbidden({ reason: "edit_window" });
    }

    const isFirst = post.id === post.topic.firstPostId;
    const filtered = await posting.filterContent(actor, {
      kind: "edit",
      title: isFirst && input.title !== undefined ? input.title : null,
      content: input.content,
      forumId,
      topicId: post.topicId,
      authorId: post.authorId,
    });
    const rendered = await posting.render(filtered.content);
    const title = filtered.title !== null ? posting.cleanTitle(filtered.title) : null;

    await db.$transaction(async (tx) => {
      await tx.postRevision.create({
        data: { postId, contentJson: post.contentJson as Prisma.InputJsonValue, contentHtml: post.contentHtml, editorId: actor.userId },
      });
      await tx.post.update({
        where: { id: postId },
        data: { contentJson: rendered.json as Prisma.InputJsonValue, contentHtml: rendered.html, editedAt: new Date(), editedById: actor.userId },
      });
      await posting.search.indexPost(tx, postId, rendered.text);
      if (title !== null && title !== post.topic.title) {
        await tx.topic.update({ where: { id: post.topicId }, data: { title, slug: slugify(title) } });
        await posting.search.indexTopic(tx, post.topicId);
      }
      if (post.authorId) {
        await attachments.attach(tx, rendered.attachments, { contentType: POST_CONTENT_TYPE, contentId: String(postId), ownerId: post.authorId });
      }
      if (isMod && actor.userId !== post.authorId) {
        await this.audit(tx, actor, "mod.post.edit", post, { contentHtml: post.contentHtml }, { contentHtml: rendered.html });
      }
    }, WRITE_TX);

    await bus.emit({
      name: "post.updated",
      payload: { postId, topicId: post.topicId, forumId },
      tags: [`topic:${post.topicId}`, `forum:${forumId}`, ...(title !== null ? ["forums-tree"] : [])],
    });
  }

  /** Istoricul editărilor: moderatorii; autorul doar dacă `forums.revisions_visible_to_author`. */
  async revisions(actor: GcsActor, postId: number): Promise<GcsRevisionView[]> {
    const { posting } = this;
    const post = await this.visiblePost(actor, postId);
    const isMod = await posting.isModerator(actor, "edit", post.topic.forumId);
    const isAuthor = actor.userId !== null && actor.userId === post.authorId;
    const authorMay = isAuthor && (await posting.deps.settings.get<boolean>("forums.revisions_visible_to_author"));
    if (!isMod && !authorMay) throw new GcsForbidden({ permission: "forums.revisions" });
    return posting.deps.db.postRevision.findMany({
      where: { postId },
      orderBy: { id: "desc" },
      select: { id: true, contentHtml: true, createdAt: true, editor: { select: { id: true, name: true } } },
    });
  }

  /**
   * Ascunde o postare (soft): autorul, dacă are `forums.hide_own`, sau moderatorul cu puterea `hide`.
   * Ascunderea primei postări ascunde tot topicul.
   */
  async hide(actor: GcsActor, postId: number, reason?: string): Promise<void> {
    const { posting } = this;
    const post = await this.visiblePost(actor, postId);
    const isMod = await posting.isModerator(actor, "hide", post.topic.forumId);
    if (!isMod) {
      const own = actor.userId !== null && actor.userId === post.authorId && post.visibility === "VISIBLE";
      if (!own || (await posting.deps.permissions.groupValue<boolean>(actor, "forums.hide_own")) !== true) {
        throw new GcsForbidden({ permission: "forums.hide_own" });
      }
    }
    if (post.visibility === "HIDDEN") return;
    await this.setVisibility(actor, post, "HIDDEN", { reason: reason?.slice(0, 300) ?? null, audit: isMod && actor.userId !== post.authorId });
  }

  /** Restaurează o postare ascunsă: doar moderatorul cu puterea `hide`. */
  async restore(actor: GcsActor, postId: number): Promise<void> {
    const { posting } = this;
    const post = await this.visiblePost(actor, postId);
    if (!(await posting.isModerator(actor, "hide", post.topic.forumId))) throw new GcsForbidden({ permission: "forums.restore" });
    if (post.visibility !== "HIDDEN") return;
    await this.setVisibility(actor, post, "VISIBLE", { reason: null, audit: true });
  }

  /** Ștergere definitivă: doar moderatorul cu puterea `delete`. Prima postare șterge tot topicul. */
  async delete(actor: GcsActor, postId: number): Promise<void> {
    const { posting } = this;
    const { db, bus, attachments } = posting.deps;
    const post = await this.visiblePost(actor, postId);
    const forumId = post.topic.forumId;
    if (!(await posting.isModerator(actor, "delete", forumId))) throw new GcsForbidden({ permission: "forums.delete" });
    const isFirst = post.id === post.topic.firstPostId;

    const deletedIds = await db.$transaction(async (tx) => {
      const posts = await tx.post.findMany({
        where: isFirst ? { topicId: post.topicId } : { id: postId },
        select: { id: true, authorId: true },
      });
      if (isFirst) {
        await tx.topic.delete({ where: { id: post.topicId } });
        // Urmăririle sunt generice (fără cheie străină), deci se șterg explicit.
        await tx.follow.deleteMany({ where: { contentType: "topic", contentId: String(post.topicId) } });
        await this.audit(tx, actor, "mod.topic.delete", post, { title: post.topic.title, posts: posts.length }, null);
      } else {
        await tx.post.delete({ where: { id: postId } });
        if (post.topic.solvedPostId === postId) await tx.topic.update({ where: { id: post.topicId }, data: { solvedPostId: null } });
        await posting.counters.recountTopic(tx, post.topicId);
        await this.audit(tx, actor, "mod.post.delete", post, { contentHtml: post.contentHtml }, null);
      }
      await posting.counters.recountForum(tx, forumId);
      for (const userId of new Set(posts.map((p) => p.authorId).filter((id): id is string => id !== null))) {
        await posting.counters.recountUser(tx, userId);
      }
      return posts.map((p) => String(p.id));
    }, WRITE_TX);

    await attachments.deleteFor(POST_CONTENT_TYPE, deletedIds);
    await bus.emit({
      name: isFirst ? "topic.deleted" : "post.deleted",
      payload: { postId, topicId: post.topicId, forumId },
      tags: ["forums-tree", `forum:${forumId}`, `topic:${post.topicId}`],
    });
  }

  /** Postarea cu topicul ei, dacă actorul poate citi forumul. Altfel „nu există”. */
  private async visiblePost(actor: GcsActor, postId: number): Promise<PostWithTopic> {
    const { db, permissions } = this.posting.deps;
    const post = await db.post.findUnique({ where: { id: postId }, include: { topic: true } });
    if (!post) throw new GcsNotFound();
    if (!(await permissions.can(actor, "forums.read", { type: "forum", id: String(post.topic.forumId) }))) throw new GcsNotFound();
    return post;
  }

  /** Schimbă vizibilitatea (prima postare → tot topicul) și recalculează contoarele afectate. */
  private async setVisibility(
    actor: GcsActor,
    post: PostWithTopic,
    visibility: "VISIBLE" | "HIDDEN",
    opts: { reason: string | null; audit: boolean },
  ): Promise<void> {
    const { posting } = this;
    const { db, bus } = posting.deps;
    const forumId = post.topic.forumId;
    const isFirst = post.id === post.topic.firstPostId;
    const hidden = visibility === "HIDDEN";

    await db.$transaction(async (tx) => {
      await tx.post.update({
        where: { id: post.id },
        data: { visibility, hiddenById: hidden ? actor.userId : null, hiddenReason: hidden ? opts.reason : null },
      });
      if (isFirst) await tx.topic.update({ where: { id: post.topicId }, data: { visibility } });
      await posting.counters.recountTopic(tx, post.topicId);
      await posting.counters.recountForum(tx, forumId);
      const authors = isFirst
        ? await tx.post.findMany({ where: { topicId: post.topicId, authorId: { not: null } }, distinct: ["authorId"], select: { authorId: true } })
        : [{ authorId: post.authorId }];
      for (const a of authors) if (a.authorId) await posting.counters.recountUser(tx, a.authorId);
      if (opts.audit) {
        const kind = isFirst ? "topic" : "post";
        await this.audit(tx, actor, `mod.${kind}.${hidden ? "hide" : "restore"}`, post, { visibility: post.visibility }, { visibility, reason: opts.reason });
      }
    }, WRITE_TX);

    await bus.emit({
      name: hidden ? "post.hidden" : "post.restored",
      payload: { postId: post.id, topicId: post.topicId, forumId },
      tags: ["forums-tree", `forum:${forumId}`, `topic:${post.topicId}`],
    });
  }

  private audit(tx: Tx, actor: GcsActor, action: string, post: PostWithTopic, before: unknown, after: unknown): Promise<void> {
    const isTopic = action.startsWith("mod.topic.");
    return writeAudit(tx, {
      actorId: actor.userId,
      action,
      targetType: isTopic ? "topic" : "post",
      targetId: String(isTopic ? post.topicId : post.id),
      before,
      after,
      ip: actor.ip,
    });
  }
}
