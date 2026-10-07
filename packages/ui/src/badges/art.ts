/**
 * Insignele badge-urilor (specul `2026-10-07-insigne-grafice.md`): descrierea unei insigne (formă, nivel, culoare,
 * glifă), rezolvarea ei din câmpurile unui badge și adresa imaginii. Fără React și fără iconițe: merge și în client
 * (previzualizarea din ACP), și în șabloane (adresa e un text simplu).
 */

export const GCS_BADGE_SHAPES = ["medal", "shield", "hexagon", "rosette", "diamond", "star"] as const;
export type GcsBadgeShape = (typeof GCS_BADGE_SHAPES)[number];

export const GCS_BADGE_TIERS = ["bronze", "silver", "gold", "platinum", "custom"] as const;
export type GcsBadgeTier = (typeof GCS_BADGE_TIERS)[number];

export const GCS_BADGE_ICON_STYLES = ["solid", "regular", "brands"] as const;
export type GcsBadgeIconStyle = (typeof GCS_BADGE_ICON_STYLES)[number];

/** Mărimile insignelor (px): 16 liste dense, 24 activitate/antet, 32 postbit/hover card, 48–64 profil, 96 ACP. */
export const GCS_BADGE_SIZES = [16, 24, 32, 48, 64, 96] as const;
export type GcsBadgeSize = (typeof GCS_BADGE_SIZES)[number];

export type GcsBadgeGlyph = { kind: "icon"; style: GcsBadgeIconStyle; name: string } | { kind: "text"; text: string };

/** O insignă complet descrisă: totul vine din liste fixe, plus o culoare `#RRGGBB` validată și o glifă validată. */
export type GcsBadgeArtSpec = { shape: GcsBadgeShape; tier: GcsBadgeTier; color: string; glyph: GcsBadgeGlyph };

/** Câmpurile unui badge din care se rezolvă insigna (coloanele `badges`). */
export type GcsBadgeArtFields = {
  name: string;
  color: string;
  manual?: boolean | null;
  symbol?: string | null;
  artShape?: string | null;
  artTier?: string | null;
  artIcon?: string | null;
};

/** Iconițele propuse în editorul din ACP înainte de căutare (căutarea le găsește pe toate din Font Awesome Free). */
export const BADGE_ICON_SUGGESTIONS = [
  ...[
    "trophy", "medal", "award", "crown", "star", "gem", "fire", "bolt", "shield-halved", "heart", "thumbs-up", "handshake-angle",
    "comments", "pen-nib", "feather-pointed", "cake-candles", "chess-rook", "chess-knight", "chess-queen", "gamepad", "dice-d20",
    "headset", "crosshairs", "skull", "dragon", "hat-wizard", "wand-magic-sparkles", "masks-theater", "rocket", "flag-checkered",
    "bullseye", "hand-fist", "ghost", "robot", "music", "camera", "palette", "code", "bug", "lightbulb", "graduation-cap", "book",
    "calendar-check", "hourglass-half", "seedling", "tree", "mountain", "anchor", "gift", "coins", "hammer", "user-shield", "gavel",
    "life-ring", "circle-check", "infinity",
  ].map((n) => `fa-solid fa-${n}`),
  "fa-brands fa-steam",
  "fa-brands fa-discord",
  "fa-brands fa-twitch",
];

/** Versiunea desenului: o schimbare a desenului trece la o adresă nouă (răspunsurile au cache `immutable`). */
export const BADGE_ART_VERSION = "v1";
export const BADGE_ART_PATH = `/badge-art/${BADGE_ART_VERSION}/`;

/** Textul insignei: 1–3 caractere vizibile, cel mult 24 de octeți UTF-8. */
export const BADGE_TEXT_MAX = 3;
const TEXT_MAX_BYTES = 24;
/** Culoarea insignelor fără o culoare validă (`--gcs-muted`). */
const FALLBACK_COLOR = "#A1A7B4";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const ICON_RE = /^fa-(solid|regular|brands) fa-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
/** Caractere de control și de direcție (pot inversa textul din jur): nu au ce căuta pe o insignă. */
const isUnsafeChar = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029 || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);

export const isBadgeShape = (v: unknown): v is GcsBadgeShape => typeof v === "string" && (GCS_BADGE_SHAPES as readonly string[]).includes(v);
export const isBadgeTier = (v: unknown): v is GcsBadgeTier => typeof v === "string" && (GCS_BADGE_TIERS as readonly string[]).includes(v);
export const isBadgeColor = (v: unknown): v is string => typeof v === "string" && HEX_RE.test(v);

/** `fa-solid fa-trophy` → glifa; orice altceva → `null`. Existența iconiței o verifică serverul (registrul). */
export function parseBadgeIcon(name: unknown): Extract<GcsBadgeGlyph, { kind: "icon" }> | null {
  if (typeof name !== "string" || name.length > 72) return null;
  const m = ICON_RE.exec(name);
  return m ? { kind: "icon", style: m[1] as GcsBadgeIconStyle, name: m[2]! } : null;
}

export const badgeIconName = (glyph: Extract<GcsBadgeGlyph, { kind: "icon" }>) => `fa-${glyph.style} fa-${glyph.name}`;

function graphemes(text: string): string[] {
  return [...new Intl.Segmenter().segment(text)].map((s) => s.segment);
}

/** Un text valid pentru insignă (1–3 caractere vizibile, fără caractere de control). */
export function isBadgeText(text: unknown): text is string {
  if (typeof text !== "string" || text.trim() !== text || text === "") return false;
  if ([...text].some((c) => isUnsafeChar(c.codePointAt(0)!)) || new TextEncoder().encode(text).length > TEXT_MAX_BYTES) return false;
  return graphemes(text).length <= BADGE_TEXT_MAX;
}

/**
 * Insigna unui badge (specul, §8): forma și nivelul alese în ACP sau implicite (rozetă pentru badge-urile manuale,
 * medalie pentru cele automate; nivelul „culoarea badge-ului”), glifa din iconiță, apoi din simbol, apoi prima literă.
 */
export function resolveBadgeArt(badge: GcsBadgeArtFields): GcsBadgeArtSpec {
  const shape = isBadgeShape(badge.artShape) ? badge.artShape : badge.manual ? "rosette" : "medal";
  const tier = isBadgeTier(badge.artTier) ? badge.artTier : "custom";
  const color = isBadgeColor(badge.color) ? badge.color.toUpperCase() : FALLBACK_COLOR;
  const symbol = badge.symbol?.trim() ?? "";
  const icon = parseBadgeIcon(badge.artIcon) ?? parseBadgeIcon(symbol);
  let glyph: GcsBadgeGlyph;
  if (icon) glyph = icon;
  else if (isBadgeText(symbol)) glyph = { kind: "text", text: symbol };
  else {
    const initial = graphemes(badge.name.trim())[0]?.toUpperCase() ?? "";
    glyph = { kind: "text", text: isBadgeText(initial) ? initial : "?" };
  }
  return { shape, tier, color, glyph };
}

const toHex = (text: string) => [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): string | null {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Numele fișierului insignei: `{formă}-{nivel}-{rrggbb}-{glifă}.svg`, glifa `i-{stil}-{nume}` sau `t-{text în hex}`. */
export function badgeArtFile(spec: GcsBadgeArtSpec): string {
  const glyph = spec.glyph.kind === "icon" ? `i-${spec.glyph.style}-${spec.glyph.name}` : `t-${toHex(spec.glyph.text)}`;
  return `${spec.shape}-${spec.tier}-${spec.color.slice(1).toLowerCase()}-${glyph}.svg`;
}

export const badgeArtUrl = (spec: GcsBadgeArtSpec) => `${BADGE_ART_PATH}${badgeArtFile(spec)}`;

/** Adresa insignei unui badge (rezolvare + adresă). */
export const badgeArtSrc = (badge: GcsBadgeArtFields) => badgeArtUrl(resolveBadgeArt(badge));

const FILE_RE = new RegExp(
  `^(${GCS_BADGE_SHAPES.join("|")})-(${GCS_BADGE_TIERS.join("|")})-([0-9a-f]{6})-(?:i-(${GCS_BADGE_ICON_STYLES.join("|")})-([a-z0-9]+(?:-[a-z0-9]+)*)|t-((?:[0-9a-f]{2}){1,${TEXT_MAX_BYTES}}))\\.svg$`,
);

/** Citește numele unui fișier de insignă; acceptă doar forma canonică (altfel `null`, adică 404). */
export function parseBadgeArtFile(file: string): GcsBadgeArtSpec | null {
  if (file.length > 160) return null;
  const m = FILE_RE.exec(file);
  if (!m) return null;
  let glyph: GcsBadgeGlyph;
  if (m[4] !== undefined) {
    if (m[5]!.length > 60) return null;
    glyph = { kind: "icon", style: m[4] as GcsBadgeIconStyle, name: m[5]! };
  } else {
    const text = fromHex(m[6]!);
    if (text === null || !isBadgeText(text)) return null;
    glyph = { kind: "text", text };
  }
  const spec: GcsBadgeArtSpec = { shape: m[1] as GcsBadgeShape, tier: m[2] as GcsBadgeTier, color: `#${m[3]!.toUpperCase()}`, glyph };
  return badgeArtFile(spec) === file ? spec : null;
}
