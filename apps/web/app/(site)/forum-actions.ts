"use server";

import { GcsForbidden, GcsNotFound } from "@gcs/core";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

const id = z.number().int().positive();

/** „Marchează citit” pe un forum (și subforumurile lui). */
export const markForumRead = gcsAction(z.object({ forumId: id }), async ({ forumId }, { actor }) => {
  if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
  await services().readMarkers.markForumRead(actor.userId, forumId);
});

/** Urmărește sau nu mai urmărește un forum sau un topic pe care actorul îl poate citi. */
export const setFollow = gcsAction(
  z.object({ contentType: z.enum(["forum", "topic"]), contentId: id, follow: z.boolean() }),
  async ({ contentType, contentId, follow }, { actor }) => {
    const { db, permissions, follows } = services();
    const forumId =
      contentType === "forum" ? contentId : (await db.topic.findUnique({ where: { id: contentId }, select: { forumId: true } }))?.forumId;
    if (forumId === undefined || !(await permissions.can(actor, "forums.read", { type: "forum", id: String(forumId) }))) {
      throw new GcsNotFound();
    }
    if (follow) await follows.follow(actor, contentType, String(contentId));
    else await follows.unfollow(actor, contentType, String(contentId));
    return { count: await follows.count(contentType, String(contentId)) };
  },
);
