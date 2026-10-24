import "server-only";
import { GcsInstallState } from "@gcs/core";
import { BACKFILL_JOB, forumSlotsDemoModule } from "@gcs/modules";
import { closeGcsServices, createGcsServices, type GcsServices } from "@gcs/modules/services";
import { revalidateTag } from "next/cache";
import { gcsConfigDir } from "./config";

export type { GcsServices } from "@gcs/modules/services";

/** Revalidează paginile Next.js cache-uite; în afara unui request (ex. scripturi) nu e disponibil. */
function revalidate(tag: string): void {
  try {
    revalidateTag(tag, "max");
  } catch {
    // Apelat în afara contextului Next.js: nu există pagini de revalidat.
  }
}

function createServices(): GcsServices {
  return createGcsServices({
    configDir: gcsConfigDir(),
    revalidate,
    // Permisiunea de test folosită de E2E (ruta /_test/container/…); există doar cu GCS_TEST_ROUTES=1.
    extraModules:
      process.env.GCS_TEST_ROUTES === "1"
        ? [
            {
              key: "e2e",
              settings: [],
              acpMenu: [],
              eventListeners: [],
              permissions: [
                { key: "core.test_view", scope: "container", containerType: "test", labelKey: "permissions.core.test_view", default: {} },
              ],
            },
            // Forum v2: extensia demo a sloturilor forumului (nu apare pe niciun forum până nu e pornită din tabul ei).
            forumSlotsDemoModule,
          ]
        : [],
  });
}

// Un singur set de servicii pe proces (în dev, Next.js reîncarcă modulele).
const globalForServices = globalThis as unknown as { gcsServices?: GcsServices };

export function services(): GcsServices {
  if (!globalForServices.gcsServices) {
    const created = createServices();
    globalForServices.gcsServices = created;
    // Pluginurile (etapa 6) se încarcă în fundal, doar pe un site instalat; paginile care le folosesc așteaptă prima
    // încărcare (`ready`).
    void new GcsInstallState(gcsConfigDir())
      .isInstalled()
      .then(async (installed) => {
        if (!installed) return;
        // Ediția Lite (un singur proces, fără gcs-worker): joburile rulează și aici, cât timp gazda ține procesul pornit;
        // cron-ul (`/api/cron`) le duce mai departe când procesul e oprit.
        if (created.edition === "lite") {
          void created.jobs.start({ onError: (name, error) => console.error(`[GCS] Jobul ${name} a eșuat`, error) }).catch((error: unknown) => console.error("[GCS] Joburile nu au pornit", error));
          // Ce face gcs-worker la pornire în VPS: cheile web push (o singură dată) și evaluarea inițială a membrilor.
          void created.push.ensureKeys().catch((error: unknown) => console.error("[GCS] Cheile web push nu au putut fi generate", error));
          void created.jobs.enqueue(BACKFILL_JOB, {}, { jobId: "achievements-backfill" }).catch(() => {});
        }
        await created.plugins.start();
      })
      .catch((error: unknown) => console.error("[GCS] Pluginurile nu au pornit", error));
  }
  return globalForServices.gcsServices;
}

/**
 * Recreează serviciile la următorul apel (ex. după instalare, când baza de date s-a schimbat).
 * Instanța Better Auth, care le folosește, se recreează și ea.
 */
export async function resetServices(): Promise<void> {
  const current = globalForServices.gcsServices;
  globalForServices.gcsServices = undefined;
  (globalThis as unknown as { gcsAuth?: unknown }).gcsAuth = undefined;
  if (current) await closeGcsServices(current);
}
