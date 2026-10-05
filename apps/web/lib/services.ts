import "server-only";
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
          ]
        : [],
  });
}

// Un singur set de servicii pe proces (în dev, Next.js reîncarcă modulele).
const globalForServices = globalThis as unknown as { gcsServices?: GcsServices };

export function services(): GcsServices {
  globalForServices.gcsServices ??= createServices();
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
