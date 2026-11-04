import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { ADS_ACP_SECTION } from "@gcs/modules";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Imaginea unei reclame (ACP › Promovare › Reclame): `multipart/form-data` cu `file`. Trece prin pipeline-ul imaginilor
 * decorative (tipul real, WebP de cel mult 1200 px; GIF-urile animate rămân animate) și e publică. Adresa intră în
 * câmpul formularului și se salvează cu reclama. Răspunde `GcsResult<{ url }>`.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BYTES + 64 * 1024) throw new GcsValidationError({ file: "too_large" }, { maxMb: "3" });
    const actor = await assertAcpAction(ADS_ACP_SECTION, "edit");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    const stored = await services().attachments.storeDecorImage(actor.userId, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { maxBytes: MAX_BYTES, maxSide: 1200, animated: true, target: "ads:unit" });
    return { url: stored.url };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
