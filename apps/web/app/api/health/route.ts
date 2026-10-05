import { checkHealth, workerStatus } from "@gcs/core";
import { getHealthDeps } from "@/lib/health-deps";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await checkHealth(getHealthDeps());
  const worker = report.redis ? await workerStatus(services().redis).catch(() => null) : null;
  return Response.json({ ...report, worker: worker?.up ? "up" : "down" }, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
