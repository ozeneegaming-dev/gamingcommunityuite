/**
 * `gcs-realtime` (specul etapei 4 §5): Socket.io pentru notificări, chat, prezență și topicuri live.
 * Logica de acces stă în `@gcs/modules` (`GcsRealtimeRooms`); aici doar pornim și oprim.
 *
 * Rulează din sursele TypeScript, cu `tsx`: `node --import tsx apps/realtime/src/main.ts` (Docker) sau `pnpm --filter @gcs/realtime dev`.
 */
import path from "node:path";
import { GcsInstallState, realtimeSecret } from "@gcs/core";
import { closeGcsServices, createGcsServices } from "@gcs/modules/services";
import { createRealtimeServer } from "./server";

const configDir = process.env.GCS_CONFIG_DIR ?? path.resolve(process.cwd(), ".gcs-config");
const port = Number(process.env.PORT ?? 4000);
const INSTALL_POLL_MS = 5_000;

function log(message: string, error?: unknown): void {
  const line = { time: new Date().toISOString(), service: "gcs-realtime", message, ...(error ? { error: String(error) } : {}) };
  (error ? console.error : console.log)(JSON.stringify(line));
}

/** Pe un site neinstalat nu există încă baza de date: așteptăm `installed.lock`. */
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
  // `GCS_SECRET` poate veni și din `.env.runtime` (scris de installer): `createGcsServices` l-a încărcat deja.
  const server = createRealtimeServer({
    services,
    secret: realtimeSecret(),
    corsOrigin: process.env.GCS_BASE_URL ? [process.env.GCS_BASE_URL] : true,
  });
  await server.listen(port);
  log(`Pornit pe portul ${port}`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`Oprire (${signal})`);
    await server.close().catch((error: unknown) => log("Oprirea serverului a eșuat", error));
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
