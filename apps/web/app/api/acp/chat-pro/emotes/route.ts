import { GcsError, GcsForbidden, GcsValidationError, type GcsResult } from "@gcs/core";
import { CHAT_PRO_ACP_EMOTES, type GcsChatEmoteView } from "@gcs/modules";
import { getAcpContext } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Corpul unei încărcări în masă: cel mult 50 de fișiere (limita pe fișier o verifică serviciul). */
const MAX_BODY_BYTES = 60 * 1024 * 1024;

type Out = { added: GcsChatEmoteView[]; rejected: { name: string; reason: string }[] };
const result = (body: GcsResult<Out>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failure = (error: GcsError) => result({ ok: false, error: error.toPayload() }, error.status);

/**
 * Încărcarea în masă a emoticoanelor Chat Pro (ACP → Comunitate → Chat Pro → Emoticoane): `multipart/form-data` cu
 * `packId` și `files`. CSRF (Origin), poarta ACP (2FA, reautentificare) și dreptul `edit` pe secțiune (verificat și de
 * serviciu). Răspunsul spune ce s-a adăugat și ce s-a respins (cu motivul).
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return failure(new GcsForbidden({ reason: "csrf" }));
  const ctx = await getAcpContext();
  if (ctx.state !== "ok") return failure(new GcsForbidden({ reason: "acp_gate" }));
  const { acp, chatPro } = services();
  if (!(await acp.can(ctx.actor, CHAT_PRO_ACP_EMOTES, "edit"))) return failure(new GcsForbidden({ section: CHAT_PRO_ACP_EMOTES, right: "edit" }));
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return failure(new GcsValidationError({ files: "too_large" }));
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure(new GcsValidationError({ files: "required" }));
  }
  const packId = Number(form.get("packId"));
  if (!Number.isInteger(packId) || packId < 1) return failure(new GcsValidationError({ packId: "required" }));
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  try {
    const out = await chatPro.emotes.upload(
      ctx.actor,
      packId,
      await Promise.all(files.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) }))),
    );
    return result({ ok: true, data: out });
  } catch (error) {
    if (error instanceof GcsError) return failure(error);
    throw error;
  }
}
