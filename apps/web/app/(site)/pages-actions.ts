"use server";

import { PAGES_FOLLOW_TYPE, PAGES_RECORD_TYPE } from "@gcs/modules";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

const id = z.number().int().positive();
const attachmentId = z.string().min(8).max(40).regex(/^[a-z0-9]+$/i);

/** Formularul unei înregistrări (trimitere sau editare); validarea de fond (câmpuri, categorie, conținut) e în serviciu. */
const recordInput = z.object({
  title: z.string().max(300),
  categoryId: id.nullable(),
  content: z.unknown(),
  imageId: attachmentId.nullable().optional(),
  fields: z.record(z.string().max(40), z.union([z.string().max(25_000), z.number(), z.boolean(), z.array(z.string().max(200)).max(60)])),
  featured: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

/** Trimite o înregistrare nouă (sau o adaugă direct, pentru staff). Întoarce adresa ei și starea. */
export const submitPagesRecord = gcsAction(z.object({ databaseId: id, input: recordInput }), async ({ databaseId, input }, { actor }) => {
  const { pagesRecords, pagesQueries } = services();
  const created = await pagesRecords.create(actor, databaseId, { title: input.title, categoryId: input.categoryId, content: input.content, imageId: input.imageId ?? null, fields: input.fields });
  const link = await pagesQueries.recordLink(created.id);
  return { id: created.id, status: created.status, href: link?.href ?? "/pages" };
});

export const updatePagesRecord = gcsAction(z.object({ recordId: id, input: recordInput }), async ({ recordId, input }, { actor }) => {
  const { pagesRecords, pagesQueries } = services();
  await pagesRecords.update(actor, recordId, {
    title: input.title,
    categoryId: input.categoryId,
    content: input.content,
    ...(input.imageId !== undefined ? { imageId: input.imageId } : {}),
    fields: input.fields,
    ...(input.featured !== undefined ? { featured: input.featured } : {}),
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
  });
  return { href: (await pagesQueries.recordLink(recordId))?.href ?? "/pages" };
});

/** Uneltele staff-ului pe o înregistrare (bara de moderare de pe pagina ei). */
export const moderatePagesRecord = gcsAction(
  z.object({ recordId: id, action: z.enum(["approve", "reject", "hide", "unhide", "feature", "unfeature", "pin", "unpin", "delete"]), reason: z.string().max(500).optional() }),
  async ({ recordId, action, reason }, { actor }) => {
    const { pagesRecords, pagesAccess } = services();
    if (action === "approve" || action === "reject") await pagesRecords.review(actor, recordId, action, reason ?? "");
    else if (action === "hide" || action === "unhide") await pagesRecords.setHidden(actor, recordId, action === "hide");
    else if (action === "feature" || action === "unfeature") await pagesRecords.setFlags(actor, recordId, { featured: action === "feature" });
    else if (action === "pin" || action === "unpin") await pagesRecords.setFlags(actor, recordId, { pinned: action === "pin" });
    else {
      const { databaseId } = await pagesRecords.delete(actor, recordId);
      const d = await pagesAccess.database(databaseId);
      return { href: d?.path ? `/pages/${d.path}` : "/pages" };
    }
    return { href: null };
  },
);

export const restorePagesRecordRevision = gcsAction(z.object({ revisionId: id }), async ({ revisionId }, { actor }) => services().pagesRecords.restoreRevision(actor, revisionId));

export const commentPagesRecord = gcsAction(z.object({ recordId: id, content: z.unknown() }), async ({ recordId, content }, { actor }) => services().pagesRecords.comment(actor, recordId, content));

export const editPagesComment = gcsAction(z.object({ commentId: id, content: z.unknown() }), async ({ commentId, content }, { actor }) => services().pagesRecords.editComment(actor, commentId, content));

export const moderatePagesComment = gcsAction(z.object({ commentId: id, action: z.enum(["hide", "unhide", "approve", "delete"]) }), async ({ commentId, action }, { actor }) => {
  const { pagesRecords } = services();
  if (action === "approve") await pagesRecords.approveComment(actor, commentId);
  else if (action === "delete") await pagesRecords.deleteComment(actor, commentId);
  else await pagesRecords.setCommentHidden(actor, commentId, action === "hide");
  return null;
});

export async function ratePagesRecord(recordId: number, value: number) {
  return gcsAction(z.object({ recordId: id, value: z.number().int().min(1).max(5) }), async (input, { actor }) => services().ratings.rate(actor, PAGES_RECORD_TYPE, String(input.recordId), input.value))({ recordId, value });
}

export async function unratePagesRecord(recordId: number) {
  return gcsAction(z.object({ recordId: id }), async (input, { actor }) => services().ratings.unrate(actor, PAGES_RECORD_TYPE, String(input.recordId)))({ recordId });
}

/** „Urmărește” o bază de date: înregistrările noi publicate ajung în notificări. */
export const followPagesDatabase = gcsAction(z.object({ databaseId: id, follow: z.boolean() }), async ({ databaseId, follow }, { actor }) => {
  const { pagesQueries, follows } = services();
  if (!actor.userId) return { following: false };
  if (!(await pagesQueries.databaseFor(actor, databaseId))) return { following: false };
  if (follow) await follows.follow(actor, PAGES_FOLLOW_TYPE, String(databaseId));
  else await follows.unfollow(actor, PAGES_FOLLOW_TYPE, String(databaseId));
  return { following: follow };
});
