import { GcsError, GcsForbidden, GcsValidationError, PLUGIN_ZIP_LIMITS, type GcsResult } from "@gcs/core";
import { PORTING_ACP_SECTION } from "@gcs/modules";
import { getAcpContext } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Aceeași limită ca pachetele de plugin (8 MB); cititorul sursei o verifică din nou, împreună cu celelalte limite. */
const MAX_BYTES = PLUGIN_ZIP_LIMITS.maxArchiveBytes;

const result = (body: GcsResult<{ id: string }>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failure = (error: GcsError) => result({ ok: false, error: error.toPayload() }, error.status);

/**
 * Încărcarea pluginului sursă în asistentul de portare (ACP → Sistem → Conversii → Portare plugin): CSRF (Origin),
 * poarta ACP (2FA, reautentificare) și dreptul `edit` pe `system.porting` (verificat aici și din nou de serviciu).
 * Arhiva e doar citită și analizată (formatul, metadatele, licența, numerele): nimic nu se convertește, nu se execută
 * și nu se instalează. Răspunsul are id-ul portării, pentru pasul de confirmare a dreptului.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return failure(new GcsForbidden({ reason: "csrf" }));
  const ctx = await getAcpContext();
  if (ctx.state !== "ok") return failure(new GcsForbidden({ reason: "acp_gate" }));
  const { acp, porting } = services();
  if (!(await acp.can(ctx.actor, PORTING_ACP_SECTION, "edit"))) return failure(new GcsForbidden({ section: PORTING_ACP_SECTION, right: "edit" }));
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return failure(new GcsValidationError({ file: "required" }));
  }
  if (!(file instanceof File) || file.size === 0) return failure(new GcsValidationError({ file: "required" }));
  if (file.size > MAX_BYTES) return failure(new GcsValidationError({ file: "archive_too_large" }, { max: String(MAX_BYTES) }));
  try {
    const { id } = await porting.analyze(ctx.actor, { fileName: file.name, data: Buffer.from(await file.arrayBuffer()) });
    return result({ ok: true, data: { id } });
  } catch (error) {
    if (error instanceof GcsError) return failure(error);
    throw error;
  }
}
