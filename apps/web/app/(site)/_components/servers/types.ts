import type { GcsServerLive } from "@gcs/modules";
import { slugify } from "@gcs/modules/slug";
import type { GcsIconSvgProps } from "@gcs/ui";
import type { GcsMapPictureData } from "./GcsMapPicture";

/** Iconița rezolvată pe server (doar datele SVG ajung în browser). */
export type GcsIconDef = GcsIconSvgProps["icon"];

/** Un server, cu tot ce le trebuie cardului, rândului din widget și antetului paginii lui (date simple). */
export type GcsServerCardData = {
  id: number;
  href: string;
  name: string;
  /** Cheia jocului (catalogul): imaginea hărții se cere după ea. */
  game: string;
  gameName: string;
  gameIcon: GcsIconDef | null;
  hasMap: boolean;
  /** `game` / `voice` (TeamSpeak, Mumble) / `community` (Discord): textele „jucători / utilizatori / membri”. */
  kind: "game" | "voice" | "community";
  address: string;
  connectHref: string | null;
  /** „Intră pe TeamSpeak / Mumble / Discord”; `null` la jocuri. */
  joinHref: string | null;
  bannerUrl: string | null;
  bannerGradient: string;
  uptime30: number | null;
  status: GcsServerLive | null;
  /** Adminii recunoscuți acum pe server (lista ultimului heartbeat); 0 = niciunul. */
  adminsOnline: number;
  /** Imaginea hărții curente, rezolvată pe server (fără redirect); o hartă schimbată live trece prin rută. */
  mapImage?: GcsMapPictureData | null;
};

/** Cheia textului cu numărul de jucători: „jucători”, „utilizatori” (voce) sau „membri online” (Discord). */
export const countKey = (kind: GcsServerCardData["kind"]) => (kind === "voice" ? "users" : kind === "community" ? "membersOnline" : "players");

/** `/servers/{id}-{slug}`. */
export const serverHref = (s: { id: number; slug: string }) => `/servers/${s.id}-${s.slug}`;

/** Procentul de umplere a sloturilor (0–100). */
export const fillPercent = (s: GcsServerLive | null) => (s && s.online && s.maxPlayers > 0 ? Math.min(100, Math.round((s.players / s.maxPlayers) * 100)) : 0);

/** Slug-ul profilului unui jucător (numele din joc; un nume fără litere dă „player”). */
function playerSlug(name: string): string {
  const slug = slugify(name);
  return slug === "topic" && !/topic/i.test(name) ? "player" : slug;
}

/** `/servers/players/{id}-{slug}`: profilul unei identități de joc (și fără cont pe site). */
export const playerHref = (p: { id: number; name: string }, tab?: string) => `/servers/players/${p.id}-${playerSlug(p.name)}${tab && tab !== "overview" ? `?tab=${tab}` : ""}`;
export const matchHref = (id: number) => `/servers/matches/${id}`;
export const sanctionHref = (id: number) => `/bans/${id}`;
export const ticketPageHref = (id: number) => `/servers/tickets/${id}`;
/** Jocurile cu punte (pluginuri): doar ele au statistici, meciuri, admini în joc și imaginile hărților. */
export const isBridgeGameKey = (game: string) => game === "cs16" || game === "cs2";
