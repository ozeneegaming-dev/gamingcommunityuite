"use server";

import { GcsForbidden, GcsNotFound } from "@gcs/core";
import { POST_CONTENT_TYPE } from "@gcs/modules";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { postHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";

const id = z.number().int().positive();
/** JSON-ul editorului; validarea completă o face `GcsContentRenderer` pe server. */
const content = z.unknown();

export const replyAction = gcsAction(z.object({ topicId: id, content }), async ({ topicId, content: doc }, { actor }) => {
  const res = await services().posts.reply(actor, { topicId, content: doc });
  return { ...res, href: postHref(topicId, res.postId) };
});

export const editPostAction = gcsAction(
  z.object({ postId: id, content, title: z.string().max(200).optional() }),
  async ({ postId, content: doc, title }, { actor }) => {
    await services().posts.edit(actor, postId, { content: doc, ...(title !== undefined ? { title } : {}) });
  },
);

/** JSON-ul unei postări (și titlul, la prima postare), pentru editare: doar autorul sau un moderator cu `edit`. */
export const postSourceAction = gcsAction(z.object({ postId: id }), async ({ postId }, { actor }) => {
  const { db, permissions } = services();
  const post = await db.post.findUnique({
    where: { id: postId },
    select: { authorId: true, contentJson: true, topic: { select: { forumId: true, firstPostId: true, title: true } } },
  });
  if (!post) throw new GcsNotFound();
  const isMod =
    (await permissions.can(actor, "forums.moderate_all")) ||
    (await permissions.canModerate(actor, "edit", { type: "forum", id: String(post.topic.forumId) }));
  if (!isMod && (actor.userId === null || actor.userId !== post.authorId)) throw new GcsForbidden({ permission: "forums.edit" });
  return { json: post.contentJson, title: post.topic.firstPostId === postId ? post.topic.title : null };
});

export const hidePostAction = gcsAction(z.object({ postId: id, reason: z.string().max(300).optional() }), async ({ postId, reason }, { actor }) => {
  await services().posts.hide(actor, postId, reason);
});

export const restorePostAction = gcsAction(z.object({ postId: id }), async ({ postId }, { actor }) => {
  await services().posts.restore(actor, postId);
});

export const deletePostAction = gcsAction(z.object({ postId: id }), async ({ postId }, { actor }) => {
  await services().posts.delete(actor, postId);
});

export const revisionsAction = gcsAction(z.object({ postId: id }), async ({ postId }, { actor }) => {
  const rows = await services().posts.revisions(actor, postId);
  return rows.map((r) => ({ id: r.id, html: r.contentHtml, createdAt: r.createdAt.toISOString(), editor: r.editor?.name ?? null }));
});

export const reactAction = gcsAction(z.object({ postId: id, reactionId: id.nullable() }), async ({ postId, reactionId }, { actor }) => {
  const { reactions } = services();
  await reactions.react(actor, { contentType: POST_CONTENT_TYPE, contentId: String(postId), reactionId });
  const [summary, mine] = await Promise.all([
    reactions.summary(POST_CONTENT_TYPE, [String(postId)]),
    reactions.mine(actor.userId, POST_CONTENT_TYPE, [String(postId)]),
  ]);
  return { reactions: summary[String(postId)] ?? [], mine: mine[String(postId)] ?? null };
});

export const reportAction = gcsAction(z.object({ postId: id, reason: z.string().max(500) }), async ({ postId, reason }, { actor }) => {
  await services().reports.report(actor, { contentType: POST_CONTENT_TYPE, contentId: String(postId), reason });
});

export const voteAction = gcsAction(z.object({ pollId: id, optionIds: z.array(id).min(1).max(10) }), async ({ pollId, optionIds }, { actor }) => {
  await services().polls.vote(actor, pollId, optionIds);
});

export const markSolvedAction = gcsAction(z.object({ topicId: id, postId: id.nullable() }), async ({ topicId, postId }, { actor }) => {
  await services().topics.markSolved(actor, topicId, postId);
});
