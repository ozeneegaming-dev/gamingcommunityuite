import { IMPORT_ACP_SECTION } from "@gcs/modules";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Raportul final al unui import, ca CSV (specul importului, §5). Aceeași gardă ca ACP-ul: fără acces → 404. */
export async function GET(request: Request): Promise<Response> {
  const ctx = await getAcpContext();
  const { acp, importer } = services();
  if (ctx.state !== "ok" || !(await acp.can(ctx.actor, IMPORT_ACP_SECTION, "view"))) {
    return new Response("Not Found", { status: 404 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const csv = await importer.reportCsv(ctx.actor, id).catch(() => null);
  if (csv === null) return new Response("Not Found", { status: 404 });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="import-report.csv"',
      "Cache-Control": "no-store",
    },
  });
}
