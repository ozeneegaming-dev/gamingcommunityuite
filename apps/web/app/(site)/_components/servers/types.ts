import type { GcsServerLive } from "@gcs/modules";
import type { GcsIconSvgProps } from "@gcs/ui";

/** Iconița rezolvată pe server (doar datele SVG ajung în browser). */
export type GcsIconDef = GcsIconSvgProps["icon"];

/** Un server, cu tot ce le trebuie cardului, rândului din widget și antetului paginii lui (date simple). */
export type GcsServerCardData = {
  id: number;
  href: string;
  name: string;
  gameName: string;
  gameIcon: GcsIconDef | null;
  hasMap: boolean;
  address: string;
  connectHref: string | null;
  bannerUrl: string | null;
  bannerGradient: string;
  uptime30: number | null;
  status: GcsServerLive | null;
};

/** `/servers/{id}-{slug}`. */
export const serverHref = (s: { id: number; slug: string }) => `/servers/${s.id}-${s.slug}`;

/** Procentul de umplere a sloturilor (0–100). */
export const fillPercent = (s: GcsServerLive | null) => (s && s.online && s.maxPlayers > 0 ? Math.min(100, Math.round((s.players / s.maxPlayers) * 100)) : 0);
