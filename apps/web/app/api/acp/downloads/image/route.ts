import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { DOWNLOADS_ACP } from "@gcs/modules";
import { headers } from "next/headers";
import { assertAcpAction, getAcpContext } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BYTES = 3 * 1024 * 1024;
const KINDS = { icon: { side: 256, section: DOWNLOADS_ACP.categories }, cover: { side: 1600, section: DOWNLOADS_ACP.categories }, watermark: { side: 1024, section: DOWNLOADS_ACP.settings } } as const;

/**
 * Imaginile Descărcărilor din ACP (`multipart/form-data`: `kind` = `icon` / `cover` / `watermark`, `file`): iconiță și
 * coperta unei categorii, imaginea de watermark. Trec prin pipeline-ul imaginilor decorative (publice, WebP, fără EXIF;
 * transparența se păstrează). Răspunde `GcsResult<{ id, url }>`; id-ul se salvează cu formularul.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BYTES + 64 * 1024) throw new GcsValidationError({ file: "too_large" }, { maxMb: "3" });
    const ctx = await getAcpContext();
    if (ctx.state !== "ok") throw new GcsForbidden({ reason: "acp_gate" });
    const { acp } = services();
    const canCategories = await acp.can(ctx.actor, DOWNLOADS_ACP.categories, "edit");
    const canSettings = await acp.can(ctx.actor, DOWNLOADS_ACP.settings, "edit");
    if (!canCategories && !canSettings) throw new GcsForbidden({ reason: "acp_forbidden" });
    const form = await req.formData().catch(() => null);
    const kind = form?.get("kind");
    if (kind !== "icon" && kind !== "cover" && kind !== "watermark") throw new GcsValidationError({ kind: "invalid_choice" });
    const actor = await assertAcpAction(KINDS[kind].section, "edit");
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    const stored = await services().attachments.storeDecorImage(actor.userId, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { maxBytes: MAX_BYTES, maxSide: KINDS[kind].side, animated: false, target: `downloads:${kind}` });
    return { id: stored.id, url: stored.url };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
