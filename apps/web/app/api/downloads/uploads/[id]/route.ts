import { DOWNLOAD_CHUNK_BYTES } from "@gcs/modules";
import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { headers } from "next/headers";
import { currentActor } from "@/lib/actor";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * O bucată a unui fișier (corp binar, cel mult o bucată): `PUT ?offset=<n>`. O bucată repetată se confirmă; ultima
 * pornește verificarea (tipul real, antivirusul). Răspuns: `{ received, complete? }`.
 */
export async function PUT(req: Request, { params }: Props): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > DOWNLOAD_CHUNK_BYTES + 1024) throw new GcsValidationError({ chunk: "too_large" });
    const actor = await currentActor();
    if (!actor.userId) throw new GcsForbidden({ reason: "unauthorized" });
    const { id } = await params;
    const offset = Number(new URL(req.url).searchParams.get("offset"));
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length > DOWNLOAD_CHUNK_BYTES) throw new GcsValidationError({ chunk: "too_large" });
    return services().downloads.uploads.chunk(actor, id, offset, bytes);
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}

/** Renunță la un fișier încă nelegat de o trimitere. */
export async function DELETE(_req: Request, { params }: Props): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    const actor = await currentActor();
    if (!actor.userId) throw new GcsForbidden({ reason: "unauthorized" });
    const { id } = await params;
    await services().downloads.uploads.cancel(actor, id);
    return null;
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
