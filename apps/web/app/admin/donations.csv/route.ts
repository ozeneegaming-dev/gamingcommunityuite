import { DONATIONS_ACP_SECTION } from "@gcs/modules";
import type { NextRequest } from "next/server";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Exportul CSV al listei ACP › VIP & Magazin › Donații, cu filtrele paginii (parametrii adresei: stare, căutare, metodă,
 * interval). Aceeași gardă ca ACP-ul: fără acces → 404. Intră în jurnal.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const ctx = await getAcpContext();
  const { acp, donations } = services();
  if (ctx.state !== "ok" || !(await acp.can(ctx.actor, DONATIONS_ACP_SECTION, "view"))) {
    return new Response("Not Found", { status: 404 });
  }
  const sp = request.nextUrl.searchParams;
  const get = (k: string) => sp.get(k) ?? undefined;
  const csv = await donations.exportCsv(ctx.actor, { status: get("status"), q: get("q"), method: get("method"), from: get("from"), to: get("to") });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="donations-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
