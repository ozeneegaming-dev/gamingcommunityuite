import "server-only";
import type { GcsActor } from "@gcs/core";
import type { GcsServerLive, GcsServerView } from "@gcs/modules";
import { services } from "./services";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { toMapPicture, type GcsMapPictureData } from "@/app/(site)/_components/servers/GcsMapPicture";
import { isBridgeGameKey, serverHref, type GcsIconDef, type GcsServerCardData } from "@/app/(site)/_components/servers/types";

/** Iconița după nume, rezolvată aici: la client ajung doar datele SVG (fără pachetele Font Awesome). */
export function iconDef(name: string): GcsIconDef | null {
  const def = resolveIcon(name);
  return def ? { prefix: def.prefix, iconName: def.iconName, icon: def.icon } : null;
}

/**
 * Vederea unui server, ca date simple pentru componentele client (cardul, rândul din widget, antetul paginii).
 * `adminsOnline`: adminii recunoscuți acum pe server (indicatorul „Admin online”, din `bridge.queries.adminsOnlineCounts`).
 */
export function cardData(view: GcsServerView, adminsOnline = 0, mapImage: GcsMapPictureData | null = null): GcsServerCardData {
  return {
    mapImage,
    id: view.id,
    href: serverHref(view),
    name: view.name,
    game: view.game.key,
    adminsOnline,
    gameName: view.game.name,
    gameIcon: iconDef(view.game.icon),
    hasMap: view.game.hasMap,
    kind: view.game.kind,
    address: view.address,
    connectHref: view.connectHref,
    joinHref: view.joinHref,
    bannerUrl: view.bannerUrl,
    bannerGradient: view.bannerGradient,
    uptime30: view.uptime30,
    status: view.status,
  };
}

/** Datele cardurilor, cu indicatorul „Admin online” și imaginea hărții curente (câte o citire pe joc). */
export async function cardsData(actor: GcsActor, views: GcsServerView[]): Promise<GcsServerCardData[]> {
  const [counts, images] = await Promise.all([services().bridge.queries.adminsOnlineCounts(actor, views.map((v) => v.id)), bannerMapImages(views)]);
  return views.map((v) => cardData(v, counts.get(v.id) ?? 0, images.get(v.id) ?? null));
}

/** Harta din banner: doar la jocurile cu punte, fără banner încărcat, cu serverul online. */
export const bannerMap = (v: GcsServerView): string | null => (!v.bannerUrl && isBridgeGameKey(v.game.key) && v.status?.online && v.status.map ? v.status.map : null);

/**
 * Imaginile hărților din bannere, rezolvate pe server (ordinea §13: imaginea din ACP > șablonul direct sau copiat > arta),
 * ca browserul să nu mai treacă prin redirect: o citire pe joc.
 */
export async function bannerMapImages(views: GcsServerView[]): Promise<Map<number, GcsMapPictureData>> {
  const byGame = new Map<string, { id: number; map: string }[]>();
  for (const v of views) {
    const map = bannerMap(v);
    if (map) byGame.set(v.game.key, [...(byGame.get(v.game.key) ?? []), { id: v.id, map }]);
  }
  const out = new Map<number, GcsMapPictureData>();
  await Promise.all(
    [...byGame].map(async ([game, list]) => {
      const images = await mapPictures(game, list.map((l) => l.map));
      for (const l of list) {
        const image = images.get(l.map);
        if (image) out.set(l.id, image);
      }
    }),
  );
  return out;
}

/** Imaginile mai multor hărți ale unui joc (o citire), ca date simple pentru componente. */
export async function mapPictures(game: string, maps: string[]): Promise<Map<string, GcsMapPictureData>> {
  const unique = [...new Set(maps.filter(Boolean))];
  if (unique.length === 0 || !isBridgeGameKey(game)) return new Map();
  const images = await services().bridge.maps.images(game, unique);
  return new Map([...images].map(([map, image]) => [map, toMapPicture(map, image)]));
}

/** Statusurile inițiale ale furnizorului live (id → status). */
export function initialStatuses(views: GcsServerView[]): Record<number, GcsServerLive | null> {
  return Object.fromEntries(views.map((v) => [v.id, v.status]));
}
