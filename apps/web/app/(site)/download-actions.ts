"use server";

import { GcsNotFound } from "@gcs/core";
import * as z from "zod";
import { revalidatePath } from "next/cache";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

const id = z.number().int().positive();
const assetId = z.string().min(8).max(40).regex(/^[a-z0-9]+$/i);
const attachmentId = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
const fields = z.record(z.string().regex(/^\d{1,9}$/), z.unknown()).optional();
const tags = z.array(z.string().max(40)).max(20).optional();
const dl = () => services().downloads;

/** Trimiterea unui fișier (formularul `/downloads/submit`); validarea de fond o face serviciul. */
export const submitDownloadAction = gcsAction(
  z.object({
    categoryId: id,
    title: z.string().max(300),
    summary: z.string().max(1000).optional(),
    description: z.unknown(),
    version: z.string().max(100).optional(),
    changelog: z.unknown().optional(),
    assetIds: z.array(assetId).min(1).max(50),
    screenshotIds: z.array(attachmentId).max(30).optional(),
    fields,
    tags,
    acceptTerms: z.boolean().optional(),
  }),
  async (input, { actor }) => {
    const result = await dl().service.submit(actor, input);
    revalidatePath("/downloads", "layout");
    return result;
  },
);

/** Trimiterea în bloc: fiecare fișier devine o intrare (dreptul de grup `downloads.bulk`). */
export const submitManyDownloadsAction = gcsAction(
  z.object({ categoryId: id, description: z.unknown(), assetIds: z.array(assetId).min(1).max(50), acceptTerms: z.boolean().optional() }),
  async (input, { actor }) => dl().service.submitMany(actor, input),
);

export const editDownloadAction = gcsAction(
  z.object({ fileId: id, title: z.string().max(300), summary: z.string().max(1000).optional(), description: z.unknown(), screenshotIds: z.array(attachmentId).max(30).optional(), fields, tags }),
  async ({ fileId, ...input }, { actor }) => {
    await dl().service.edit(actor, fileId, input);
    revalidatePath("/downloads", "layout");
  },
);

export const addDownloadVersionAction = gcsAction(
  z.object({ fileId: id, version: z.string().max(100).optional(), changelog: z.unknown().optional(), assetIds: z.array(assetId).min(1).max(50), acceptTerms: z.boolean().optional() }),
  async ({ fileId, ...input }, { actor }) => dl().service.addVersion(actor, fileId, input),
);

export const removeDownloadAction = gcsAction(z.object({ fileId: id }), async ({ fileId }, { actor }) => {
  await dl().service.remove(actor, fileId);
  revalidatePath("/downloads", "layout");
});

/** Staff pe site: aprobare / respingere din pagina fișierului. */
export const reviewVersionAction = gcsAction(z.object({ versionId: id, decision: z.enum(["approve", "reject"]), reason: z.string().max(500).optional() }), async ({ versionId, decision, reason }, { actor }) => {
  if (decision === "approve") await dl().service.approve(actor, versionId);
  else await dl().service.reject(actor, versionId, reason ?? "");
  revalidatePath("/downloads", "layout");
});

export const downloadFlagsAction = gcsAction(
  z.object({ fileId: id, featured: z.boolean().optional(), hidden: z.boolean().optional(), commentsLocked: z.boolean().optional(), vipOnly: z.boolean().optional() }),
  async ({ fileId, ...flags }, { actor }) => {
    await dl().service.setFlags(actor, fileId, flags);
    revalidatePath("/downloads", "layout");
  },
);

export const moveDownloadAction = gcsAction(z.object({ fileId: id, categoryId: id }), async ({ fileId, categoryId }, { actor }) => {
  await dl().service.move(actor, fileId, categoryId);
  revalidatePath("/downloads", "layout");
});

export const reviewDownloadAction = gcsAction(z.object({ fileId: id, rating: z.number().int().min(1).max(5), body: z.unknown() }), async ({ fileId, rating, body }, { actor }) => {
  const r = await dl().service.review(actor, fileId, { rating, body });
  revalidatePath("/downloads", "layout");
  return r;
});

export const commentDownloadAction = gcsAction(z.object({ fileId: id, body: z.unknown() }), async ({ fileId, body }, { actor }) => {
  const r = await dl().service.comment(actor, fileId, body);
  revalidatePath("/downloads", "layout");
  return r;
});

export const editDownloadCommentAction = gcsAction(z.object({ commentId: id, body: z.unknown() }), async ({ commentId, body }, { actor }) => {
  await dl().service.editComment(actor, commentId, body);
  revalidatePath("/downloads", "layout");
});

export const moderateDownloadPostAction = gcsAction(
  z.object({ kind: z.enum(["comment", "review"]), id, action: z.enum(["approve", "hide", "delete"]) }),
  async ({ kind, id: postId, action }, { actor }) => {
    await dl().service.moderatePost(actor, kind, postId, action);
    revalidatePath("/downloads", "layout");
  },
);

/** Urmărește un fișier (versiunile noi) sau o categorie (fișierele noi). */
export const followDownloadAction = gcsAction(z.object({ kind: z.enum(["file", "category"]), id, follow: z.boolean() }), async ({ kind, id: targetId, follow }, { actor }) => {
  const { follows } = services();
  const visible = kind === "file" ? await dl().queries.canViewFile(actor, targetId) : (await dl().access.rights(actor, targetId)).see;
  if (!visible) throw new GcsNotFound();
  const type = kind === "file" ? "downloads.file" : "downloads.category";
  if (follow) await follows.follow(actor, type, String(targetId));
  else await follows.unfollow(actor, type, String(targetId));
});

/** Linkurile externe și importul de pe server (din formularul de trimitere). */
export const addDownloadLinkAction = gcsAction(z.object({ categoryId: id, fileId: id.nullable().optional(), url: z.string().max(2000), name: z.string().max(200).optional() }), async (input, { actor }) => dl().uploads.link(actor, input));

export const importDownloadPathAction = gcsAction(z.object({ categoryId: id, fileId: id.nullable().optional(), path: z.string().max(500) }), async (input, { actor }) => dl().uploads.importPath(actor, input));

export const listImportableAction = gcsAction(z.object({}), async (_input, { actor }) => dl().uploads.importable(actor));

export const cancelDownloadUploadAction = gcsAction(z.object({ assetId }), async ({ assetId: aid }, { actor }) => dl().uploads.cancel(actor, aid));
