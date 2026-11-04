import { GcsModuleRegistry, type GcsModule } from "@gcs/core";
import { chatModule } from "./chat";
import { chatProModule } from "./chat-pro";
import { clansModule } from "./clans";
import { coreModule } from "./core-module";
import { downloadsModule } from "./downloads";
import { forumsModule } from "./forums";
import { groupsProModule } from "./groups-pro";
import { messagesModule } from "./messages";
import { profileModule } from "./profile";
import { serversModule } from "./servers";
import { vipModule } from "./vip";

/** Modulele aplicației, în ordinea înregistrării. */
export function appModules(): GcsModule[] {
  return [coreModule, forumsModule, profileModule, messagesModule, vipModule, chatModule, chatProModule, groupsProModule, serversModule, clansModule, downloadsModule];
}

/** Registry-ul cu modulele aplicației (folosit de servicii, worker, seed, teste și E2E). */
export function createRegistry(extra: GcsModule[] = []): GcsModuleRegistry {
  const registry = new GcsModuleRegistry();
  for (const m of [...appModules(), ...extra]) registry.register(m);
  return registry;
}
