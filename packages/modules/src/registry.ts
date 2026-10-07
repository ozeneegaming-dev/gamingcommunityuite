import { GcsModuleRegistry, type GcsModule } from "@gcs/core";
import { chatModule } from "./chat";
import { coreModule } from "./core-module";
import { forumsModule } from "./forums";
import { messagesModule } from "./messages";
import { profileModule } from "./profile";
import { serversModule } from "./servers";
import { vipModule } from "./vip";

/** Modulele aplicației, în ordinea înregistrării. */
export function appModules(): GcsModule[] {
  return [coreModule, forumsModule, profileModule, messagesModule, vipModule, chatModule, serversModule];
}

/** Registry-ul cu modulele aplicației (folosit de servicii, worker, seed, teste și E2E). */
export function createRegistry(extra: GcsModule[] = []): GcsModuleRegistry {
  const registry = new GcsModuleRegistry();
  for (const m of [...appModules(), ...extra]) registry.register(m);
  return registry;
}
