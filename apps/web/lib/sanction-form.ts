import "server-only";
import type { GcsActor } from "@gcs/core";
import type { GcsSanctionAbilities } from "@/app/(site)/_components/servers/GcsSanctionForm";
import { isBridgeGameKey } from "@/app/(site)/_components/servers/types";
import { services } from "./services";

/**
 * Drepturile actorului pentru formularul sancțiunilor (specul 2026-10-08-servere-pagini §4), cu serverele de joc cu punte
 * pe care le vede; `null` = nu poate da nicio sancțiune de pe site.
 */
export async function sanctionAbilities(actor: GcsActor): Promise<GcsSanctionAbilities | null> {
  const { bridge, serverQueries } = services();
  const abilities = await bridge.sanctions.abilities(actor);
  if (!abilities.staff && abilities.grants.length === 0) return null;
  const servers = (await serverQueries.list(actor)).filter((s) => isBridgeGameKey(s.game.key)).map((s) => ({ id: s.id, name: s.name }));
  return { ...abilities, servers };
}
