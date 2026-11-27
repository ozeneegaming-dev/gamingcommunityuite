import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { currentActor } from "@/lib/actor";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Logo-ul sau bannerul unui clan (specul 2026-10-08-clanuri §9), din formularul de creare sau din setări:
 * `multipart/form-data` cu `kind` (`logo` / `banner`), `clanId` (gol la creare) și `file`. Trece prin pipeline-ul
 * atașamentelor (tipul real din magic bytes, recodare WebP fără EXIF, limita din opțiuni); dreptul (`clans.create` sau
 * dreptul de editare în clan) îl verifică serviciul. Rămâne nelegat până la salvarea formularului.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" });
    const actor = await currentActor();
    if (!actor.userId) throw new GcsForbidden({ reason: "unauthorized" });
    const form = await req.formData().catch(() => null);
    const kind = form?.get("kind");
    const rawClan = form?.get("clanId");
    const file = form?.get("file");
    if (kind !== "logo" && kind !== "banner") throw new GcsValidationError({ kind: "invalid_choice" });
    const clanId = typeof rawClan === "string" && /^\d{1,10}$/.test(rawClan) ? Number(rawClan) : null;
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    const uploaded = await services().clans.uploadImage(actor, kind, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, clanId);
    return { id: uploaded.id, url: uploaded.url };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
