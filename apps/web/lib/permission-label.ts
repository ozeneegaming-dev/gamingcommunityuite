import "server-only";
import type { GcsModuleRegistry, GcsPermissionDef } from "@gcs/core";

type Translator = { (key: string, values?: Record<string, string>): string; has: (key: string) => boolean };

/**
 * Eticheta unei permisiuni (pagina grupului, permisiunile individuale ale unui membru). Permisiunea de acces generată
 * a unei aplicații (`<app>.app_access`) primește numele aplicației: „Poate accesa aplicația Servere”.
 */
export function permissionLabel(def: GcsPermissionDef, t: Translator, registry: GcsModuleRegistry): string {
  const label = (key: string) => (t.has(key) ? t(key) : key);
  if (def.app) {
    const app = registry.module(def.app)?.app;
    return t("permissions.app_access", { app: app ? label(app.labelKey) : def.app });
  }
  return t.has(def.labelKey) ? t(def.labelKey) : def.key;
}
