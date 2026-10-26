"use server";

import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError, verifyPassword, writeAudit } from "@gcs/core";
import { revealHidden, TOPIC_RATING_TYPE } from "@gcs/modules";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { rememberForumUnlock } from "@/lib/forum-access";
import { namesHtml } from "@/lib/member-names";
import { assertModeratorOn, postBotNotes } from "@/lib/bot-notes";
import { services } from "@/lib/services";

/**
 * Acțiunile Forum v2 pe site: nota cu stele, uneltele topicului (mesaj de moderator, recomandat, aprobarea postărilor,
 * arhivarea), regulile forumului (acceptarea) și parola forumului. Permisiunile le verifică serviciile.
 */
const id = z.number().int().positive();

// ─── Nota cu stele ───────────────────────────────────────────────────────────────────────────────────────

export const rateTopicAction = gcsAction(z.object({ topicId: id, value: z.number().int().min(1).max(5) }), async ({ topicId, value }, { actor }) => {
  return services().ratings.rate(actor, TOPIC_RATING_TYPE, String(topicId), value);
});

export const unrateTopicAction = gcsAction(z.object({ topicId: id }), async ({ topicId }, { actor }) => {
  return services().ratings.unrate(actor, TOPIC_RATING_TYPE, String(topicId));
});

/** Moderarea notei: voturile topicului, scoaterea unui vot abuziv sau resetarea tuturor. */
export const topicVotesAction = gcsAction(z.object({ topicId: id }), async ({ topicId }, { actor }) => {
  return services().ratings.votes(actor, TOPIC_RATING_TYPE, String(topicId));
});

export const removeTopicVotesAction = gcsAction(z.object({ topicId: id, userId: z.string().min(1).max(64).nullable() }), async ({ topicId, userId }, { actor }) => {
  return services().ratings.removeVotes(actor, TOPIC_RATING_TYPE, String(topicId), userId);
});

// ─── Uneltele topicului ──────────────────────────────────────────────────────────────────────────────────

export const addTopicNoticeAction = gcsAction(z.object({ topicId: id, content: z.unknown(), tone: z.string().max(10) }), async ({ topicId, content, tone }, { actor }) => {
  return { id: await services().topicTools.addNotice(actor, topicId, { content, tone }) };
});

export const deleteTopicNoticeAction = gcsAction(z.object({ noticeId: id }), async ({ noticeId }, { actor }) => {
  await services().topicTools.deleteNotice(actor, noticeId);
});

export const setRecommendedPostAction = gcsAction(z.object({ topicId: id, postId: id.nullable() }), async ({ topicId, postId }, { actor }) => {
  await services().topicTools.setRecommended(actor, topicId, postId);
});

export const setTopicApprovalAction = gcsAction(z.object({ topicId: id, value: z.boolean() }), async ({ topicId, value }, { actor }) => {
  await services().topicTools.setRequireApproval(actor, topicId, value);
});

export const topicHistoryAction = gcsAction(z.object({ topicId: id }), async ({ topicId }, { actor }) => {
  return services().topicTools.history(actor, topicId);
});

export const setTopicsArchivedAction = gcsAction(
  z.object({ topicIds: z.array(id).min(1).max(100), archived: z.boolean(), botNote: z.string().trim().min(1).max(2000).optional() }),
  async ({ topicIds, archived, botNote }, { actor }) => {
    // Nota botului înainte de arhivare (un topic arhivat nu mai primește răspunsuri), după dezarhivare; drepturile întâi.
    if (archived && botNote) {
      await assertModeratorOn(actor, topicIds, "lock");
      await postBotNotes(topicIds, botNote);
    }
    await services().archive.setArchived(actor, topicIds, archived);
    if (!archived) await postBotNotes(topicIds, botNote);
  },
);

// ─── Previzualizarea postării ────────────────────────────────────────────────────────────────────────────

/**
 * „Previzualizare” (desktop / tabletă / telefon): conținutul randat exact ca la publicare (aceleași blocuri permise),
 * fără să se salveze nimic. Conținutul ascuns apare deschis (autorul îl vede mereu).
 */
export const previewPostAction = gcsAction(z.object({ forumId: id, content: z.unknown() }), async ({ forumId, content }, { actor, ip }) => {
  const { posting, rateLimiter } = services();
  if (!actor.userId || !(await posting.canOnForum(actor, "forums.reply", forumId))) throw new GcsForbidden({ permission: "forums.reply" });
  const limit = await rateLimiter.consume(`post-preview:${actor.userId}:${ip}`, { window: 60, max: 30 });
  if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
  const rendered = await posting.render(content, { actor, blocks: true });
  // Numele din mențiuni primesc stilul comun (pastila în culoarea grupului), ca în postarea publicată.
  return { html: await namesHtml(revealHidden(rendered.html, rendered.hiddenParts, { userId: actor.userId, groupIds: actor.groupIds, replied: true, isAuthor: true })) };
});

// ─── Regulile și parola forumului ───────────────────────────────────────────────────────────────────────

/** „Am citit și accept regulile” (forumurile cu regulile de acceptat înainte de a posta). */
export const acceptForumRulesAction = gcsAction(z.object({ forumId: id }), async ({ forumId }, { actor }) => {
  const { db, permissions } = services();
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  const forum = await db.forum.findUnique({ where: { id: forumId }, select: { rulesMode: true } });
  if (!forum || !(await permissions.can(actor, "forums.read", { type: "forum", id: String(forumId) }))) throw new GcsNotFound();
  if (forum.rulesMode !== "accept") throw new GcsValidationError({ forumId: "invalid_choice" });
  const userId = actor.userId;
  await db.$transaction(async (tx) => {
    await tx.forumRulesAcceptance.upsert({ where: { forumId_userId: { forumId, userId } }, create: { forumId, userId }, update: { acceptedAt: new Date() } });
    await writeAudit(tx, { actorId: userId, action: "forum.rules.accept", targetType: "forum", targetId: String(forumId), ip: actor.ip });
  });
});

/** Parola unui forum: corectă → cookie-ul de deblocare (încercările limitate pe IP și forum). */
export const unlockForumAction = gcsAction(z.object({ forumId: id, password: z.string().min(1).max(100) }), async ({ forumId, password }, { actor, ip }) => {
  const { db, rateLimiter, permissions } = services();
  const forum = await db.forum.findUnique({ where: { id: forumId }, select: { passwordHash: true } });
  if (!forum?.passwordHash || !(await permissions.can(actor, "forums.view", { type: "forum", id: String(forumId) }))) throw new GcsNotFound();
  const limit = await rateLimiter.consume(`forum-password:${forumId}:${ip}`, { window: 600, max: 10 });
  if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
  if (!(await verifyPassword(forum.passwordHash, password))) throw new GcsValidationError({ password: "wrong_password" });
  await rememberForumUnlock(forumId, forum.passwordHash);
});

// ─── Votul Q&A ───────────────────────────────────────────────────────────────────────────────────────────

export const votePostAction = gcsAction(z.object({ postId: id, value: z.union([z.literal(1), z.literal(-1)]) }), async ({ postId, value }, { actor }) => {
  return services().topicTools.vote(actor, postId, value);
});
