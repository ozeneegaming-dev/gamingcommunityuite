"use server";

import { GcsForbidden } from "@gcs/core";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

const userId = z.string().min(8).max(40).regex(/^[a-z0-9]+$/i);

/** Urmărește / nu mai urmărește un membru (profil, hover card). Întoarce numărul nou de urmăritori. */
/** Ziua de naștere (Setări → Profil) și dacă e publică; `date: null` o șterge. */
export const saveBirthday = gcsAction(z.object({ date: z.string().max(10).nullable(), visible: z.boolean() }), async (input, { actor }) => {
  await services().profiles.setBirthday(actor, input);
});

export const followUser = gcsAction(z.object({ userId, follow: z.boolean() }), async (input, { actor }) => {
  const { social, db } = services();
  if (input.follow) await social.follow(actor, input.userId);
  else await social.unfollow(actor, input.userId);
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { followersCount: true } });
  return { followers: user?.followersCount ?? 0, following: input.follow };
});

/** Ignoră / nu mai ignoră un membru (postări și mesaje). */
export const ignoreUser = gcsAction(
  z.object({ userId, posts: z.boolean(), messages: z.boolean() }),
  async (input, { actor }) => {
    await services().social.ignore(actor, input.userId, { posts: input.posts, messages: input.messages });
  },
);

/** Un status pe perete (sau un răspuns la un status). */
export const postStatus = gcsAction(
  z.object({ profileUserId: userId, content: z.unknown(), parentId: z.number().int().positive().optional() }),
  async (input, { actor }) => {
    const status = await services().social.postStatus(actor, input.profileUserId, input.content, input.parentId);
    return { id: status.id };
  },
);

/** Ascunde, restaurează sau șterge un status (autorul, proprietarul peretelui sau staff-ul). */
export const manageStatus = gcsAction(
  z.object({ statusId: z.number().int().positive(), action: z.enum(["hide", "restore", "delete"]) }),
  async ({ statusId, action }, { actor }) => {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const { social } = services();
    if (action === "hide") await social.hideStatus(actor, statusId);
    else if (action === "restore") await social.restoreStatus(actor, statusId);
    else await social.deleteStatus(actor, statusId);
  },
);

/** Raportează un status sau un profil. */
export const reportStatus = gcsAction(
  z.object({ statusId: z.number().int().positive(), reason: z.string().min(3).max(500) }),
  async ({ statusId, reason }, { actor }) => {
    await services().reports.report(actor, { contentType: "profile.status", contentId: String(statusId), reason });
  },
);
