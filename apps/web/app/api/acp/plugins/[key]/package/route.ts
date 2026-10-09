import { GcsError, isPluginKey } from "@gcs/core";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Exportul pachetului unui plugin (ACP → Sistem → Aplicații → ⋯ → Exportă pachetul): arhiva instalată, ca descărcare.
 * Poarta ACP (2FA, reautentificare) și dreptul de editare pe pluginuri (verificat de serviciu); fără drept → 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }): Promise<Response> {
  const key = decodeURIComponent((await params).key);
  if (!isPluginKey(key)) return notFound();
  const ctx = await getAcpContext();
  if (ctx.state !== "ok") return notFound();
  try {
    const { fileName, data } = await services().pluginAdmin.exportPackage(ctx.actor, key);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(data.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof GcsError) return notFound();
    throw error;
  }
}
