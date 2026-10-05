import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { isSameOrigin } from "@/lib/actions";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Peste limita celui mai permisiv grup (VIP Legend, 100 MB): cererea e refuzată înainte de a fi citită. */
const MAX_BODY_BYTES = 110 * 1024 * 1024;

/**
 * Încărcarea unui atașament din editor: `multipart/form-data` cu `file` și `forumId`.
 * Răspunde cu `GcsResult<GcsAttachmentInfo>`; atașamentul se leagă de postare la salvarea ei.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" });

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const forumId = form?.get("forumId");
    if (!(file instanceof File) || typeof forumId !== "string" || !/^\d+$/.test(forumId)) {
      throw new GcsValidationError({ file: "required" });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    return services().attachments.upload(
      await currentActor(),
      { name: file.name, bytes },
      { container: { type: "forum", id: forumId }, permission: "forums.upload" },
    );
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
