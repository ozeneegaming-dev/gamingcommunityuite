/**
 * Poziția bulei unui tooltip (pură, testată): centrată pe element, deasupra lui (sau dedesubt când nu încape sus),
 * ținută în ecran cu o margine de 8 px; săgeata rămâne în dreptul centrului elementului.
 */
export type GcsTipRect = { left: number; top: number; width: number; height: number };
export type GcsTipPlacement = { left: number; top: number; side: "top" | "bottom"; arrow: number };

const GAP = 10;
const EDGE = 8;

export function placeTooltip(anchor: GcsTipRect, tip: { width: number; height: number }, viewport: { width: number; height: number }, prefer: "top" | "bottom" = "top"): GcsTipPlacement {
  const fitsTop = anchor.top - GAP - tip.height >= EDGE;
  const fitsBottom = anchor.top + anchor.height + GAP + tip.height <= viewport.height - EDGE;
  const side = prefer === "top" ? (fitsTop || !fitsBottom ? "top" : "bottom") : fitsBottom || !fitsTop ? "bottom" : "top";
  const center = anchor.left + anchor.width / 2;
  const maxLeft = Math.max(EDGE, viewport.width - tip.width - EDGE);
  const left = Math.min(maxLeft, Math.max(EDGE, center - tip.width / 2));
  const top = side === "top" ? anchor.top - GAP - tip.height : anchor.top + anchor.height + GAP;
  const arrow = Math.min(tip.width - 10, Math.max(10, center - left));
  return { left: Math.round(left), top: Math.round(top), side, arrow: Math.round(arrow) };
}

/**
 * Unde intră bula: în dialogul modal deschis care conține elementul (stratul de sus al browserului acoperă restul
 * paginii), altfel în `<body>`. Așa tooltip-ul supraviețuiește meniurilor, panourilor cu `overflow` și modalelor.
 */
export function tooltipContainer(el: Element): HTMLElement {
  return (el.closest("dialog[open]") as HTMLElement | null) ?? document.body;
}

/**
 * Așază bula (deja în pagină, `position: fixed`) lângă element. Un strămoș cu `transform` (ex. un dialog care intră cu
 * scalare) mută originea coordonatelor fixe: poziția se corectează după măsurare.
 *
 * Măsurătoarea citește poziția REALĂ a bulei, deci bula se așază fără tranziții (cu „animații reduse” în sistem, regula
 * globală dă oricărei proprietăți o tranziție de 0.01ms: s-ar citi poziția veche și corecția ar dubla coordonatele) și,
 * la prima așezare, fără animația de intrare (transformarea ei de început mută bula cu câțiva px); animația pornește
 * apoi din poziția finală.
 */
export function positionTooltip(el: Element, bubble: HTMLElement, prefer: "top" | "bottom" = "top"): void {
  const first = !bubble.dataset.side;
  bubble.style.transition = "none";
  if (first) bubble.style.animation = "none";
  const r = el.getBoundingClientRect();
  const size = bubble.getBoundingClientRect();
  const p = placeTooltip({ left: r.left, top: r.top, width: r.width, height: r.height }, { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight }, prefer);
  bubble.style.left = `${p.left}px`;
  bubble.style.top = `${p.top}px`;
  const placed = bubble.getBoundingClientRect();
  const dx = p.left - placed.left;
  const dy = p.top - placed.top;
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    bubble.style.left = `${p.left + dx}px`;
    bubble.style.top = `${p.top + dy}px`;
  }
  bubble.style.setProperty("--gcs-tip-arrow", `${p.arrow}px`);
  bubble.dataset.side = p.side;
  bubble.classList.toggle("gcs-tooltip--top", p.side === "top");
  bubble.classList.toggle("gcs-tooltip--bottom", p.side === "bottom");
  if (first) bubble.style.removeProperty("animation");
}
