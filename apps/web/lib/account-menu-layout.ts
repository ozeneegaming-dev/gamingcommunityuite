/**
 * Așezarea meniului contului din antet (în orice temă): înălțimea maximă a panoului (ecranul minus antetul, cu
 * derulare internă) și partea în care se deschide submeniul „Staff” (spre interiorul ecranului). Fără DOM: se testează
 * cu valori.
 */
export type GcsBox = { top: number; left: number; right: number; bottom: number };
export type GcsFlyoutSide = "left" | "right" | "inline";

/** Spațiul dintre panou și submeniu (px). */
export const FLYOUT_GAP = 8;
/** Marginea minimă față de ecran (px). */
export const SCREEN_MARGIN = 8;
/** Înălțimea minimă a panoului, ca pe un ecran foarte scund să rămână folosibil (derulează înăuntru). */
export const PANEL_MIN_HEIGHT = 240;
/** Cât urcă submeniul față de rândul „Staff”, ca primul lui item să stea în dreptul rândului (padding-ul lui). */
const FLYOUT_LIFT = 6;

/** Înălțimea maximă a panoului: de la marginea lui de sus până jos în ecran, minus o margine. */
export function panelMaxHeight(panelTop: number, viewportHeight: number, margin = 12): number {
  return Math.max(PANEL_MIN_HEIGHT, Math.floor(viewportHeight - panelTop - margin));
}

/**
 * Submeniul „Staff”: în partea cu mai mult loc (spre interiorul ecranului), aliniat cu rândul „Staff” și ținut în
 * ecran (urcă cât să încapă jos). Fără loc în nicio parte (ecran îngust), se deschide sub rând, în panou (`inline`).
 * `panel` e cutia de umplere a panoului (fără chenar), iar `top` se socotește față de marginea ei de sus.
 */
export function flyoutPlacement(
  panel: GcsBox,
  row: GcsBox,
  fly: { width: number; height: number },
  viewport: { width: number; height: number },
): { side: GcsFlyoutSide; top: number } {
  const need = fly.width + FLYOUT_GAP + SCREEN_MARGIN;
  const room = { left: panel.left, right: viewport.width - panel.right };
  const wide = room.left >= room.right ? "left" : "right";
  if (room[wide] < need) return { side: "inline", top: 0 };
  const side = wide;
  const wanted = row.top - panel.top - FLYOUT_LIFT;
  const lowest = viewport.height - SCREEN_MARGIN - fly.height - panel.top;
  const highest = SCREEN_MARGIN - panel.top;
  return { side, top: Math.round(Math.max(highest, Math.min(wanted, lowest))) };
}
