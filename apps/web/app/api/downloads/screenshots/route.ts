import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { currentActor } from "@/lib/actor";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * O captură de ecran a unui fișier (`multipart/form-data`: `file`, `categoryId` sau `fileId`): imaginea trece prin
 * încărcarea obișnuită și primește watermark-ul site-ului; rămâne nelegată până la salvarea formularului.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" });
    const actor = await currentActor();
    if (!actor.userId) throw new GcsForbidden({ reason: "login_required" });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const num = (k: string) => {
      const v = form?.get(k);
      return typeof v === "string" && /^\d{1,10}$/.test(v) ? Number(v) : null;
    };
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    const categoryId = num("categoryId");
    const fileId = num("fileId");
    if (categoryId === null && fileId === null) throw new GcsValidationError({ categoryId: "required" });
    return services().downloads.service.uploadScreenshot(actor, { categoryId: categoryId ?? 0, fileId }, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
