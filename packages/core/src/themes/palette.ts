/**
 * Culorile temei, calculate (modul e pur: îl folosesc compilatorul CSS și editorul vizual din browser):
 * - contrastul WCAG dintre două culori;
 * - nuanța lizibilă a unui fundal plin (butonul principal cu text alb ≥ 4.5:1, și în starea de hover);
 * - generatorul de paletă al editorului: din fundal + accent, suprafețele, chenarul, textul și textul estompat.
 */

type Rgb = [number, number, number];

const HEX = /^#([0-9a-f]{6})$/i;

export const isHex6 = (v: string): boolean => HEX.test(v);

function toRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Amestecul a două culori în sRGB: `t` = cât din a doua (0 = prima, 1 = a doua), ca `color-mix(in srgb, …)`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as Rgb);
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Raportul de contrast WCAG 2 (1–21). */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Stratul alb al hover-ului butoanelor pline (regula de hover: se luminează, nu se închid). */
export const HOVER_WHITE = 0.08;

/**
 * Fundalul plin lizibil pentru un text: aceeași culoare dacă textul are deja ≥ `min` (și în starea de hover, cu stratul
 * alb de 8%), altfel nuanța cea mai apropiată, închisă (text deschis) sau deschisă (text închis), în pași de 2%.
 * Culoarea mărcii (accentul) rămâne neschimbată în paletă; doar fundalul butonului primește nuanța.
 */
export function readableFill(bg: string, text: string, min = 4.5): string {
  const ok = (c: string) => contrastRatio(c, text) >= min && contrastRatio(mixHex(c, "#FFFFFF", HOVER_WHITE), text) >= min;
  if (ok(bg)) return bg.toUpperCase();
  const toward = luminance(text) > 0.5 ? "#000000" : "#FFFFFF";
  for (let step = 0.02; step <= 0.6; step += 0.02) {
    const c = mixHex(bg, toward, step);
    if (ok(c)) return c;
  }
  return mixHex(bg, toward, 0.6);
}

/** Culoarea pornind de la `base`, împinsă spre `toward` până atinge contrastul `min` față de `against`. */
function pushUntil(base: string, toward: string, against: string, min: number): string {
  if (contrastRatio(base, against) >= min) return base.toUpperCase();
  for (let step = 0.04; step <= 1; step += 0.04) {
    const c = mixHex(base, toward, step);
    if (contrastRatio(c, against) >= min) return c;
  }
  return toward.toUpperCase();
}

export type GcsDerivedPalette = {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentInk: string;
  chrome: string;
  chrome2: string;
};

/**
 * Generatorul de paletă al editorului vizual: din culoarea fundalului și accent, restul tokenurilor (suprafețele puțin
 * mai deschise / mai albe, chenarul, textul, textul estompat ≥ 4.5:1, textul de accent ≥ 4.5:1 pe suprafață).
 * `ok` / `warn` rămân cele ale temei (culori de stare, nu decor).
 */
export function derivePalette(bg: string, accent: string, mode: "dark" | "light"): GcsDerivedPalette {
  const b = bg.toUpperCase();
  const a = accent.toUpperCase();
  if (mode === "dark") {
    const surface = mixHex(b, "#FFFFFF", 0.045);
    const text = mixHex("#FFFFFF", b, 0.16);
    return {
      bg: b,
      surface,
      surface2: mixHex(b, "#FFFFFF", 0.07),
      border: mixHex(mixHex(b, "#FFFFFF", 0.12), a, 0.04),
      text,
      muted: pushUntil(mixHex("#FFFFFF", b, 0.52), "#FFFFFF", surface, 4.6),
      accent: a,
      accentInk: pushUntil(mixHex(a, "#FFFFFF", 0.2), "#FFFFFF", surface, 4.6),
      chrome: mixHex(b, "#FFFFFF", 0.015),
      chrome2: mixHex(b, "#FFFFFF", 0.025),
    };
  }
  const surface = mixHex(b, "#FFFFFF", 0.85);
  return {
    bg: b,
    surface,
    surface2: mixHex(b, "#FFFFFF", 0.45),
    border: mixHex(b, "#000000", 0.09),
    text: mixHex("#000000", b, 0.1),
    muted: pushUntil(mixHex("#000000", b, 0.55), "#000000", surface, 4.6),
    accent: a,
    accentInk: pushUntil(mixHex(a, "#000000", 0.1), "#000000", surface, 4.6),
    chrome: mixHex(b, "#FFFFFF", 0.9),
    chrome2: mixHex(b, "#FFFFFF", 0.6),
  };
}
