import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError, toResult } from "@gcs/core";
import { FORUMS_ACP_SECTION, forumPreviewTarget } from "@gcs/modules";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
/** Latura maximă: un card lat pe ecranele dense (16 : 7 la 1600 px = 700 px înălțime). */
const MAX_SIDE = 1600;
const UPLOAD_LIMIT = { window: 3600, max: 60 };

/**
 * Imaginea de previzualizare a unui forum (cardurile din grilă; ACP › Forumuri › Editează): `multipart/form-data` cu
 * `file` și `forumId`. Trece prin pipeline-ul imaginilor decorative (tipul real, WebP de cel mult 1600 px, fără EXIF,
 * SVG curățat și rasterizat), e publică și legată de forum (`forum:{id}:preview`); id-ul intră în formular și se salvează
 * cu el (serverul verifică acolo că fișierul e al acestui forum). Dreptul: editarea forumurilor din ACP.
 * Răspunde `GcsResult<{ id, url }>`.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BYTES + 64 * 1024) throw new GcsValidationError({ file: "too_large" }, { maxMb: "5" });
    const actor = await assertAcpAction(FORUMS_ACP_SECTION, "edit");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const forumId = Number(form?.get("forumId"));
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    if (!Number.isSafeInteger(forumId) || forumId <= 0) throw new GcsValidationError({ forumId: "invalid" });
    const { db, attachments, rateLimiter } = services();
    const forum = await db.forum.findUnique({ where: { id: forumId }, select: { id: true, type: true } });
    if (!forum || forum.type === "CATEGORY") throw new GcsNotFound();
    const limit = await rateLimiter.consume(`forum-preview-upload:${actor.userId}`, UPLOAD_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const stored = await attachments.storeDecorImage(
      actor.userId,
      { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
      { maxBytes: MAX_BYTES, maxSide: MAX_SIDE, animated: false, target: forumPreviewTarget(forum.id) },
    );
    return { id: stored.id, url: stored.url };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
