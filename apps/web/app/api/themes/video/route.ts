import { GcsForbidden, GcsValidationError, HEADER_VIDEO_MAX_MB, THEMES_ACP_SECTION, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Videoul (25 MB) plus marginea formularului `multipart` (numele câmpurilor, separatorii). */
const MAX_BODY_BYTES = (HEADER_VIDEO_MAX_MB + 1) * 1024 * 1024;

/**
 * Videoul din spatele antetului unei teme, din editorul vizual: `multipart/form-data` cu `file` (MP4 / WebM, cel mult
 * 25 MB, tipul verificat din conținut) și `theme` (cheia). Separat de `/api/themes/images`, care primește doar imagini
 * mici (6 MB). Videoul intră în draft-ul temei; răspunde cu `GcsResult<{ url, css }>` (CSS-ul draft-ului).
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" }, { maxMb: String(HEADER_VIDEO_MAX_MB) });
    const actor = await assertAcpAction(THEMES_ACP_SECTION, "edit");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const key = form?.get("theme");
    if (!(file instanceof File) || typeof key !== "string") throw new GcsValidationError({ file: "required" });
    const { attachments, themes } = services();
    if (!(await themes.get(key))) throw new GcsValidationError({ theme: "not_found" });
    const uploaded = await attachments.uploadSiteVideo(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { themeKey: key });
    await themes.saveDraft(actor, key, { header: { video: uploaded.url } });
    const theme = (await themes.get(key))!;
    return { url: uploaded.url, css: themes.css(theme, { draft: true }) };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
