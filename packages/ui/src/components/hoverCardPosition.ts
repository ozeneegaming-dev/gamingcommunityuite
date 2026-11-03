/** Distanța dintre nume și card. */
export const HOVER_CARD_GAP = 8;
/** Distanța minimă de la marginile ecranului. */
export const HOVER_CARD_MARGIN = 12;

/** `maxHeight`: doar când cardul nu încape nici dedesubt, nici deasupra (atunci derulează în el, fără să acopere numele). */
export type GcsHoverCardPlacement = { top: number; left: number; side: "below" | "above"; maxHeight: number | null };

const clamp = (value: number, min: number, max: number) => (max < min ? min : Math.min(max, Math.max(min, value)));

/**
 * Unde stă hover card-ul (coordonate de viewport: stratul e `position: fixed`), după mărimea lui **măsurată**:
 * dedesubt, la 8 px sub nume, dacă încape; altfel deasupra, la 8 px de nume; altfel pe partea cu mai mult loc, cu
 * înălțimea limitată la locul de acolo (cardul derulează). Orizontal: aliniat la stânga numelui, la cel puțin 12 px de
 * margini; un card mai lat decât ecranul fără margini (telefonul: 100vw − 16 px) stă centrat.
 */
export function placeHoverCard(
  anchor: { top: number; bottom: number; left: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): GcsHoverCardPlacement {
  const below = anchor.bottom + HOVER_CARD_GAP;
  const roomBelow = viewport.height - HOVER_CARD_MARGIN - below;
  const roomAbove = anchor.top - HOVER_CARD_GAP - HOVER_CARD_MARGIN;
  const fits = card.height <= roomBelow || card.height <= roomAbove;
  const side = card.height <= roomBelow ? "below" : card.height <= roomAbove ? "above" : roomBelow >= roomAbove ? "below" : "above";
  const maxHeight = fits ? null : Math.max(0, Math.floor(side === "below" ? roomBelow : roomAbove));
  const height = maxHeight ?? card.height;
  const top = clamp(side === "below" ? below : anchor.top - HOVER_CARD_GAP - height, HOVER_CARD_MARGIN, viewport.height - HOVER_CARD_MARGIN - height);
  const roomX = viewport.width - HOVER_CARD_MARGIN - card.width;
  const left = roomX < HOVER_CARD_MARGIN ? Math.max(0, (viewport.width - card.width) / 2) : clamp(anchor.left, HOVER_CARD_MARGIN, roomX);
  return { top: Math.round(top), left: Math.round(left), side, maxHeight };
}

/** Cât de aproape de colțurile cardului poate sta săgeata (colțul rotunjit + jumătatea săgeții). */
export const HOVER_CARD_ARROW_INSET = 20;

/**
 * Unde stă săgeata cardului (px de la marginea lui stângă): la mijlocul numelui (al rândului dinspre card, la un nume
 * rupt pe două rânduri), dar nu mai aproape de colțuri de `HOVER_CARD_ARROW_INSET`.
 */
export function hoverCardArrowX(anchor: { left: number; right: number }, cardLeft: number, cardWidth: number): number {
  const center = (anchor.left + anchor.right) / 2 - cardLeft;
  return Math.round(clamp(center, HOVER_CARD_ARROW_INSET, cardWidth - HOVER_CARD_ARROW_INSET));
}
