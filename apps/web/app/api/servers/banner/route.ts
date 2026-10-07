import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { SERVERS_ACP_SECTION } from "@gcs/modules";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Bannerul unui server, încărcat din formularul ACP (specul 2026-10-07-servere §6): `multipart/form-data` cu `file`.
 * Trece prin pipeline-ul atașamentelor (tipul real din magic bytes, imaginea recodată, limita de upload a grupului);
 * rămâne nelegat până când formularul salvează serverul. Răspunde `GcsResult<{ id, url }>`.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" }, { maxMb: "8" });
    const actor = await assertAcpAction(SERVERS_ACP_SECTION, "edit");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    const uploaded = await services().attachments.upload(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { permission: "acp.access" });
    if (!uploaded.isImage) throw new GcsValidationError({ file: "invalid_image" });
    return { id: uploaded.id, url: uploaded.url };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
