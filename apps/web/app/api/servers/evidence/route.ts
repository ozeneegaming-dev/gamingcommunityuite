import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { SANCTION_EVIDENCE_MAX_BYTES } from "@gcs/modules";
import { headers } from "next/headers";
import { isSameOrigin } from "@/lib/actions";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * O imagine-dovadă pentru o sancțiune nouă (specul 2026-10-08-servere-pagini §4): `multipart/form-data` cu `file`.
 * Doar cine poate da sancțiuni de pe site (serviciul verifică); imaginea trece prin pipeline-ul atașamentelor și se
 * leagă de sancțiune la creare. Răspunde cu `GcsResult<{ id, url }>`.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    const { serverQueries, bridge } = services();
    if (!(await serverQueries.appEnabled())) throw new GcsForbidden({ reason: "app_disabled" });
    if (Number(h.get("content-length") ?? "0") > SANCTION_EVIDENCE_MAX_BYTES + 64 * 1024) throw new GcsValidationError({ file: "too_large" });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new GcsValidationError({ file: "required" });
    return bridge.sanctions.uploadEvidence(await currentActor(), { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
