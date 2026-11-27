import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { isSameOrigin } from "@/lib/actions";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 110 * 1024 * 1024;

/**
 * Atașamentele din editorul de mesaje private: `multipart/form-data` cu `file`. Permisiunea e `pm.send`
 * (fără container); atașamentul se leagă de mesaj la trimitere și îl văd doar participanții.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" });

    const actor = await currentActor();
    if (!actor.userId) throw new GcsForbidden({ permission: "pm.send" });

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new GcsValidationError({ file: "required" });
    return services().attachments.upload(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { permission: "pm.send" });
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
