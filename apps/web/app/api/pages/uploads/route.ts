import { GcsForbidden, GcsNotFound, GcsValidationError, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { isSameOrigin } from "@/lib/actions";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 110 * 1024 * 1024;

/**
 * Încărcarea unui fișier pentru o înregistrare sau un comentariu din aplicația Pagini (editorul, imaginea înregistrării,
 * câmpurile imagine / fișier): `multipart/form-data` cu `file` și `forumId` = id-ul bazei de date (numele câmpului
 * editorului comun). Cere dreptul de a trimite sau de a comenta în bază; fișierul se leagă la salvare.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const rawDb = form?.get("forumId");
    if (!(file instanceof File) || typeof rawDb !== "string" || !/^\d{1,10}$/.test(rawDb)) throw new GcsValidationError({ file: "required" });
    const actor = await currentActor();
    const { pagesAccess, attachments } = services();
    const d = await pagesAccess.database(Number(rawDb));
    if (!d || !(await pagesAccess.canViewDatabase(actor, d))) throw new GcsNotFound();
    if (!(await pagesAccess.canSubmit(actor, d)) && !(await pagesAccess.canComment(actor, d))) throw new GcsForbidden({ permission: "pages.submit" });
    return attachments.upload(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { permission: "pages.view" });
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
