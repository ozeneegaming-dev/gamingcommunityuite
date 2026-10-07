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
 * margini.
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
  const left = clamp(anchor.left, HOVER_CARD_MARGIN, viewport.width - HOVER_CARD_MARGIN - card.width);
  return { top: Math.round(top), left: Math.round(left), side, maxHeight };
}
