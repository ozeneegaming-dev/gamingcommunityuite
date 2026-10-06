import { checkHealth, serviceStatus } from "@gcs/core";
import { getHealthDeps } from "@/lib/health-deps";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await checkHealth(getHealthDeps());
  const [worker, realtime] = report.redis
    ? await Promise.all([serviceStatus(services().redis, "worker").catch(() => null), serviceStatus(services().redis, "realtime").catch(() => null)])
    : [null, null];
  return Response.json({ ...report, worker: worker?.up ? "up" : "down", realtime: realtime?.up ? "up" : "down" }, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
