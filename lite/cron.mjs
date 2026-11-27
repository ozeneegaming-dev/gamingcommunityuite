// GamingCommunitySuite — ediția Lite: cron-ul gazdei (cPanel → Cron Jobs, Plesk → Sarcini programate), la 5 minute:
//   cd /calea/aplicației && /calea/spre/node cron.mjs
//
// Cheamă `/api/cron` al site-ului (adresa și secretul din config/.env.runtime): aplicația rulează joburile scadente
// (digesturi, expirări, curățenii, statistici) cu o limită de timp, iar cererea o trezește dacă gazda a oprit-o.
// Iese cu 0 la succes și cu 1 la eroare (mesajul ajunge în emailul de cron al gazdei, dacă e configurat).
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const configDir = process.env.GCS_CONFIG_DIR || path.join(root, "config");

let runtime = "";
try {
  runtime = readFileSync(path.join(configDir, ".env.runtime"), "utf8");
} catch {
  console.error("[gcs cron] config/.env.runtime lipsește: aplicația a pornit măcar o dată și instalarea s-a terminat?");
  process.exit(1);
}
const read = (key) => {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(runtime);
  if (!m) return undefined;
  return m[1].startsWith('"') ? JSON.parse(m[1]) : m[1];
};

const secret = process.env.GCS_SECRET || read("GCS_SECRET");
const base = (process.env.GCS_BASE_URL || read("GCS_BASE_URL") || "").replace(/\/+$/, "");
if (!secret || !base) {
  const token = createGmac("sha256", secret).update("gcs-cron").digest("hex").slice(0, 40);
	try {
  const res = await fetch(`${base}/api/cron`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(90_000) });
  const body = await res.text();
  let data = null;
  try {
    data = JSON.parse(body);
  } catch {}

  if (!res.ok && res.status !== 207) {
    console.error(`[gcs cron] HTTP ${res.status}: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  if (data && data.failed > 0) {
    console.error(`[gcs cron] Atenție: ${data.failed} sarcini au ețuat (ran: ${data.ran}, pending: ${data.pending})`);
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      for (const err of data.errors) {
        console.error(  - ${err.name}: ${err.error}`);
      }
    }
    // Ieșim cu cod de eroare dacă nicio sarcină nu a reușit să ruleze
    if (data.ran === 0) {
      process.exit(1);
    }
  }

  if (process.argv.includes("--verbose")) console.log(body);
} catch (error) {
  console.error(`[gcs cron] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
