import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { MAP_IMAGE_MAX_BYTES, MAP_UPLOAD_MAX_FILES, SERVER_MAPS_ACP_SECTION } from "@gcs/modules";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** 100 de fișiere × 5 MB, plus câmpurile formularului. */
const MAX_BODY_BYTES = MAP_UPLOAD_MAX_FILES * MAP_IMAGE_MAX_BYTES + 1024 * 1024;

/**
 * Încărcarea în masă a imaginilor hărților (ACP → Gaming → Hărți, specul 2026-10-08-servere-bridge §13):
 * `multipart/form-data` cu `game` și mai multe `files`; numele fișierului dă numele hărții. Fiecare imagine trece prin
 * pipeline-ul atașamentelor (tipul real din magic bytes, recodarea). Răspunde `GcsResult<{ saved, errors }>`.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ files: "too_large" });
    const actor = await assertAcpAction(SERVER_MAPS_ACP_SECTION, "edit");
    const form = await req.formData().catch(() => null);
    const game = form?.get("game");
    const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File && f.size > 0);
    if (typeof game !== "string") throw new GcsValidationError({ game: "required" });
    if (files.length > MAP_UPLOAD_MAX_FILES) throw new GcsValidationError({ files: "too_many" });
    if (files.some((f) => f.size > MAP_IMAGE_MAX_BYTES)) throw new GcsValidationError({ files: "too_large" });
    return services().bridge.maps.upload(
      actor,
      game,
      await Promise.all(files.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) }))),
    );
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
