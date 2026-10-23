/**
 * `gcs-worker` (spec §2.1, etapa 3 §5): rulează joburile din coada BullMQ (expirarea VIP, reguli de realizări,
 * promovări, sweep-uri zilnice). Logica stă în serviciile din `@gcs/modules`; aici doar pornim și oprim.
 *
 * Rulează din sursele TypeScript, cu `tsx`: `node --import tsx apps/worker/src/main.ts` (Docker) sau `pnpm --filter @gcs/worker dev`.
 */
import path from "node:path";
import { GcsInstallState, writeWorkerHeartbeat } from "@gcs/core";
import { BACKFILL_JOB } from "@gcs/modules";
import { closeGcsServices, createGcsServices } from "@gcs/modules/services";

const configDir = process.env.GCS_CONFIG_DIR ?? path.resolve(process.cwd(), ".gcs-config");
const INSTALL_POLL_MS = 5_000;

function log(message: string, error?: unknown): void {
  const line = { time: new Date().toISOString(), service: "gcs-worker", message, ...(error ? { error: String(error) } : {}) };
  (error ? console.error : console.log)(JSON.stringify(line));
}

/** Pe un site neinstalat (sau în timpul instalării) nu există încă baza de date: așteptăm `installed.lock`. */
async function waitForInstall(): Promise<void> {
  const state = new GcsInstallState(configDir);
  let announced = false;
  while (!(await state.isInstalled())) {
    if (!announced) log("Site-ul nu e instalat încă; aștept instalarea.");
    announced = true;
    await new Promise((r) => setTimeout(r, INSTALL_POLL_MS));
  }
}

async function main(): Promise<void> {
  await waitForInstall();
  const services = createGcsServices({ configDir });
  // Pluginurile (etapa 6): listenerii, joburile și filtrele lor rulează și aici, încărcate fără repornire.
  await services.plugins.start().catch((error: unknown) => log("Pluginurile nu au pornit", error));
  const stopWorker = await services.jobs.start({ onError: (name, error) => log(`Jobul ${name} a eșuat`, error) });
  await writeWorkerHeartbeat(services.redis);
  // Web push (Notificări v2): cheile VAPID se generează o singură dată și se păstrează criptate (nu apar în jurnal).
  await services.push
    .ensureKeys()
    .then((created) => created && log("Cheile web push au fost generate."))
    .catch((error: unknown) => log("Cheile web push nu au putut fi generate", error));
  // Evaluarea inițială a membrilor existenți (o singură dată; jobul verifică marcajul).
  await services.jobs.enqueue(BACKFILL_JOB, {}, { jobId: "achievements-backfill" });
  log(`Pornit; joburi: ${services.jobs.registered().map((j) => j.name).join(", ")}`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`Oprire (${signal})`);
    await stopWorker().catch((error: unknown) => log("Oprirea worker-ului a eșuat", error));
    await closeGcsServices(services);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  log("Pornirea a eșuat", error);
  process.exit(1);
});
