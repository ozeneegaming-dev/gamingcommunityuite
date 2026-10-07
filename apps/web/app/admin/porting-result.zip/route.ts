import { PORTING_ACP_SECTION } from "@gcs/modules";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Arhiva rezultatului unei portări (folderul pluginului, pachetul instalabil, `ORIGINAL/`, `PORTING.md`, `report.json`).
 * Aceeași gardă ca ACP-ul (poarta ACP + dreptul `view` pe `system.porting`): fără acces sau fără rezultat → 404.
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await getAcpContext();
  const { acp, porting } = services();
  if (ctx.state !== "ok" || !(await acp.can(ctx.actor, PORTING_ACP_SECTION, "view"))) {
    return new Response("Not Found", { status: 404 });
  }
  const id = (new URL(request.url).searchParams.get("id") ?? "").slice(0, 64);
  const file = id ? await porting.download(ctx.actor, id).catch(() => null) : null;
  if (!file) return new Response("Not Found", { status: 404 });
  // Numele vine din cheia pluginului (validată), dar antetul primește oricum doar caractere sigure.
  const name = file.fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "port.zip";
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(file.data.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
