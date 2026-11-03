/**
 * Submeniurile din antet (mega meniurile), fără React, folosite de bara de pe desktop și de sertarul de pe telefon:
 * împărțirea subitemilor între grila cu descrieri și coloana linkurilor scurte (ACP › Meniu, „Link scurt”), numărul de
 * coloane după câți itemi sunt și așezarea panoului în ecran, cu săgeata de sus deasupra butonului care l-a deschis.
 */

/** Linkul separatorului dintre subitemi (`NAV_SEPARATOR_HREF` din `@gcs/core`, aici fără codul serverului). */
export const MEGA_SEPARATOR_HREF = "#gcs-separator";

export type GcsMegaChild = { href: string; shortLink?: boolean | undefined };

export const isMegaSeparator = (c: { href: string }): boolean => c.href === MEGA_SEPARATOR_HREF;

/** Fără separatori la capete și fără doi la rând (după ce linkurile scurte au plecat din listă). */
function trimSeparators<T extends GcsMegaChild>(list: readonly T[]): T[] {
  const out: T[] = [];
  for (const c of list) {
    if (isMegaSeparator(c) && (out.length === 0 || isMegaSeparator(out[out.length - 1]!))) continue;
    out.push(c);
  }
  while (out.length > 0 && isMegaSeparator(out[out.length - 1]!)) out.pop();
  return out;
}

/**
 * Subitemii unui mega meniu: `items` (grila, cu iconiță, titlu și descriere; separatorii rămân între ei) și `short`
 * (coloana din dreapta: linkurile marcate „Link scurt”, ca plăcuțe). Dacă toți sunt scurți, stau toți în grilă: o
 * coloană singură ar lăsa panoul gol.
 */
export function megaColumns<T extends GcsMegaChild>(children: readonly T[]): { items: T[]; short: T[] } {
  const short = children.filter((c) => c.shortLink === true && !isMegaSeparator(c));
  const items = trimSeparators(children.filter((c) => !short.includes(c)));
  if (items.length === 0) return { items: trimSeparators(children), short: [] };
  return { items, short };
}

/** Coloanele grilei după numărul de itemi (fără separatori): 1 pentru un singur item, 2, apoi 3 de la 9 itemi. */
export function megaGridColumns(count: number): 1 | 2 | 3 {
  if (count <= 1) return 1;
  return count >= 9 ? 3 : 2;
}

/** Distanța minimă dintre panou și marginile ferestrei. */
export const MEGA_MARGIN = 12;
/** Cât de aproape de colțurile panoului poate ajunge săgeata (colțurile sunt rotunjite). */
export const MEGA_ARROW_INSET = 18;

export type GcsMegaPlacementInput = {
  /** Butonul care a deschis panoul, în coordonatele ferestrei. */
  triggerLeft: number;
  triggerWidth: number;
  /** Elementul față de care panoul e poziționat (`position: relative`), în coordonatele ferestrei. */
  originLeft: number;
  panelWidth: number;
  /** Lățimea utilă a ferestrei (fără bara de derulare). */
  viewportWidth: number;
  margin?: number;
};

/**
 * Așezarea panoului pe orizontală: pornește de la marginea stângă a butonului, dar rămâne în ecran (cu `margin` față de
 * margini; un panou mai lat decât ecranul pornește de la margine). Săgeata arată mijlocul butonului, fără să iasă din
 * colțurile rotunjite. `left` e față de `originLeft`, `arrow` față de marginea stângă a panoului.
 */
export function megaPlacement(o: GcsMegaPlacementInput): { left: number; arrow: number } {
  const margin = o.margin ?? MEGA_MARGIN;
  const maxLeft = o.viewportWidth - margin - o.panelWidth;
  const page = Math.max(margin, Math.min(o.triggerLeft, maxLeft));
  const center = o.triggerLeft + o.triggerWidth / 2;
  const arrow = Math.min(Math.max(center - page, MEGA_ARROW_INSET), Math.max(MEGA_ARROW_INSET, o.panelWidth - MEGA_ARROW_INSET));
  return { left: Math.round(page - o.originLeft), arrow: Math.round(arrow) };
}

/** Itemul următor (sau anterior) dintr-o listă, circular; din afara listei, primul (sau ultimul). */
export function megaStep(count: number, at: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (at < 0) return delta === 1 ? 0 : count - 1;
  return (at + delta + count) % count;
}
