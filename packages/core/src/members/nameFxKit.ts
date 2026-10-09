/**
 * Ajutoarele efectelor numelui (`nameEffects.ts`, `nameEffectsText.ts`): durata cu viteza aleasă, cernelurile
 * culorilor (închise automat pe tema deschisă), strălucirea, straturile cu textul dublat și decorurile.
 */

export type Fx = {
  /** Peste tot (și în liste). */
  base: string[];
  /** Doar în locurile mari: elementul și cele două pseudo-elemente. */
  rich?: { self?: string[]; before?: string[]; after?: string[] };
  /**
   * Efectele pe litere: fiecare literă (`.gcs-name__ls > b`, `--i` = indexul ei), peste tot; `letterRich` doar în locurile
   * mari; `letterNth` = literele alese cu `:nth-child()` (ex. `odd`), cu culoarea lor.
   */
  letter?: string[];
  letterRich?: string[];
  letterNth?: Record<string, string[]>;
};

// ─── Ajutoare ───

/** Durata unei animații, cu viteza aleasă (`--nfx-sp`: 1 normal, 1.6 lent, 0.55 rapid). */
export const d = (seconds: number) => `calc(${seconds}s*var(--nfx-sp,1))`;
/** Cerneala culorii n (închisă automat pe tema deschisă). */
export const i = (n: number) => `var(--nfx-i${n})`;
/** Strălucirea, cu opacitatea dată (mai slabă pe tema deschisă). */
export const g = (pct: number, color = "var(--nfx-g)") => `color-mix(in srgb,${color} calc(var(--nfx-ga,1)*${pct}%),transparent)`;
/** Deschide o culoare (miezul fierbinte al unui neon), doar pe tema închisă: pe cea deschisă rămâne cerneala. */
export const white = (color: string, pct: number) => `color-mix(in oklab,${color},#fff calc(var(--nfx-dk,1)*${pct}%))`;
export const black = (color: string, pct: number) => `color-mix(in oklab,${color},#000 ${pct}%)`;
/** Sclipirea albă care trece peste litere: mai discretă pe tema deschisă (altfel literele ar dispărea pe alb). */
export const sheen = (alpha: number) => `rgb(255 255 255/calc(${alpha} * (.35 + .65 * var(--nfx-dk,1))))`;

/** Textul în gradientul culorilor (umplerea transparentă, fundalul tăiat pe litere). */
export const GRAD_TEXT = ["background-image:var(--nfx-grad)", "background-size:200% 100%", "-webkit-background-clip:text", "background-clip:text", "color:transparent", "-webkit-text-fill-color:transparent"];
/** Un strat cu textul numelui (din `data-text`), ascuns cititoarelor de ecran (`/ ""`). */
export const TEXT_LAYER = [
  "content:attr(data-text)",
  'content:attr(data-text) / ""',
  "position:absolute",
  "left:0",
  "top:0",
  "width:100%",
  "height:100%",
  "pointer-events:none",
  "white-space:nowrap",
  "background:none",
  "-webkit-text-fill-color:currentColor",
  "text-shadow:none",
  "filter:none",
];
/** Un pseudo-element decorativ (particule, iconițe): invizibil în repaus, deci ascuns și sub reduced-motion. */
export const DECOR = ['content:""', 'content:"" / ""', "position:absolute", "pointer-events:none", "opacity:0"];
/** O strălucire pe text în gradient (text-shadow s-ar vedea prin literele transparente). */
export const dropGlow = (px: number, pct: number) => `filter:drop-shadow(0 0 ${px}px ${g(pct)})`;

/** Puncte (particule) desenate ca gradiente radiale, într-un singur strat. */
export const dots = (color: string, list: [number, number, number][]) => list.map(([x, y, r]) => `radial-gradient(circle at ${x}% ${y}%,${color} 0 ${r}px,transparent ${r + 0.8}px)`).join(",");

/**
 * Strălucirea care urmează culoarea curentă când numele are mai multe culori (`--nfx-cyg: currentColor`, pus doar
 * atunci): efectele cu o culoare plină (neon, electric, puls, fulger) trec prin culorile variantei (curcubeul), iar
 * strălucirea le urmează. Cu o singură culoare, e strălucirea obișnuită.
 */
export const gc = (pct: number) => `color-mix(in srgb,var(--nfx-cyg,var(--nfx-g)) calc(var(--nfx-ga,1)*${pct}%),transparent)`;
/** Ciclul culorilor (`--nfx-cyc`, pus doar pentru 2–5 culori): un strat de animație în plus, `none` altfel. */
export const cycle = (seconds: number) => `var(--nfx-cyc,none) ${d(seconds)} linear infinite`;
