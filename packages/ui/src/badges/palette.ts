import { isBadgeColor, type GcsBadgeTier } from "./art";

/**
 * Culorile unei insigne (specul, §4): metalul ramei și al glifei vine din nivel, emailul și panglica din culoarea
 * badge-ului. Toate valorile sunt `#RRGGBB` calculate aici (niciun text din badge nu ajunge nemodificat în SVG).
 */
export type GcsBadgePalette = {
  /** Metalul: reflexie, lumină, bază, umbră, contur. */
  hi: string;
  light: string;
  base: string;
  shade: string;
  edge: string;
  /** A doua reflexie a ramei (platina: dunga irizată). */
  band: string;
  glyphTop: string;
  glyphBottom: string;
  glyphShadow: string;
  /** Strălucirea din jurul insignei (doar aur, platină). */
  glow: string | null;
  /** Emailul din câmp (sus → jos). */
  fieldTop: string;
  fieldBottom: string;
  /** Panglica medaliei și cozile rozetei. */
  ribbonLight: string;
  ribbonBase: string;
  ribbonDark: string;
  /** Scânteile (doar platină). */
  sparkle: boolean;
};

type Metal = Pick<GcsBadgePalette, "hi" | "light" | "base" | "shade" | "edge" | "band" | "glyphTop" | "glyphBottom" | "glyphShadow" | "glow" | "sparkle">;

export const BADGE_METALS: Record<Exclude<GcsBadgeTier, "custom">, Metal> = {
  bronze: { hi: "#FFD9B3", light: "#E8A06A", base: "#B86B35", shade: "#7C4119", edge: "#3E1D08", band: "#E8A06A", glyphTop: "#FFE7CF", glyphBottom: "#F0B07C", glyphShadow: "#2A1205", glow: null, sparkle: false },
  silver: { hi: "#FFFFFF", light: "#E3E8EF", base: "#A7B1BF", shade: "#66717F", edge: "#2B323C", band: "#E3E8EF", glyphTop: "#FFFFFF", glyphBottom: "#D4DBE5", glyphShadow: "#1B2028", glow: null, sparkle: false },
  gold: { hi: "#FFF6CC", light: "#FFD66B", base: "#E0A526", shade: "#9A6508", edge: "#4A2E02", band: "#FFD66B", glyphTop: "#FFF8DB", glyphBottom: "#FFD25E", glyphShadow: "#2F1C00", glow: "#FFC93D", sparkle: false },
  platinum: { hi: "#FFFFFF", light: "#E6F6FF", base: "#A9CFE6", shade: "#5E86A3", edge: "#1E3447", band: "#D9CCFF", glyphTop: "#FFFFFF", glyphBottom: "#CFF0FF", glyphShadow: "#0F1F2C", glow: "#8FE3FF", sparkle: true },
};

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** Amestecă `a` cu `b` (t = 0 → a, t = 1 → b). */
export function mixColor(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255];
}

/** Plafonează luminozitatea (HSL): emailul rămâne destul de închis ca glifa deschisă să se citească. */
export function capLightness(color: string, max: number): string {
  const [h, s, l] = toHsl(rgb(color));
  return l <= max ? color.toUpperCase() : hex(fromHsl([h, s, max]));
}

const WHITE = "#FFFFFF";
const BLACK = "#000000";

/** Paleta completă a unei insigne. `color` trebuie să fie `#RRGGBB` (altfel gri). */
export function badgePalette(tier: GcsBadgeTier, color: string): GcsBadgePalette {
  const c = isBadgeColor(color) ? color.toUpperCase() : "#A1A7B4";
  const ribbon = { ribbonLight: mixColor(c, WHITE, 0.25), ribbonBase: c, ribbonDark: mixColor(c, BLACK, 0.4) };
  if (tier === "custom") {
    return {
      hi: mixColor(c, WHITE, 0.75),
      light: mixColor(c, WHITE, 0.4),
      base: c,
      shade: mixColor(c, BLACK, 0.4),
      edge: mixColor(c, BLACK, 0.75),
      band: mixColor(c, WHITE, 0.4),
      glyphTop: WHITE,
      glyphBottom: mixColor(c, WHITE, 0.75),
      glyphShadow: mixColor(c, BLACK, 0.85),
      glow: null,
      sparkle: false,
      fieldTop: capLightness(mixColor(c, BLACK, 0.35), 0.36),
      fieldBottom: capLightness(mixColor(c, BLACK, 0.7), 0.16),
      ...ribbon,
    };
  }
  return {
    ...BADGE_METALS[tier],
    fieldTop: capLightness(mixColor(c, BLACK, 0.1), 0.42),
    fieldBottom: capLightness(mixColor(c, BLACK, 0.55), 0.22),
    ...ribbon,
  };
}
