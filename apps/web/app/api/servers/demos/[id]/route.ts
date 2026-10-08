import { GcsError, GcsRateLimited } from "@gcs/core";
import { headers } from "next/headers";
import { clientIp, currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Descărcarea demo-ului unui meci mix (specul 2026-10-08-servere-hltv §6): fișierul stă privat în store-ul platformei și
 * iese doar pe aici, cu drepturile verificate la fiecare cerere (`bridge.demos.open`: aplicația, statisticile,
 * `servers.demos_download`, serverul vizibil), o limită pe viewer și contorul descărcărilor. Un demo păstrat comprimat
 * se decomprimă în flux: fișierul primit e `.dem`, gata de deschis în joc. Orice lipsă de acces → 404.
 */
export async function GET(_req: Request, { params }: Props): Promise<Response> {
  const { id } = await params;
  const { serverQueries, bridge } = services();
  if (!/^[1-9]\d{0,9}$/.test(id) || !(await serverQueries.appEnabled())) return new Response(null, { status: 404 });
  const actor = await currentActor();
  const viewer = actor.userId ? `u:${actor.userId}` : `ip:${clientIp(await headers())}`;
  try {
    const demo = await bridge.demos.open(actor, Number(id), viewer);
    return new Response(demo.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(demo.size),
        "Content-Disposition": `attachment; filename="${demo.fileName.replace(/[^A-Za-z0-9_.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(demo.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof GcsRateLimited) return new Response(null, { status: 429, headers: { "Retry-After": error.params?.retryAfter ?? "600" } });
    if (error instanceof GcsError) return new Response(null, { status: error.status === 403 ? 404 : error.status });
    throw error;
  }
}
