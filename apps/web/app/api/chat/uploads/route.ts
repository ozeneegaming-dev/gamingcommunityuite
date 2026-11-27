import { GcsForbidden, GcsNotFound, GcsValidationError, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { isSameOrigin } from "@/lib/actions";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 30 * 1024 * 1024;
const KEY_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

/**
 * Imaginile și mesajele vocale din chat: `multipart/form-data` cu `file` și `channel`. Permisiunea e `chat.write` pe
 * cameră (cu limita de mărime a grupului); fișierul se leagă de mesaj la trimitere și îl văd doar cei care citesc camera.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" });
    const { apps, chatQueries, attachments } = services();
    if (!(await apps.enabled("chat"))) throw new GcsNotFound();
    const actor = await currentActor();
    if (!actor.userId) throw new GcsForbidden({ reason: "login_required" });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const channel = form?.get("channel");
    if (!(file instanceof File)) throw new GcsValidationError({ file: "required" });
    if (typeof channel !== "string" || !KEY_RE.test(channel)) throw new GcsValidationError({ channel: "required" });
    // Camerele private nu se dezvăluie: fără acces, „nu există”.
    if (!(await chatQueries.canRead(actor, channel))) throw new GcsNotFound();
    return attachments.upload(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { container: { type: "chat", id: channel }, permission: "chat.write" });
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
