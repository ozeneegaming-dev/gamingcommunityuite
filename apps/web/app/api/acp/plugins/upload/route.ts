import { GcsError, GcsForbidden, GcsValidationError, PLUGIN_ZIP_LIMITS, PLUGINS_ACP_SECTION, type GcsResult } from "@gcs/core";
import { getAcpContext } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const result = (body: GcsResult<{ id: string }>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failure = (error: GcsError) => result({ ok: false, error: error.toPayload() }, error.status);

/**
 * Încărcarea unei arhive de plugin din ACP (Sistem → Aplicații și pluginuri): CSRF (Origin), poarta ACP (2FA,
 * reautentificarea), dreptul `system.applications` (verificat de serviciu). Arhiva e validată și păstrată până la
 * confirmare; răspunsul are id-ul încărcării, pentru ecranul de confirmare.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return failure(new GcsForbidden({ reason: "csrf" }));
  const ctx = await getAcpContext();
  if (ctx.state !== "ok") return failure(new GcsForbidden({ reason: "acp_gate" }));
  const { acp, pluginAdmin } = services();
  if (!(await acp.can(ctx.actor, PLUGINS_ACP_SECTION, "edit"))) return failure(new GcsForbidden({ section: PLUGINS_ACP_SECTION, right: "edit" }));
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return failure(new GcsValidationError({ file: "required" }));
  }
  if (!(file instanceof File) || file.size === 0) return failure(new GcsValidationError({ file: "required" }));
  if (file.size > PLUGIN_ZIP_LIMITS.maxArchiveBytes) return failure(new GcsValidationError({ file: "too_large" }));
  try {
    const { id } = await pluginAdmin.stage(ctx.actor, { fileName: file.name, data: Buffer.from(await file.arrayBuffer()) });
    return result({ ok: true, data: { id } });
  } catch (error) {
    if (error instanceof GcsError) return failure(error);
    throw error;
  }
}
