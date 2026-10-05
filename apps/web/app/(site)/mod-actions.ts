"use server";

import { GcsNotFound } from "@gcs/core";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

const id = z.number().int().positive();
const ids = z.array(id).min(1).max(100);

/** Fixează / blochează / evidențiază topicuri (în masă). */
export const setTopicFlagAction = gcsAction(
  z.object({ topicIds: ids, flag: z.enum(["pinned", "locked", "featured"]), value: z.boolean() }),
  async ({ topicIds, flag, value }, { actor }) => {
    const { moderation } = services();
    if (flag === "pinned") await moderation.setPinned(actor, topicIds, value);
    else if (flag === "locked") await moderation.setLocked(actor, topicIds, value);
    else await moderation.setFeatured(actor, topicIds, value);
  },
);

export const moveTopicsAction = gcsAction(z.object({ topicIds: ids, forumId: id }), async ({ topicIds, forumId }, { actor }) => {
  await services().moderation.move(actor, topicIds, forumId);
});

/** Ascunde sau restaurează topicuri (prin prima lor postare). */
export const setTopicsHiddenAction = gcsAction(z.object({ topicIds: ids, hidden: z.boolean() }), async ({ topicIds, hidden }, { actor }) => {
  const { db, posts } = services();
  const topics = await db.topic.findMany({ where: { id: { in: topicIds } }, select: { firstPostId: true } });
  for (const t of topics) {
    if (t.firstPostId === null) continue;
    if (hidden) await posts.hide(actor, t.firstPostId);
    else await posts.restore(actor, t.firstPostId);
  }
});

export const deleteTopicAction = gcsAction(z.object({ topicId: id }), async ({ topicId }, { actor }) => {
  const { db, posts } = services();
  const topic = await db.topic.findUnique({ where: { id: topicId }, select: { firstPostId: true, forumId: true } });
  if (!topic?.firstPostId) throw new GcsNotFound();
  await posts.delete(actor, topic.firstPostId);
  return { forumId: topic.forumId };
});

/** Unește topicul curent în altul; ținta se dă ca id sau ca link `/topic/{id}-...`. */
export const mergeTopicAction = gcsAction(z.object({ topicId: id, target: z.string().max(300) }), async ({ topicId, target }, { actor }) => {
  const m = /(?:^|\/topic\/)(\d+)/.exec(target.trim());
  const targetId = m ? Number(m[1]) : NaN;
  if (!Number.isSafeInteger(targetId)) throw new GcsNotFound();
  await services().moderation.merge(actor, [topicId], targetId);
  const topic = await services().db.topic.findUniqueOrThrow({ where: { id: targetId }, select: { slug: true } });
  return { href: `/topic/${targetId}-${topic.slug}` };
});

export const splitPostsAction = gcsAction(
  z.object({ postIds: ids, title: z.string().max(200), forumId: id }),
  async ({ postIds, title, forumId }, { actor }) => {
    const { moderation, db } = services();
    const topicId = await moderation.split(actor, postIds, { title, forumId });
    const topic = await db.topic.findUniqueOrThrow({ where: { id: topicId }, select: { slug: true } });
    return { href: `/topic/${topicId}-${topic.slug}` };
  },
);

export const approvePostsAction = gcsAction(z.object({ postIds: ids }), async ({ postIds }, { actor }) => {
  await services().moderation.approve(actor, postIds);
});

export const applySavedActionAction = gcsAction(z.object({ actionId: id, topicIds: ids }), async ({ actionId, topicIds }, { actor }) => {
  await services().moderation.applySavedAction(actor, actionId, topicIds);
});
