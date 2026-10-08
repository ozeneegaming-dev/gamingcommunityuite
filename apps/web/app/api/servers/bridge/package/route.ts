import { GcsForbidden, GcsValidationError, toResult } from "@gcs/core";
import { SERVERS_ACP_SECTION } from "@gcs/modules";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Pachetul pluginului de server (specul 2026-10-08-servere-plugin-v2 §4–5), din ACP: `{ serverId }` = arhiva serverului
 * (cu o cheie API nouă, pusă doar în arhivă), `{ game }` = pachetul general (fără cheie, înrolarea automată). Răspunsul e
 * arhiva ZIP; o eroare e `GcsResult` (JSON). Dreptul ca la cheile API, limita de 10 pe oră, cererea doar de pe site.
 */
export async function POST(req: Request): Promise<Response> {
  let download: { filename: string; bytes: Buffer } | null = null;
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    const actor = await assertAcpAction(SERVERS_ACP_SECTION, "edit");
    const body = (await req.json().catch(() => null)) as { serverId?: unknown; game?: unknown } | null;
    const { bridge } = services();
    if (body && Number.isInteger(body.serverId)) download = await bridge.packages.forServer(actor, body.serverId as number);
    else if (body && typeof body.game === "string") download = await bridge.packages.general(actor, body.game);
    else throw new GcsValidationError({ package: "invalid" });
    return null;
  });
  if (!result.ok || !download) return Response.json(result, { status: result.ok ? 500 : result.error.status });
  const { filename, bytes } = download as { filename: string; bytes: Buffer };
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Content-Length": String(bytes.length),
      // Arhiva pe server conține o cheie: nu se păstrează în niciun cache.
      "Cache-Control": "no-store, private",
    },
  });
}
