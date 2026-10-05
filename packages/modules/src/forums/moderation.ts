import {
  GcsForbidden,
  GcsNotFound,
  GcsValidationError,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsReportService,
} from "@gcs/core";
import type { ModSavedAction, Prisma } from "@gcs/db";
import { POST_CONTENT_TYPE, WRITE_TX, type GcsForumPosting } from "./posting";
import type { GcsPostService } from "./posts";
import { toRef as userToRef, userRefSelect, type GcsUserRef } from "./queries";
import { slugify } from "./slug";

export const SAVED_ACTIONS_ACP_SECTION = "community.saved_actions";

/** Pașii unei acțiuni salvate (macro de moderare). */
export type GcsSavedActionSteps = { lock?: boolean; pin?: boolean; feature?: boolean; moveTo?: number; prefixId?: number | null; reply?: string };
export type GcsSavedActionInput = { id?: number; name: string; forumIds: number[]; actions: GcsSavedActionSteps };

export type GcsQueueItem = {
  postId: number;
  topicId: number;
  topicTitle: string;
  topicSlug: string;
  forumId: number;
  forumName: string;
  /** Prima postare a unui topic în așteptare (aprobarea publică tot topicul). */
  isTopic: boolean;
  author: GcsUserRef | null;
  createdAt: string;
  html: string;
};
export type GcsQueueReport = {
  contentType: string;
  contentId: string;
  topicId: number;
  topicTitle: string;
  topicSlug: string;
  forumId: number;
  html: string;
  reasons: { id: string; reason: string; reporter: GcsUserRef | null; createdAt: string }[];
};

type Tx = Prisma.TransactionClient;
const QUEUE_PAGE = 50;
const userRef = userRefSelect;
const toRef = (u: Parameters<typeof userToRef>[0] | null): GcsUserRef | null => (u ? userToRef(u) : null);

/**
 * Moderarea forumului (spec §7): acțiuni pe topicuri, mutare, unire, despărțire, coada de aprobare, rapoarte și
 * acțiuni salvate. Fiecare acțiune cere puterea pe forumul topicului (sau `forums.moderate_all`) și intră în jurnal.
 */
export class GcsForumModerationService {
  constructor(
    private readonly posting: GcsForumPosting,
    private readonly deps: { posts: GcsPostService; reports: GcsReportService; acp: GcsAcpRoleService },
  ) {}

  setPinned(actor: GcsActor, topicIds: number[], value: boolean): Promise<void> {
    return this.setFlag(actor, topicIds, "pinned", "pin", value);
  }

  setLocked(actor: GcsActor, topicIds: number[], value: boolean): Promise<void> {
    return this.setFlag(actor, topicIds, "locked", "lock", value);
  }

  setFeatured(actor: GcsActor, topicIds: number[], value: boolean): Promise<void> {
    return this.setFlag(actor, topicIds, "featured", "feature", value);
  }

  /** Mută topicurile într-un forum care poate găzdui topicuri. */
  async move(actor: GcsActor, topicIds: number[], toForumId: number): Promise<void> {
    const { db } = this.posting.deps;
    const topics = await this.topicsWithPower(actor, topicIds, "move");
    await this.assertTarget(actor, toForumId);
    const forums = new Set([toForumId, ...topics.map((t) => t.forumId)]);

    await db.$transaction(async (tx) => {
      await tx.topic.updateMany({ where: { id: { in: topics.map((t) => t.id) } }, data: { forumId: toForumId } });
      for (const id of forums) await this.posting.counters.recountForum(tx, id);
      for (const t of topics) await this.audit(tx, actor, "mod.topic.move", t.id, { forumId: t.forumId }, { forumId: toForumId });
    }, WRITE_TX);
    await this.changed(topics.map((t) => t.id), forums);
  }

  /** Unește topicurile sursă în topicul țintă: postările se mută, ordinea rămâne cronologică, sursele se șterg. */
  async merge(actor: GcsActor, sourceTopicIds: number[], targetTopicId: number): Promise<void> {
    const { db } = this.posting.deps;
    const sources = sourceTopicIds.filter((id) => id !== targetTopicId);
    if (sources.length === 0) throw new GcsValidationError({ topics: "invalid_choice" });
    const topics = await this.topicsWithPower(actor, [...sources, targetTopicId], "merge");
    const forums = new Set(topics.map((t) => t.forumId));

    await db.$transaction(async (tx) => {
      await tx.post.updateMany({ where: { topicId: { in: sources } }, data: { topicId: targetTopicId } });
      // Urmăritorii surselor urmăresc de acum topicul țintă.
      const followers = await tx.follow.findMany({ where: { contentType: "topic", contentId: { in: sources.map(String) } }, select: { userId: true } });
      await tx.follow.createMany({
        data: followers.map((f) => ({ userId: f.userId, contentType: "topic", contentId: String(targetTopicId) })),
        skipDuplicates: true,
      });
      await tx.follow.deleteMany({ where: { contentType: "topic", contentId: { in: sources.map(String) } } });
      await tx.topic.deleteMany({ where: { id: { in: sources } } });
      const first = await tx.post.findFirst({ where: { topicId: targetTopicId }, orderBy: { id: "asc" }, select: { id: true } });
      await tx.topic.update({ where: { id: targetTopicId }, data: { firstPostId: first?.id ?? null } });
      await this.recount(tx, [targetTopicId], forums);
      await this.audit(tx, actor, "mod.topic.merge", targetTopicId, { sources }, { firstPostId: first?.id ?? null });
    }, WRITE_TX);
    await this.changed([targetTopicId, ...sources], forums);
  }

  /** Mută postările date într-un topic nou. Prima dintre ele (cea mai veche) devine prima postare. Întoarce id-ul topicului nou. */
  async split(actor: GcsActor, postIds: number[], input: { title: string; forumId: number }): Promise<number> {
    const { db } = this.posting.deps;
    const ids = [...new Set(postIds)].sort((a, b) => a - b);
    const posts = await db.post.findMany({ where: { id: { in: ids } }, select: { id: true, topicId: true, authorId: true } });
    const topicId = posts[0]?.topicId;
    if (posts.length !== ids.length || topicId === undefined || posts.some((p) => p.topicId !== topicId)) {
      throw new GcsValidationError({ postIds: "invalid_choice" });
    }
    const [source] = await this.topicsWithPower(actor, [topicId], "split");
    await this.assertTarget(actor, input.forumId);
    const title = this.posting.cleanTitle(input.title);
    if ((await db.post.count({ where: { topicId } })) === ids.length) throw new GcsValidationError({ postIds: "all_posts" });
    const forums = new Set([source!.forumId, input.forumId]);
    const author = posts.find((p) => p.id === ids[0])!.authorId;

    const created = await db.$transaction(async (tx) => {
      const topic = await tx.topic.create({ data: { forumId: input.forumId, title, slug: slugify(title), authorId: author, firstPostId: ids[0] } });
      await tx.post.updateMany({ where: { id: { in: ids } }, data: { topicId: topic.id } });
      if (source!.firstPostId !== null && ids.includes(source!.firstPostId)) {
        const first = await tx.post.findFirst({ where: { topicId }, orderBy: { id: "asc" }, select: { id: true } });
        await tx.topic.update({ where: { id: topicId }, data: { firstPostId: first?.id ?? null } });
      }
      if (source!.solvedPostId !== null && ids.includes(source!.solvedPostId)) await tx.topic.update({ where: { id: topicId }, data: { solvedPostId: null } });
      await this.posting.search.indexTopic(tx, topic.id);
      await this.recount(tx, [topicId, topic.id], forums);
      await this.audit(tx, actor, "mod.topic.split", topicId, { postIds: ids }, { newTopicId: topic.id, forumId: input.forumId });
      return topic.id;
    }, WRITE_TX);
    await this.changed([topicId, created], forums);
    return created;
  }

  /** Aprobă postări în așteptare; prima postare a unui topic în așteptare publică tot topicul. */
  async approve(actor: GcsActor, postIds: number[]): Promise<void> {
    const { db } = this.posting.deps;
    const posts = await db.post.findMany({
      where: { id: { in: postIds }, visibility: "PENDING" },
      include: { topic: { select: { id: true, forumId: true, firstPostId: true, visibility: true } } },
    });
    for (const forumId of new Set(posts.map((p) => p.topic.forumId))) await this.assertPower(actor, "approve", forumId);
    if (posts.length === 0) return;
    const forums = new Set(posts.map((p) => p.topic.forumId));
    const authors = [...new Set(posts.map((p) => p.authorId).filter((id): id is string => id !== null))];

    const promoted = await db.$transaction(async (tx) => {
      for (const p of posts) {
        await tx.post.update({ where: { id: p.id }, data: { visibility: "VISIBLE" } });
        if (p.id === p.topic.firstPostId && p.topic.visibility === "PENDING") {
          await tx.topic.update({ where: { id: p.topicId }, data: { visibility: "VISIBLE" } });
        }
        await this.audit(tx, actor, "mod.post.approve", p.id, { visibility: "PENDING" }, { visibility: "VISIBLE" }, "post");
      }
      await this.recount(tx, [...new Set(posts.map((p) => p.topicId))], forums, authors);
      const out: string[] = [];
      for (const userId of authors) if (await this.posting.promoteIfReady(tx, userId)) out.push(userId);
      return out;
    }, WRITE_TX);

    await this.changed([...new Set(posts.map((p) => p.topicId))], forums);
    await this.posting.deps.bus.emit({
      name: "post.approved",
      payload: { posts: posts.map((p) => ({ postId: p.id, authorId: p.authorId })) },
      tags: authors.map((id) => `user:${id}`),
    });
    for (const userId of promoted) await this.posting.emitPromoted(userId);
  }

  /** Respinge postări (le ascunde, cu motiv). */
  async reject(actor: GcsActor, postIds: number[], reason: string): Promise<void> {
    for (const id of postIds) await this.deps.posts.hide(actor, id, reason);
  }

  /** Coada de moderare: postările în așteptare și rapoartele deschise din forumurile actorului. */
  async queue(actor: GcsActor, opts: { page: number }): Promise<{ pending: GcsQueueItem[]; reports: GcsQueueReport[] }> {
    const { db } = this.posting.deps;
    const approveIn = await this.moderatedForums(actor, "approve");
    const reportIn = await this.moderatedForums(actor, "hide");
    const pendingWhere: Prisma.PostWhereInput = { visibility: "PENDING", ...(approveIn ? { topic: { forumId: { in: approveIn } } } : {}) };

    const [pending, openReports] = await Promise.all([
      db.post.findMany({
        where: pendingWhere,
        orderBy: { id: "asc" },
        skip: (Math.max(1, opts.page) - 1) * QUEUE_PAGE,
        take: QUEUE_PAGE,
        include: {
          author: { select: userRef },
          topic: { select: { id: true, title: true, slug: true, forumId: true, firstPostId: true, forum: { select: { name: true } } } },
        },
      }),
      db.report.findMany({
        where: { status: "OPEN", contentType: POST_CONTENT_TYPE },
        orderBy: { createdAt: "asc" },
        include: { reporter: { select: userRef } },
      }),
    ]);

    const reportedIds = [...new Set(openReports.map((r) => Number(r.contentId)).filter(Number.isSafeInteger))];
    const reportedPosts = reportedIds.length
      ? await db.post.findMany({
          where: { id: { in: reportedIds }, ...(reportIn ? { topic: { forumId: { in: reportIn } } } : {}) },
          select: { id: true, contentHtml: true, topic: { select: { id: true, title: true, slug: true, forumId: true } } },
        })
      : [];
    const reports: GcsQueueReport[] = reportedPosts.map((p) => ({
      contentType: POST_CONTENT_TYPE,
      contentId: String(p.id),
      topicId: p.topic.id,
      topicTitle: p.topic.title,
      topicSlug: p.topic.slug,
      forumId: p.topic.forumId,
      html: p.contentHtml,
      reasons: openReports
        .filter((r) => r.contentId === String(p.id))
        .map((r) => ({ id: r.id, reason: r.reason, reporter: toRef(r.reporter), createdAt: r.createdAt.toISOString() })),
    }));

    return {
      pending: pending.map((p) => ({
        postId: p.id,
        topicId: p.topic.id,
        topicTitle: p.topic.title,
        topicSlug: p.topic.slug,
        forumId: p.topic.forumId,
        forumName: p.topic.forum.name,
        isTopic: p.id === p.topic.firstPostId,
        author: toRef(p.author),
        createdAt: p.createdAt.toISOString(),
        html: p.contentHtml,
      })),
      reports,
    };
  }

  /** Câte elemente așteaptă în coadă (widgetul din dashboard). */
  async queueCount(actor: GcsActor): Promise<{ pending: number; reports: number }> {
    const { db } = this.posting.deps;
    const approveIn = await this.moderatedForums(actor, "approve");
    const reportIn = await this.moderatedForums(actor, "hide");
    const pending = await db.post.count({ where: { visibility: "PENDING", ...(approveIn ? { topic: { forumId: { in: approveIn } } } : {}) } });
    const open = await db.report.findMany({ where: { status: "OPEN", contentType: POST_CONTENT_TYPE }, distinct: ["contentId"], select: { contentId: true } });
    const ids = open.map((r) => Number(r.contentId)).filter(Number.isSafeInteger);
    const reports = ids.length ? await db.post.count({ where: { id: { in: ids }, ...(reportIn ? { topic: { forumId: { in: reportIn } } } : {}) } }) : 0;
    return { pending, reports };
  }

  listActions(): Promise<ModSavedAction[]> {
    return this.posting.deps.db.modSavedAction.findMany({ orderBy: { name: "asc" } });
  }

  async saveAction(actor: GcsActor, input: GcsSavedActionInput): Promise<ModSavedAction> {
    await this.deps.acp.assert(actor, SAVED_ACTIONS_ACP_SECTION, "edit");
    const { db } = this.posting.deps;
    const name = input.name.trim();
    const a = input.actions;
    const errors: Record<string, string> = {};
    if (!name || name.length > 60) errors.name = "required";
    const steps = Object.entries(a).filter(([, v]) => v !== undefined);
    if (steps.length === 0) errors.actions = "required";
    if (a.reply !== undefined && (!a.reply.trim() || a.reply.length > 2000)) errors.reply = "invalid";
    if (a.moveTo !== undefined) {
      const f = await db.forum.findUnique({ where: { id: a.moveTo }, select: { type: true } });
      if (!f || (f.type !== "FORUM" && f.type !== "QA")) errors.moveTo = "invalid_choice";
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    const data = { name, forumIds: [...new Set(input.forumIds)], actions: a as Prisma.InputJsonValue };
    const row = input.id !== undefined ? await db.modSavedAction.update({ where: { id: input.id }, data }) : await db.modSavedAction.create({ data });
    await writeAudit(db, { actorId: actor.userId, action: "mod.saved_action.save", targetType: "saved_action", targetId: String(row.id), after: row, ip: actor.ip });
    return row;
  }

  async deleteAction(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, SAVED_ACTIONS_ACP_SECTION, "delete");
    await this.posting.deps.db.modSavedAction.deleteMany({ where: { id } });
  }

  /** Aplică o acțiune salvată pe topicuri, toți pașii într-o singură tranzacție. */
  async applySavedAction(actor: GcsActor, actionId: number, topicIds: number[]): Promise<void> {
    const { posting } = this;
    const { db } = posting.deps;
    const action = await db.modSavedAction.findUnique({ where: { id: actionId } });
    if (!action) throw new GcsNotFound();
    const steps = action.actions as GcsSavedActionSteps;
    const topics = await db.topic.findMany({ where: { id: { in: topicIds } } });
    if (topics.length === 0) throw new GcsNotFound();

    const powers: string[] = [];
    if (steps.lock !== undefined) powers.push("lock");
    if (steps.pin !== undefined) powers.push("pin");
    if (steps.feature !== undefined) powers.push("feature");
    if (steps.moveTo !== undefined) powers.push("move");
    if (steps.prefixId !== undefined) powers.push("edit");
    for (const t of topics) {
      if (action.forumIds.length > 0 && !action.forumIds.includes(t.forumId)) throw new GcsValidationError({ actionId: "forum" });
      for (const power of powers.length > 0 ? powers : ["edit"]) await this.assertPower(actor, power, t.forumId);
    }
    if (steps.moveTo !== undefined) await this.assertTarget(actor, steps.moveTo);
    const reply = steps.reply ? await posting.render(textDoc(steps.reply)) : null;
    const forums = new Set([...topics.map((t) => t.forumId), ...(steps.moveTo !== undefined ? [steps.moveTo] : [])]);

    await db.$transaction(async (tx) => {
      for (const t of topics) {
        await tx.topic.update({
          where: { id: t.id },
          data: {
            ...(steps.lock !== undefined ? { locked: steps.lock } : {}),
            ...(steps.pin !== undefined ? { pinned: steps.pin } : {}),
            ...(steps.feature !== undefined ? { featured: steps.feature } : {}),
            ...(steps.prefixId !== undefined ? { prefixId: steps.prefixId } : {}),
            ...(steps.moveTo !== undefined ? { forumId: steps.moveTo } : {}),
          },
        });
        if (reply) {
          const post = await tx.post.create({
            data: { topicId: t.id, authorId: actor.userId, contentJson: reply.json as Prisma.InputJsonValue, contentHtml: reply.html, ip: actor.ip },
          });
          await posting.search.indexPost(tx, post.id, reply.text);
        }
        await this.audit(tx, actor, "mod.topic.saved_action", t.id, null, { actionId, name: action.name });
      }
      await this.recount(tx, topics.map((t) => t.id), forums, actor.userId ? [actor.userId] : []);
    }, WRITE_TX);
    await this.changed(topics.map((t) => t.id), forums);
  }

  private async setFlag(actor: GcsActor, topicIds: number[], field: "pinned" | "locked" | "featured", power: string, value: boolean): Promise<void> {
    const { db } = this.posting.deps;
    const topics = await this.topicsWithPower(actor, topicIds, power);
    await db.$transaction(async (tx) => {
      await tx.topic.updateMany({ where: { id: { in: topics.map((t) => t.id) } }, data: { [field]: value } });
      for (const t of topics) await this.audit(tx, actor, `mod.topic.${power}`, t.id, { [field]: t[field] }, { [field]: value });
    });
    await this.changed(topics.map((t) => t.id), new Set(topics.map((t) => t.forumId)));
  }

  /** Topicurile (toate trebuie să existe), după ce verifică puterea pe forumul fiecăruia. */
  private async topicsWithPower(actor: GcsActor, topicIds: number[], power: string) {
    const ids = [...new Set(topicIds)];
    const topics = await this.posting.deps.db.topic.findMany({ where: { id: { in: ids } } });
    if (topics.length !== ids.length || ids.length === 0) throw new GcsNotFound();
    for (const forumId of new Set(topics.map((t) => t.forumId))) await this.assertPower(actor, power, forumId);
    return topics;
  }

  private async assertPower(actor: GcsActor, power: string, forumId: number): Promise<void> {
    if (!(await this.posting.isModerator(actor, power, forumId))) throw new GcsForbidden({ power });
  }

  /** Forumul destinație trebuie să găzduiască topicuri și să fie vizibil actorului. */
  private async assertTarget(actor: GcsActor, forumId: number): Promise<void> {
    const forum = await this.posting.deps.db.forum.findUnique({ where: { id: forumId }, select: { type: true } });
    if (!forum || (forum.type !== "FORUM" && forum.type !== "QA")) throw new GcsValidationError({ forumId: "invalid_choice" });
    if (!(await this.posting.deps.permissions.can(actor, "forums.view", { type: "forum", id: String(forumId) }))) throw new GcsForbidden({ permission: "forums.view" });
  }

  /** Forumurile în care actorul are puterea; `null` = toate (moderator global). */
  private async moderatedForums(actor: GcsActor, power: string): Promise<number[] | null> {
    const { db, permissions } = this.posting.deps;
    if (!actor.userId) return [];
    if (await permissions.can(actor, "forums.moderate_all")) return null;
    const rows = await db.moderator.findMany({
      where: {
        containerType: "forum",
        powers: { has: power },
        OR: [{ userId: actor.userId }, { groupId: { in: actor.groupIds } }],
      },
      select: { containerId: true },
    });
    return [...new Set(rows.map((r) => Number(r.containerId)))];
  }

  /** Recalculează topicurile, forumurile și userii afectați (autorii postărilor din topicuri + cei dați). */
  private async recount(tx: Tx, topicIds: number[], forumIds: Iterable<number>, extraUsers: string[] = []): Promise<void> {
    const { counters } = this.posting;
    for (const id of topicIds) await counters.recountTopic(tx, id);
    for (const id of forumIds) await counters.recountForum(tx, id);
    const authors = await tx.post.findMany({
      where: { topicId: { in: topicIds }, authorId: { not: null } },
      distinct: ["authorId"],
      select: { authorId: true },
    });
    for (const userId of new Set([...authors.map((a) => a.authorId!), ...extraUsers])) await counters.recountUser(tx, userId);
  }

  private audit(tx: Tx, actor: GcsActor, action: string, targetId: number, before: unknown, after: unknown, targetType = "topic"): Promise<void> {
    return writeAudit(tx, { actorId: actor.userId, action, targetType, targetId: String(targetId), before, after, ip: actor.ip });
  }

  private async changed(topicIds: number[], forumIds: Iterable<number>): Promise<void> {
    await this.posting.deps.bus.emit({
      name: "topic.moderated",
      payload: { topicIds },
      tags: ["forums-tree", ...[...forumIds].map((id) => `forum:${id}`), ...topicIds.map((id) => `topic:${id}`)],
    });
  }
}

/** Un text simplu (răspuns predefinit) ca document Tiptap: un paragraf pentru fiecare bloc despărțit de un rând gol. */
export function textDoc(text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i) => [...(i > 0 ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]),
    })),
  };
}
