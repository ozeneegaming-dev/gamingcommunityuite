import { GcsModuleRegistry, type GcsModule } from "@gcs/core";
import { coreModule } from "./core-module";
import { forumsModule } from "./forums";

/** Modulele aplicației, în ordinea înregistrării. */
export function appModules(): GcsModule[] {
  return [coreModule, forumsModule];
}

/** Registry-ul cu modulele aplicației (folosit de servicii, worker, seed, teste și E2E). */
export function createRegistry(extra: GcsModule[] = []): GcsModuleRegistry {
  const registry = new GcsModuleRegistry();
  for (const m of [...appModules(), ...extra]) registry.register(m);
  return registry;
}
