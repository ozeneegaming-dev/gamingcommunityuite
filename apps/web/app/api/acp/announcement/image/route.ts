import { GcsForbidden, GcsRateLimited, GcsValidationError, toResult } from "@gcs/core";
import { ANNOUNCEMENT_ACP_SECTION } from "@gcs/modules";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Ce acceptă imaginea de fundal a barei (aceleași reguli ca în câmpul de încărcare din ACP: `UPLOAD_RULES.image(3)`). */
const ANNOUNCEMENT_IMAGE_MAX_MB = 3;
const MAX_BYTES = ANNOUNCEMENT_IMAGE_MAX_MB * 1024 * 1024;
const LIMIT = { window: 3600, max: 60 };

/**
 * Imaginea de fundal a unei bare de anunț (ACP → Aspect → Bară de anunț → Aspect): `multipart/form-data` cu `file`.
 * Trece prin pipeline-ul imaginilor decorative (tipul real, WebP de cel mult 2560 px, fără EXIF) și e publică; adresa
 * (`/files/<id>`) intră în bară și se salvează cu ea. Răspunde `GcsResult<{ url }>`.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BYTES + 64 * 1024) throw new GcsValidationError({ file: "too_large" }, { maxMb: String(ANNOUNCEMENT_IMAGE_MAX_MB) });
    const actor = await assertAcpAction(ANNOUNCEMENT_ACP_SECTION, "edit");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    const { attachments, rateLimiter } = services();
    const limit = await rateLimiter.consume(`ann-image:${actor.userId}`, LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const stored = await attachments.storeDecorImage(
      actor.userId,
      { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
      { maxBytes: MAX_BYTES, maxSide: 2560, animated: false, target: "announcement:background" },
    );
    return { url: stored.url };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
