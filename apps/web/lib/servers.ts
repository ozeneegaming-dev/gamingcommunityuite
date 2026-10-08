import "server-only";
import type { GcsActor } from "@gcs/core";
import type { GcsServerLive, GcsServerView } from "@gcs/modules";
import { services } from "./services";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { serverHref, type GcsIconDef, type GcsServerCardData } from "@/app/(site)/_components/servers/types";

/** Iconița după nume, rezolvată aici: la client ajung doar datele SVG (fără pachetele Font Awesome). */
export function iconDef(name: string): GcsIconDef | null {
  const def = resolveIcon(name);
  return def ? { prefix: def.prefix, iconName: def.iconName, icon: def.icon } : null;
}

/**
 * Vederea unui server, ca date simple pentru componentele client (cardul, rândul din widget, antetul paginii).
 * `adminsOnline`: adminii recunoscuți acum pe server (indicatorul „Admin online”, din `bridge.queries.adminsOnlineCounts`).
 */
export function cardData(view: GcsServerView, adminsOnline = 0): GcsServerCardData {
  return {
    id: view.id,
    href: serverHref(view),
    name: view.name,
    game: view.game.key,
    adminsOnline,
    gameName: view.game.name,
    gameIcon: iconDef(view.game.icon),
    hasMap: view.game.hasMap,
    address: view.address,
    connectHref: view.connectHref,
    bannerUrl: view.bannerUrl,
    bannerGradient: view.bannerGradient,
    uptime30: view.uptime30,
    status: view.status,
  };
}

/** Datele cardurilor, cu indicatorul „Admin online” (o singură citire pentru toate serverele). */
export async function cardsData(actor: GcsActor, views: GcsServerView[]): Promise<GcsServerCardData[]> {
  const counts = await services().bridge.queries.adminsOnlineCounts(actor, views.map((v) => v.id));
  return views.map((v) => cardData(v, counts.get(v.id) ?? 0));
}

/** Statusurile inițiale ale furnizorului live (id → status). */
export function initialStatuses(views: GcsServerView[]): Record<number, GcsServerLive | null> {
  return Object.fromEntries(views.map((v) => [v.id, v.status]));
}
