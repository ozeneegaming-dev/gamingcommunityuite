import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { PAGES_ACP } from "@gcs/modules";
import { headers } from "next/headers";
import { isSameOrigin } from "@/lib/actions";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * ACP › Pagini › Media: încărcarea unuia sau mai multor fișiere în biblioteca media (`file` repetat, `folderId` opțional).
 * Mărimea maximă vine din setarea `pages.media_max_mb`; fiecare fișier trece prin verificarea atașamentelor (tipul real,
 * recodarea imaginilor) și devine un element al bibliotecii, public (`/files/<id>`).
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    const { acp, settings, attachments, pagesAdmin } = services();
    const actor = await currentActor();
    await acp.assert(actor, PAGES_ACP.media, "edit");
    const maxMb = await settings.get<number>("pages.media_max_mb");
    if (Number(h.get("content-length") ?? "0") > (maxMb * 20 + 1) * 1024 * 1024) throw new GcsValidationError({ file: "too_large" });
    const form = await req.formData().catch(() => null);
    const files = (form?.getAll("file") ?? []).filter((f): f is File => f instanceof File && f.size > 0).slice(0, 20);
    if (files.length === 0) throw new GcsValidationError({ file: "required" });
    if (files.some((f) => f.size > maxMb * 1024 * 1024)) throw new GcsValidationError({ file: "too_large" }, { maxMb: String(maxMb) });
    const rawFolder = form?.get("folderId");
    const folderId = typeof rawFolder === "string" && /^\d{1,10}$/.test(rawFolder) ? Number(rawFolder) : null;
    const ids: string[] = [];
    for (const f of files) ids.push((await attachments.upload(actor, { name: f.name, bytes: Buffer.from(await f.arrayBuffer()) }, { permission: "acp.access" })).id);
    const mediaIds = await pagesAdmin.addMedia(actor, folderId, ids);
    return { count: mediaIds.length, ids: mediaIds };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
