import { GcsForbidden, GcsValidationError, THEMES_ACP_SECTION, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 3 * 1024 * 1024;

/**
 * Logo-ul sau favicon-ul unei teme, din editorul de pe site (specul etapei 5): `multipart/form-data` cu `file`,
 * `kind` (`logo` | `favicon`) și `theme` (cheia). Imaginea intră în draft-ul temei; răspunde cu
 * `GcsResult<{ url, css }>` (CSS-ul draft-ului, pentru previzualizare).
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" }, { maxMb: "2" });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const kind = form?.get("kind");
    const key = form?.get("theme");
    if (!(file instanceof File) || (kind !== "logo" && kind !== "favicon") || typeof key !== "string") throw new GcsValidationError({ file: "required" });
    const actor = await assertAcpAction(THEMES_ACP_SECTION, "edit");
    const { attachments, themes } = services();
    if (!(await themes.get(key))) throw new GcsValidationError({ theme: "not_found" });
    const uploaded = await attachments.uploadSiteImage(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { kind, themeKey: key });
    await themes.saveDraft(actor, key, kind === "logo" ? { logoUrl: uploaded.url } : { faviconUrl: uploaded.url });
    const theme = (await themes.get(key))!;
    return { url: uploaded.url, css: themes.css(theme, { draft: true }) };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
