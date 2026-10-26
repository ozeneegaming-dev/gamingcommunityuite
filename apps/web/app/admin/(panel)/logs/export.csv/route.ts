import { auditCsv, exportAudit } from "@gcs/core";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";
import { auditFilters, type GcsLogSearch } from "../filters";

export const dynamic = "force-dynamic";

/**
 * Exportul CSV al jurnalului (aceleași filtre ca pagina, cel mult 10 000 de rânduri). Aceeași gardă ca ACP-ul și
 * dreptul pe jurnal; fără ele → 404.
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await getAcpContext();
  if (ctx.state !== "ok") return new Response("Not Found", { status: 404 });
  const { acp, db } = services();
  if (!(await acp.can(ctx.actor, "system.logs", "view"))) return new Response("Not Found", { status: 404 });
  const sp = Object.fromEntries(new URL(request.url).searchParams) as GcsLogSearch;
  const filters = await auditFilters(db, sp);
  const csv = auditCsv(filters ? await exportAudit(db, filters) : []);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gcs-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
