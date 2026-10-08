import { mapArtUrl, mapImageRoute } from "@gcs/modules/map-images";
import type { CSSProperties } from "react";

/**
 * Imaginea unei hărți, ca date simple (rezolvată pe server de `bridge.maps.images`): adresa aleasă după ordinea §13
 * (încărcată în ACP > șablonul direct sau copiat > arta GCS), arta jocului pentru rezervă și dacă vine de pe alt site.
 */
export type GcsMapPictureData = { map: string; url: string; fallback: string; external: boolean; kind: string };

/** Imaginea rezolvată pe server, dacă e pentru harta afișată acum; altfel ruta (un redirect, aceeași ordine). */
export function mapPicture(game: string, map: string, resolved?: GcsMapPictureData | null): GcsMapPictureData {
  if (resolved && resolved.map === map) return resolved;
  // Ruta poate trimite la o adresă externă (modul direct): se tratează ca imagine externă.
  return { map, url: mapImageRoute(game, map), fallback: mapArtUrl(game), external: true, kind: "route" };
}

/** Din rezultatul serviciului (`GcsMapImage`) în datele simple trimise clientului. */
export function toMapPicture(map: string, image: { url: string; fallback: string; external: boolean; kind: string }): GcsMapPictureData {
  return { map, url: image.url, fallback: image.fallback, external: image.external, kind: image.kind };
}

type Props = {
  image: GcsMapPictureData;
  className?: string;
  /** Imaginile locale de deasupra paginii (bannerul mare) se încarcă imediat; cele externe, mereu leneș. */
  eager?: boolean;
  testId?: string;
};

/**
 * Imaginea unei hărți peste arta generică a jocului (fundalul elementului): fără JavaScript, o imagine externă lipsă
 * (404) sau blocată (`alt=""` nu desenează nimic) lasă arta să se vadă, iar dimensiunile vin din CSS (fără salt de
 * layout). Imaginile externe: `referrerPolicy="no-referrer"`, `loading="lazy"`, `decoding="async"`. Fără hooks: merge
 * și în componentele server, și în cele client.
 */
export function GcsMapPicture({ image, className, eager = false, testId }: Props) {
  const art = image.url === image.fallback;
  return (
    <span
      className={`gcs-mapPic${className ? ` ${className}` : ""}`}
      style={{ "--gcs-map-art": `url("${image.fallback}")` } as CSSProperties}
      data-kind={image.kind}
      data-map={image.map}
      {...(testId ? { "data-testid": testId } : {})}
      aria-hidden="true"
    >
      {!art && <img src={image.url} alt="" loading={eager && !image.external ? "eager" : "lazy"} decoding="async" {...(image.external ? { referrerPolicy: "no-referrer" as const } : {})} />}
    </span>
  );
}
