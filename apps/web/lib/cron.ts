import "server-only";
import { CRON_LAST_KEY, cronToken, realtimeSecret } from "@gcs/core";
import { services } from "./services";

/** Programarea recomandată în panoul gazdei: la 5 minute (cele mai multe gazde nu permit mai des). */
export const CRON_SCHEDULE = "*/5 * * * *";

export type GcsCronCommands = { schedule: string; node: string; curl: string | null };

/**
 * Comenzile cron ale ediției Lite, gata de copiat în panoul gazdei (cPanel → Cron Jobs, Plesk → Scheduled Tasks):
 * - `node cron.mjs` din folderul aplicației, cu exact Node-ul care rulează acum aplicația (`GCS_APP_ROOT` vine din
 *   `app.js`; fără el, folderul curent);
 * - sau `curl` pe `/api/cron?token=…`, pentru panourile care nu pot rula Node (tokenul e derivat din secretul aplicației).
 */
export function liteCronCommands(siteUrl: string | null | undefined): GcsCronCommands {
  const root = process.env.GCS_APP_ROOT ?? process.cwd();
  const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  const node = `cd ${quote(root)} && ${quote(process.execPath)} cron.mjs >/dev/null 2>&1`;
  const base = (siteUrl || process.env.GCS_BASE_URL || "").replace(/\/+$/, "");
  const curl = base ? `curl -fsS --max-time 60 ${quote(`${base}/api/cron?token=${cronToken(realtimeSecret())}`)} >/dev/null 2>&1` : null;
  return { schedule: CRON_SCHEDULE, node, curl };
}

/** Ultima rulare a cron-ului (ms) sau `null` dacă n-a rulat încă (cheia o scrie `/api/cron`). */
export async function cronLastRun(): Promise<number | null> {
  const raw = await services().kv.get(CRON_LAST_KEY).catch(() => null);
  const at = raw === null ? NaN : Number(raw);
  return Number.isFinite(at) ? at : null;
}
