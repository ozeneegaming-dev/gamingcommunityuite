import { GcsForbidden, GcsValidationError, THEMES_ACP_SECTION, toResult, type GcsThemeDraft } from "@gcs/core";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 6 * 1024 * 1024;

/**
 * Locurile unei imagini în temă: logo-ul de bază și favicon-ul (coloanele temei), variantele logo-ului și imaginea
 * antetului (designul Nova; setări).
 */
const SLOTS: Record<string, { upload: "logo" | "favicon" | "header"; draft: (url: string) => GcsThemeDraft }> = {
  logo: { upload: "logo", draft: (url) => ({ logoUrl: url }) },
  favicon: { upload: "favicon", draft: (url) => ({ faviconUrl: url }) },
  logoLight: { upload: "logo", draft: (url) => ({ logo: { imageLight: url } }) },
  logoMobile: { upload: "logo", draft: (url) => ({ logo: { imageMobile: url } }) },
  logoMobileLight: { upload: "logo", draft: (url) => ({ logo: { imageMobileLight: url } }) },
  headerImage: { upload: "header", draft: (url) => ({ header: { image: url } }) },
};

/**
 * O imagine a unei teme, din editorul de pe site sau din editorul vizual (specul etapei 5): `multipart/form-data` cu
 * `file`, `kind` (`logo` | `favicon` | `logoLight` | `logoMobile` | `logoMobileLight` | `headerImage`) și `theme` (cheia). Imaginea
 * intră în draft-ul temei; răspunde cu `GcsResult<{ url, css }>` (CSS-ul draft-ului, pentru previzualizare).
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" }, { maxMb: "5" });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const kind = form?.get("kind");
    const key = form?.get("theme");
    const slot = typeof kind === "string" && Object.hasOwn(SLOTS, kind) ? SLOTS[kind] : undefined;
    if (!(file instanceof File) || !slot || typeof key !== "string") throw new GcsValidationError({ file: "required" });
    const actor = await assertAcpAction(THEMES_ACP_SECTION, "edit");
    const { attachments, themes } = services();
    if (!(await themes.get(key))) throw new GcsValidationError({ theme: "not_found" });
    const uploaded = await attachments.uploadSiteImage(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { kind: slot.upload, themeKey: key });
    await themes.saveDraft(actor, key, slot.draft(uploaded.url));
    const theme = (await themes.get(key))!;
    return { url: uploaded.url, css: themes.css(theme, { draft: true }) };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
