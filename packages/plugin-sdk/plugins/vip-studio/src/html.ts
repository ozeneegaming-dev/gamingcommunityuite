/**
 * Ajutoarele HTML ale pluginului: escaparea, atributele și „aspectul” elementelor din catalog ca clase + variabile CSS.
 * HTML-ul trece oricum prin sanitizer-ul GCS (fără `id`, `on*`; `style` doar cu variabile CSS sigure), dar îl generăm
 * deja curat: textele escapate, culorile validate, clasele din liste fixe.
 */
import type { BannerData, NameStyleData, Variant } from "./model";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (text: unknown) => String(text ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);

/** Atributele unui element (`null` / `false` lipsesc, `true` = atribut fără valoare). */
export function attrs(map: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join("");
}

/** `style` cu variabile CSS (doar valori sigure: culori hex, numere, unități). */
export function vars(map: Record<string, string | number | null | undefined>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `--${k}:${v}`)
    .join(";");
}

/** O iconiță Font Awesome (GCS o transformă în SVG). */
export const icon = (name: string) => `<gcs-icon name="${esc(name)}"></gcs-icon>`;

const GRADIENT_EFFECTS = new Set(["shimmer", "chrome", "scan", "holo", "fire"]);
const SPEED: Record<string, number> = { slow: 1.6, normal: 1, fast: 0.55 };

export type Look = { cls: string; style: string };

/** Variabilele culorilor unei liste (`--c1` … `--c5`). */
function colorVars(colors: string[]): Record<string, string> {
  return Object.fromEntries(colors.slice(0, 5).map((c, i) => [`c${i + 1}`, c]));
}

/**
 * Aspectul unui stil de nume (o variantă): aceleași reguli ca CSS-ul generat de GCS pentru nume (gradient pentru mai
 * multe culori și pentru efectele cu gradient, strălucire, viteză), ca previzualizarea să arate exact ca pe site.
 */
export function nameLook(style: NameStyleData, variant: Variant): Look {
  const n = Math.min(variant.colors.length, 5);
  const grad = n > 1 || GRADIENT_EFFECTS.has(style.effect);
  const cls = ["gcsp-ns", `gcsp-ns--n${n}`, grad ? "gcsp-ns--grad" : "", style.effect !== "none" ? `gcsp-fx-${style.effect}` : "", style.italic ? "gcsp-ns--italic" : "", style.bold ? "" : "gcsp-ns--light"].filter(Boolean).join(" ");
  return { cls, style: vars({ ...colorVars(variant.colors), ga: `${style.angle}deg`, glow: variant.glow ?? null, sp: SPEED[style.speed] ?? 1 }) };
}

/** Aspectul unui banner (pastila de sub nume), cu animația lui. */
export function bannerLook(b: BannerData): Look {
  const n = Math.min(b.fill.colors.length, 5);
  const cls = ["gcsp-pill", `gcsp-pill--n${n}`, b.fill.animation !== "none" ? `gcsp-pill--${b.fill.animation}` : ""].filter(Boolean).join(" ");
  return { cls, style: vars({ ...colorVars(b.fill.colors), ga: `${b.fill.angle}deg`, ink: b.text, sp: SPEED[b.fill.speed] ?? 1 }) };
}

/** Banner-ul implicit (al grupului / al accentului), când membrul nu a ales unul. */
export const DEFAULT_BANNER: BannerData = { fill: { colors: ["#D62839"], angle: 90, animation: "none", speed: "normal" }, text: "#FFFFFF" };
