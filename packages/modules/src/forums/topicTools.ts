import { GcsForbidden, GcsNotFound, GcsValidationError, writeAudit, type GcsActor, type GcsSettingsService } from "@gcs/core";
import type { Prisma } from "@gcs/db";
import { isNoticeTone } from "./notices";
import type { GcsForumPosting } from "./posting";
import { toRef, userRefSelect, type GcsUserRef } from "./queries";

/** O intrare din „Istoric moderare” al unui topic. */
export type GcsTopicHistoryEntry = { id: string; action: string; at: string; actor: GcsUserRef | null; targetType: string; targetId: string; details: Record<string, unknown> | null };

const HISTORY_LIMIT = 100;

/**
 * Acțiunile salvate (macro-urile de moderare din ACP) care se aplică pe un forum, pentru meniul de moderare al unui
 * topic (aplicate dintr-un click): cele fără forumuri alese (toate) sau cu forumul în listă, în ordinea din ACP.
 */
export function savedActionsForForum<T extends { id: number; name: string; forumIds: number[] }>(actions: readonly T[], forumId: number): { id: number; name: string }[] {
  return actions.filter((a) => a.forumIds.length === 0 || a.forumIds.includes(forumId)).map((a) => ({ id: a.id, name: a.name }));
}

/**
 * Uneltele de moderare ale unui topic (Forum v2): mesajul unui moderator („Adaugă mesaj”), răspunsul recomandat
 * („Recomandat”), aprobarea postărilor doar în topic și istoricul moderării. Fiecare acțiune cere puterea pe forumul
 * topicului (sau `forums.moderate_all`) și intră în jurnal.
 */
export class GcsTopicToolsService {
  constructor(
    private readonly posting: GcsForumPosting,
    private readonly deps: { settings: GcsSettingsService },
  ) {}

  private async topic(actor: GcsActor, topicId: number, power: string) {
    const topic = await this.posting.deps.db.topic.findUnique({ where: { id: topicId }, select: { id: true, forumId: true, firstPostId: true, recommendedPostId: true, requireApproval: true } });
    if (!topic) throw new GcsNotFound();
    if (!(await this.posting.isModerator(actor, power, topic.forumId))) throw new GcsForbidden({ power });
    return topic;
  }

  private async changed(topicId: number, forumId: number): Promise<void> {
    await this.posting.deps.bus.emit({ name: "topic.moderated", payload: { topicIds: [topicId] }, tags: [`forum:${forumId}`, `topic:${topicId}`] });
  }

  /** „Adaugă mesaj”: mesajul unui moderator, sus în topic, cu tonul ales (editorul compact, fără blocuri). */
  async addNotice(actor: GcsActor, topicId: number, input: { content: unknown; tone: string }): Promise<number> {
    const topic = await this.topic(actor, topicId, "edit");
    if (!isNoticeTone(input.tone)) throw new GcsValidationError({ tone: "invalid_choice" });
    const rendered = await this.posting.render(input.content, { actor });
    const { db } = this.posting.deps;
    const id = await db.$transaction(async (tx) => {
      const row = await tx.topicNotice.create({ data: { topicId, authorId: actor.userId, contentJson: rendered.json as Prisma.InputJsonValue, contentHtml: rendered.html, tone: input.tone } });
      await writeAudit(tx, { actorId: actor.userId, action: "mod.topic.notice", targetType: "topic", targetId: String(topicId), after: { noticeId: row.id, tone: input.tone }, ip: actor.ip });
      return row.id;
    });
    await this.changed(topicId, topic.forumId);
    return id;
  }

  async deleteNotice(actor: GcsActor, noticeId: number): Promise<void> {
    const { db } = this.posting.deps;
    const notice = await db.topicNotice.findUnique({ where: { id: noticeId }, select: { id: true, topicId: true, contentHtml: true } });
    if (!notice) throw new GcsNotFound();
    const topic = await this.topic(actor, notice.topicId, "edit");
    await db.$transaction(async (tx) => {
      await tx.topicNotice.delete({ where: { id: noticeId } });
      await writeAudit(tx, { actorId: actor.userId, action: "mod.topic.notice_delete", targetType: "topic", targetId: String(notice.topicId), before: { noticeId, contentHtml: notice.contentHtml }, ip: actor.ip });
    });
    await this.changed(notice.topicId, topic.forumId);
  }

  /** „Recomandat”: un răspuns vizibil din topic (nu prima postare), arătat sus; `null` îl scoate. */
  async setRecommended(actor: GcsActor, topicId: number, postId: number | null): Promise<void> {
    const topic = await this.topic(actor, topicId, "feature");
    const { db } = this.posting.deps;
    if (postId !== null) {
      const post = await db.post.findUnique({ where: { id: postId }, select: { topicId: true, visibility: true } });
      if (!post || post.topicId !== topicId || post.visibility !== "VISIBLE" || postId === topic.firstPostId) throw new GcsValidationError({ postId: "invalid_choice" });
    }
    await db.$transaction(async (tx) => {
      await tx.topic.update({ where: { id: topicId }, data: { recommendedPostId: postId } });
      await writeAudit(tx, { actorId: actor.userId, action: "mod.topic.recommend", targetType: "topic", targetId: String(topicId), before: { postId: topic.recommendedPostId }, after: { postId }, ip: actor.ip });
    });
    await this.changed(topicId, topic.forumId);
  }

  /** „Aprobare postări”: răspunsurile noi din topic trec prin coada de aprobare (în afară de moderatori). */
  async setRequireApproval(actor: GcsActor, topicId: number, value: boolean): Promise<void> {
    const topic = await this.topic(actor, topicId, "approve");
    const { db } = this.posting.deps;
    await db.$transaction(async (tx) => {
      await tx.topic.update({ where: { id: topicId }, data: { requireApproval: value } });
      await writeAudit(tx, { actorId: actor.userId, action: "mod.topic.approval", targetType: "topic", targetId: String(topicId), before: { requireApproval: topic.requireApproval }, after: { requireApproval: value }, ip: actor.ip });
    });
    await this.changed(topicId, topic.forumId);
  }

  /**
   * „Istoric moderare” al unui topic: acțiunile din jurnal pe topic și pe postările lui (fixare, blocare, mutare,
   * ascundere, editări de moderator, mesaje, notele resetate…), cele mai noi primele. Orice putere de moderare pe forum.
   * Numele moderatorilor apar după setarea „Numele moderatorului pe evenimente” (staff-ul îi vede mereu).
   */
  async history(actor: GcsActor, topicId: number): Promise<GcsTopicHistoryEntry[]> {
    const { db, permissions } = this.posting.deps;
    const topic = await db.topic.findUnique({ where: { id: topicId }, select: { id: true, forumId: true } });
    if (!topic) throw new GcsNotFound();
    const ref = { type: "forum", id: String(topic.forumId) };
    const isMod = (await permissions.can(actor, "forums.moderate_all")) || (await permissions.moderatorPowers(actor, ref)).length > 0;
    if (!isMod) throw new GcsForbidden({ permission: "forums.moderate" });
    const postIds = (await db.post.findMany({ where: { topicId }, select: { id: true }, take: 5000 })).map((p) => String(p.id));
    const rows = await db.auditLog.findMany({
      where: {
        OR: [
          { targetType: "topic", targetId: String(topicId) },
          { targetType: "post", targetId: { in: postIds } },
          { targetType: "forums.topic", targetId: String(topicId) },
        ],
        NOT: { action: { in: ["post.create", "topic.create"] } },
      },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: { id: true, action: true, createdAt: true, actorId: true, targetType: true, targetId: true, after: true },
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => id !== null))];
    const users = actorIds.length > 0 ? await db.user.findMany({ where: { id: { in: actorIds } }, select: userRefSelect }) : [];
    const byId = new Map(users.map((u) => [u.id, toRef(u)]));
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      at: r.createdAt.toISOString(),
      actor: r.actorId ? (byId.get(r.actorId) ?? null) : null,
      targetType: r.targetType,
      targetId: r.targetId,
      details: r.after && typeof r.after === "object" && !Array.isArray(r.after) ? (r.after as Record<string, unknown>) : null,
    }));
  }

  /** Moderatorul apare cu numele lui pe mesaje (setarea globală), altfel ca „Echipa de moderare”. */
  modNamesPublic(): Promise<boolean> {
    return this.deps.settings.get<boolean>("forums.mod_names_public");
  }
}
