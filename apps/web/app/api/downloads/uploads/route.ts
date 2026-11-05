import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { currentActor } from "@/lib/actor";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Începe încărcarea unui fișier în Descărcări: JSON `{ categoryId, fileId?, name, size }` → `{ id, chunkSize, received }`.
 * Extensia, mărimea și cota le verifică serviciul; bucățile urmează pe `PUT /api/downloads/uploads/<id>?offset=<n>`.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const categoryId = Number(body?.categoryId);
    const fileId = body?.fileId == null ? null : Number(body.fileId);
    const size = Number(body?.size);
    const name = typeof body?.name === "string" ? body.name.slice(0, 300) : "";
    if (!Number.isInteger(categoryId) || (fileId !== null && !Number.isInteger(fileId))) throw new GcsValidationError({ categoryId: "invalid" });
    return services().downloads.uploads.start(await currentActor(), { categoryId, fileId, name, size });
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
