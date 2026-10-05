import { checkHealth } from "@gcs/core";
import { getHealthDeps } from "@/lib/health-deps";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await checkHealth(getHealthDeps());
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
