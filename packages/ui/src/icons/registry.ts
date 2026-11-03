import type { IconDefinition, IconPack } from "@fortawesome/fontawesome-common-types";
import { fab } from "@fortawesome/free-brands-svg-icons";
import { far } from "@fortawesome/free-regular-svg-icons";
import { fas } from "@fortawesome/free-solid-svg-icons";

/**
 * Iconițele Font Awesome Free după nume (`fa-solid fa-gamepad`), pentru iconițele alese din ACP (forumuri, meniu,
 * grupuri, câmpuri, widget-uri). Importă toate pachetele: se folosește doar pe server (componente server, validare,
 * API-ul selectorului). Componentele client folosesc `GcsIconSvg` cu iconițe importate individual.
 */
export const GCS_ICON_STYLES = ["fa-solid", "fa-regular", "fa-brands"] as const;
export type GcsIconStyle = (typeof GCS_ICON_STYLES)[number];

const PACKS: Record<GcsIconStyle, IconPack> = { "fa-solid": fas, "fa-regular": far, "fa-brands": fab };
const NAME_RE = /^(fa-solid|fa-regular|fa-brands) fa-([a-z0-9-]{1,60})$/;

let index: Map<string, IconDefinition> | undefined;

/** `fa-solid fa-gamepad` → definiția; pachetele au și aliasuri, deci indexul e după `iconName`. */
function iconIndex(): Map<string, IconDefinition> {
  if (index) return index;
  index = new Map();
  for (const style of GCS_ICON_STYLES) {
    for (const def of Object.values(PACKS[style])) {
      const key = `${style} fa-${def.iconName}`;
      if (!index.has(key)) index.set(key, def);
    }
  }
  return index;
}

export function resolveIcon(name: string | null | undefined): IconDefinition | null {
  if (typeof name !== "string" || !NAME_RE.test(name)) return null;
  return iconIndex().get(name) ?? null;
}

/** Validarea pe server a unei iconițe trimise din formulare. */
export function isGcsIcon(name: unknown): name is string {
  return typeof name === "string" && resolveIcon(name) !== null;
}

export type GcsIconMatch = { name: string; width: number; height: number; path: string };

const s = (names: string) => names.split(" ").map((n) => `fa-solid fa-${n}`);
const b = (names: string) => names.split(" ").map((n) => `fa-brands fa-${n}`);

/**
 * Categoriile selectorului de iconițe, cu iconițele alese de mână (întâi cele folosite des într-o comunitate de gaming);
 * fără căutare, selectorul deschide „Populare”, nu lista alfabetică (care începe cu cifrele 0–9).
 */
export const GCS_ICON_CATEGORIES = {
  popular: s(
    "trophy crown star shield-halved medal award gamepad headset desktop fire bolt heart users user comments bullhorn calendar-days gift gem rocket flag skull crosshairs circle-info circle-question gear lock link envelope",
  ),
  gaming: s(
    "gamepad headset crosshairs skull dragon chess-knight dice dice-d20 puzzle-piece ghost robot rocket person-rifle bomb shield-halved khanda hat-wizard wand-sparkles map map-location-dot compass mountain-sun car flag-checkered stopwatch ranking-star trophy medal server",
  ),
  community: s(
    "users user user-group people-group comments comment message bullhorn newspaper heart thumbs-up face-smile hand handshake gift cake-candles calendar-days champagne-glasses music camera image video microphone globe earth-europe language hashtag at",
  ),
  staff: s(
    "shield-halved user-shield user-tie gavel scale-balanced ban triangle-exclamation circle-exclamation flag eye eye-slash lock unlock key clipboard-check list-check circle-check user-check user-xmark user-lock hammer screwdriver-wrench toolbox",
  ),
  tech: s(
    "desktop laptop mobile-screen microchip memory hard-drive keyboard computer-mouse display server network-wired wifi plug code terminal bug database cloud download upload gear gears sliders wrench battery-full",
  ),
  rewards: s(
    "trophy medal award crown star star-half-stroke gem coins sack-dollar money-bill-wave ticket gift certificate ribbon fire bolt rocket arrow-trend-up chart-line ranking-star circle-up thumbs-up heart hand-holding-heart",
  ),
  arrows: s(
    "arrow-up arrow-down arrow-left arrow-right arrow-up-right-from-square arrows-rotate rotate share reply forward backward chevron-up chevron-down angles-up angles-down circle-arrow-up circle-arrow-right caret-up caret-down up-long down-long",
  ),
  brands: b(
    "discord steam twitch youtube tiktok instagram facebook x-twitter reddit github teamspeak playstation xbox battle-net windows apple android telegram whatsapp spotify kickstarter-k patreon paypal",
  ),
} as const;
export type GcsIconCategory = keyof typeof GCS_ICON_CATEGORIES;
export const GCS_ICON_CATEGORY_KEYS = Object.keys(GCS_ICON_CATEGORIES) as GcsIconCategory[];
export const isGcsIconCategory = (v: unknown): v is GcsIconCategory => typeof v === "string" && v in GCS_ICON_CATEGORIES;

function match(name: string, def: IconDefinition): GcsIconMatch {
  const [width, height, , , path] = def.icon;
  return { name, width, height, path: Array.isArray(path) ? path.join(" ") : path };
}

/** O iconiță după nume (butonul selectorului arată iconița aleasă). */
export function iconMatch(name: string): GcsIconMatch | null {
  const def = resolveIcon(name);
  return def ? match(name, def) : null;
}

/**
 * Căutarea din selectorul de iconițe (cu datele SVG, ca să fie randate): cu text, primele `limit` iconițe care îl conțin
 * (la „Mărci”, doar mărcile); fără text, iconițele categoriei (implicit „Populare”).
 */
export function searchIcons(query: string, limit = 60, category?: GcsIconCategory): GcsIconMatch[] {
  const q = query.trim().toLowerCase().replace(/^fa-/, "");
  const out: GcsIconMatch[] = [];
  if (!q) {
    for (const name of GCS_ICON_CATEGORIES[category ?? "popular"]) {
      const def = resolveIcon(name);
      if (def) out.push(match(name, def));
      if (out.length >= limit) break;
    }
    return out;
  }
  // Căutarea trece prin toate iconițele (o categorie ar fi prea mică), doar „Mărci” rămâne la mărci.
  for (const [name, def] of iconIndex()) {
    if (!name.includes(q) || (category === "brands" && !name.startsWith("fa-brands"))) continue;
    out.push(match(name, def));
    if (out.length >= limit) break;
  }
  return out;
}
