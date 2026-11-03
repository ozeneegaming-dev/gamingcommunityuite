import { GcsStatsReportService, statsReportSection } from "@gcs/modules";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";
import { reportOf, statsQuery, type GcsStatsSearch } from "../query";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ report: string }> };

/** CSV-ul unui raport din Statistici (aceeași perioadă și grupare ca pagina). Fără acces → 404, ca restul ACP-ului. */
export async function GET(req: Request, { params }: Props): Promise<Response> {
  const report = await reportOf((await params).report);
  const ctx = await getAcpContext();
  const { acp, statsReports, settings } = services();
  if (!report || ctx.state !== "ok" || !(await acp.can(ctx.actor, statsReportSection(report), "view"))) return new Response("Not Found", { status: 404 });
  const sp = Object.fromEntries(new URL(req.url).searchParams) as GcsStatsSearch;
  const timeZone = (await settings.get<string>("site.timezone").catch(() => "")) || "Europe/Bucharest";
  const q = statsQuery(sp, await statsReports.config(), timeZone);
  const r = await statsReports.run(ctx.actor, report, { from: q.from, to: q.to, group: q.group, timeZone });
  return new Response(GcsStatsReportService.csv(r), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}-${r.from}-${r.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
