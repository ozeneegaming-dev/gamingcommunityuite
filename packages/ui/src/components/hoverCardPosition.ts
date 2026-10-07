/** Distanța dintre nume și card. */
export const HOVER_CARD_GAP = 8;
/** Distanța minimă de la marginile ecranului. */
export const HOVER_CARD_MARGIN = 12;

export type GcsHoverCardPlacement = { top: number; left: number; side: "below" | "above" };

const clamp = (value: number, min: number, max: number) => (max < min ? min : Math.min(max, Math.max(min, value)));

/**
 * Unde stă hover card-ul (coordonate de viewport: stratul e `position: fixed`), după mărimea lui **măsurată**:
 * dedesubt, la 8 px sub nume, dacă încape; altfel deasupra, la 8 px de nume; altfel pe partea cu mai mult loc,
 * limitat în ecran. Orizontal: aliniat la stânga numelui, la cel puțin 12 px de margini.
 */
export function placeHoverCard(
  anchor: { top: number; bottom: number; left: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): GcsHoverCardPlacement {
  const below = anchor.bottom + HOVER_CARD_GAP;
  const above = anchor.top - HOVER_CARD_GAP - card.height;
  const roomBelow = viewport.height - HOVER_CARD_MARGIN - below;
  const roomAbove = anchor.top - HOVER_CARD_GAP - HOVER_CARD_MARGIN;
  const side = card.height <= roomBelow ? "below" : card.height <= roomAbove ? "above" : roomBelow >= roomAbove ? "below" : "above";
  const top = clamp(side === "below" ? below : above, HOVER_CARD_MARGIN, viewport.height - HOVER_CARD_MARGIN - card.height);
  const left = clamp(anchor.left, HOVER_CARD_MARGIN, viewport.width - HOVER_CARD_MARGIN - card.width);
  return { top: Math.round(top), left: Math.round(left), side };
}
