import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { isSameOrigin } from "@/lib/actions";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Peste limita celui mai permisiv grup: cererea e refuzată înainte de a fi citită. */
const MAX_BODY_BYTES = 110 * 1024 * 1024;

/**
 * Avatarul sau cover-ul (Setări → Profil): `multipart/form-data` cu `file`, `kind` (`avatar` | `cover`)
 * și, pentru cover, `positionY` (0–100). Răspunde cu `GcsResult<{ url }>`.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const kind = form?.get("kind");
    if (!(file instanceof File) || (kind !== "avatar" && kind !== "cover")) throw new GcsValidationError({ file: "required" });
    const actor = await currentActor();
    const input = { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) };
    const { profiles } = services();
    const url =
      kind === "avatar" ? await profiles.setAvatar(actor, input) : await profiles.setCover(actor, input, Number(form?.get("positionY") ?? 50));
    return { url };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
