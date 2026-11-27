import { CRON_LAST_KEY, GcsInstallState, GcsSqlJobQueue, realtimeSecret, verifyCronToken } from "@gcs/core";
import { gcsConfigDir } from "@/lib/config";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";
/** Gazdele opresc de obicei o cerere după 60–120 s; rularea se oprește singură înainte. */
export const maxDuration = 60;

const BUDGET_MS = 45_000;

/**
 * Cron-ul ediției Lite (panoul gazdei, la 1–5 minute: `curl …/api/cron?token=…` sau `node cron.mjs`): rulează joburile
 * scadente din coada SQL cu o limită de timp; ce rămâne trece la rularea următoare. Cererea trezește și procesul
 * oprit de gazdă. În ediția VPS joburile le rulează `gcs-worker`, deci aici nu se face nimic.
 */
async function run(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!verifyCronToken(token, realtimeSecret())) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!(await new GcsInstallState(gcsConfigDir()).isInstalled())) return Response.json({ error: "not_installed" }, { status: 503 });
  const s = services();
  await s.kv.set(CRON_LAST_KEY, String(Date.now()), { ttlMs: 7 * 86_400_000 }).catch(() => false);
  if (!(s.jobs instanceof GcsSqlJobQueue)) return Response.json({ ok: true, driver: s.jobs.driver, ran: 0 }, { headers: { "Cache-Control": "no-store" } });

  const errors: Array<{ name: string; error: string }> = [];
  const report = await s.jobs.runDue({
    budgetMs: BUDGET_MS,
    onError: (name, error) => {
      console.error(`[GCS] Jobul ${name} a eșuat`, error);
      errors.push({ name, error: error instanceof Error ? error.message : String(error) });
    },
  });
  const ok = report.failed === 0;
  return Response.json(
    { ok, driver: "sql", ...report, errors: errors.slice(0, 20) },
    { status: ok ? 200 : 207, headers: { "Cache-Control": "no-store" } }
  );
}

export const GET = run;
export const POST = run;
