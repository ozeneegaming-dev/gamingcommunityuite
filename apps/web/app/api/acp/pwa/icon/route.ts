import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { loadPwaConfig, PWA_ACP_SECTION, PWA_SETTING } from "@gcs/modules";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Iconița aplicației instalabile (ACP › Setări › Web App): `multipart/form-data` cu `file`. Devine PNG 512 × 512
 * (încadrată pe fundal transparent), e publică și intră imediat în setarea `pwa.config`. Răspunde `GcsResult<{ url }>`.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BYTES + 64 * 1024) throw new GcsValidationError({ file: "too_large" }, { maxMb: "2" });
    const actor = await assertAcpAction(PWA_ACP_SECTION, "edit");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    const { attachments, settings } = services();
    const stored = await attachments.uploadSiteImage(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { kind: "appicon", themeKey: "pwa" });
    await settings.set(PWA_SETTING, { ...(await loadPwaConfig(settings)), icon: stored.url }, actor);
    return { url: stored.url };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
