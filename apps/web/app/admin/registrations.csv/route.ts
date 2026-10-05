import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Exportul CSV al widgetului „Înregistrări noi” (spec §12.3). Aceeași gardă ca ACP-ul: fără acces → 404. */
export async function GET(): Promise<Response> {
  const ctx = await getAcpContext();
  const { acp, acpDashboard } = services();
  if (ctx.state !== "ok" || !(await acp.can(ctx.actor, "system.dashboard", "view"))) {
    return new Response("Not Found", { status: 404 });
  }
  const rows = await acpDashboard.registrations(30);
  const csv = ["date,registrations", ...rows.map((r) => `${r.x},${r.y}`)].join("\n") + "\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="registrations.csv"',
      "Cache-Control": "no-store",
    },
  });
}
