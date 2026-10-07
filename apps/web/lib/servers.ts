import "server-only";
import type { GcsServerLive, GcsServerView } from "@gcs/modules";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { serverHref, type GcsIconDef, type GcsServerCardData } from "@/app/(site)/_components/servers/types";

/** Iconița după nume, rezolvată aici: la client ajung doar datele SVG (fără pachetele Font Awesome). */
export function iconDef(name: string): GcsIconDef | null {
  const def = resolveIcon(name);
  return def ? { prefix: def.prefix, iconName: def.iconName, icon: def.icon } : null;
}

/** Vederea unui server, ca date simple pentru componentele client (cardul, rândul din widget, antetul paginii). */
export function cardData(view: GcsServerView): GcsServerCardData {
  return {
    id: view.id,
    href: serverHref(view),
    name: view.name,
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

/** Statusurile inițiale ale furnizorului live (id → status). */
export function initialStatuses(views: GcsServerView[]): Record<number, GcsServerLive | null> {
  return Object.fromEntries(views.map((v) => [v.id, v.status]));
}
