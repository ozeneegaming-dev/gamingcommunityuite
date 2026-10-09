/**
 * Calculele vizualizatorului de imagini (`GcsImageViewer`), fără DOM: mărirea în jurul unui punct, limitele deplasării,
 * glisarea pe ecranele tactile și indexul circular. Coordonatele sunt relative la centrul scenei (pixeli CSS).
 */

/** O imagine din galerie: adresa afișată, miniatura, originalul, descărcarea și legenda (autor, dată, link). */
export type GcsViewerImage = {
  src: string;
  thumb?: string;
  alt?: string;
  /** Adresa originalului („Deschide originalul”); implicit `src`. */
  original?: string;
  /** Adresa de descărcare („Descarcă”); implicit originalul. */
  download?: string;
  caption?: { author?: string | null; date?: string | null; href?: string | null };
};

/** Starea afișării: mărirea și deplasarea centrului imaginii față de centrul scenei. */
export type GcsViewTransform = { scale: number; x: number; y: number };
export type GcsSize = { w: number; h: number };

export const VIEWER_MIN_ZOOM = 1;
export const VIEWER_MAX_ZOOM = 6;
/** Mărirea la dublu-click (sau dublu-tap). */
export const VIEWER_DOUBLE_ZOOM = 2.5;
/** Un pas de mărire (butoanele, tastele + și -). */
export const VIEWER_ZOOM_STEP = 1.5;

export const VIEW_RESET: GcsViewTransform = { scale: 1, x: 0, y: 0 };

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return VIEWER_MIN_ZOOM;
  return Math.min(VIEWER_MAX_ZOOM, Math.max(VIEWER_MIN_ZOOM, scale));
}

/**
 * Mărirea la `scale` în jurul punctului (`px`, `py`) al scenei: punctul de sub cursor (sau dintre degete) rămâne pe loc.
 * Revenirea la 1 recentrează imaginea.
 */
export function zoomAt(t: GcsViewTransform, scale: number, px: number, py: number): GcsViewTransform {
  const next = clampZoom(scale);
  if (next === VIEWER_MIN_ZOOM) return VIEW_RESET;
  const k = next / t.scale;
  return { scale: next, x: px - (px - t.x) * k, y: py - (py - t.y) * k };
}

/**
 * Deplasarea permisă: imaginea mărită nu iese din scenă (marginea ei nu trece de marginea scenei); pe o axă unde
 * imaginea e mai mică decât scena, rămâne centrată. `fit` = mărimea imaginii afișate la scara 1.
 */
export function clampPan(t: GcsViewTransform, fit: GcsSize, stage: GcsSize): GcsViewTransform {
  const maxX = Math.max(0, (fit.w * t.scale - stage.w) / 2);
  const maxY = Math.max(0, (fit.h * t.scale - stage.h) / 2);
  // `|| 0`: fără „-0” (axa blocată rămâne exact în centru).
  return { scale: t.scale, x: Math.min(maxX, Math.max(-maxX, t.x)) || 0, y: Math.min(maxY, Math.max(-maxY, t.y)) || 0 };
}

/** Mărimea imaginii încadrate în scenă (fără mărire peste dimensiunea naturală). */
export function fitSize(natural: GcsSize, stage: GcsSize): GcsSize {
  if (natural.w <= 0 || natural.h <= 0 || stage.w <= 0 || stage.h <= 0) return { w: 0, h: 0 };
  const k = Math.min(1, stage.w / natural.w, stage.h / natural.h);
  return { w: natural.w * k, h: natural.h * k };
}

/**
 * O glisare orizontală: spre stânga = următoarea (`1`), spre dreapta = anterioara (`-1`), altfel `0`. Cere cel puțin
 * 50 px, mai mult orizontal decât vertical și cel mult 800 ms (o tragere lentă nu schimbă imaginea).
 */
export function swipeDirection(dx: number, dy: number, ms: number): -1 | 0 | 1 {
  if (ms > 800 || Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/** Indexul circular (după ultima vine prima). */
export function wrapIndex(i: number, n: number): number {
  if (n <= 0) return 0;
  return ((i % n) + n) % n;
}

/** Distanța dintre două puncte (ciupirea cu două degete). */
export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
