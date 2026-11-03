import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { SEO_ACP_SECTION, SEO_SETTINGS } from "@gcs/modules";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Imaginea de distribuire implicită (ACP → Promovare → SEO, OpenGraph / cardul X): `multipart/form-data` cu `file`.
 * Trece prin pipeline-ul imaginilor decorative (tipul real, WebP de cel mult 1200 px, fără EXIF), e publică și devine
 * imediat valoarea setării `seo.share_image`. Răspunde `GcsResult<{ url }>`.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BYTES + 64 * 1024) throw new GcsValidationError({ file: "too_large" }, { maxMb: "5" });
    const actor = await assertAcpAction(SEO_ACP_SECTION, "edit");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    const { attachments, settings } = services();
    const stored = await attachments.storeDecorImage(actor.userId, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { maxBytes: MAX_BYTES, maxSide: 1200, animated: false, target: "seo:share" });
    await settings.set(SEO_SETTINGS.shareImage, stored.url, actor);
    return { url: stored.url };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
