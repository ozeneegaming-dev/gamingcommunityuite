import { GcsError } from "@gcs/core";
import { gdprExportZip } from "@gcs/modules";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Exportul GDPR al datelor personale ale unui membru (Membri v2): o arhivă ZIP cu un JSON pe aplicație. Aceeași gardă
 * ca ACP-ul (poarta, 2FA) și dreptul pe Cereri GDPR; fără ele → 404. Exportul intră în jurnal.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await getAcpContext();
  if (ctx.state !== "ok") return new Response("Not Found", { status: 404 });
  const { id } = await params;
  try {
    const { fileName, data } = await gdprExportZip(services().memberRemoval, ctx.actor, id);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof GcsError && (error.status === 403 || error.status === 404)) return new Response("Not Found", { status: 404 });
    throw error;
  }
}
