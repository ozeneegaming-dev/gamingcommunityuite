/**
 * Ajutoarele HTML ale pluginului: escaparea, atributele și „aspectul” elementelor din catalog ca clase + variabile CSS.
 * HTML-ul trece oricum prin sanitizer-ul GCS (fără `id`, `on*`; `style` doar cu variabile CSS sigure), dar îl generăm
 * deja curat: textele escapate, culorile validate, clasele din liste fixe.
 */
import { PLUGIN_KEY, type BannerData, type Effect, type NameStyleData, type Variant } from "./model";

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

const SPEED: Record<string, number> = { slow: 1.6, normal: 1, fast: 0.55 };

/** Clasa unui stil CSS scris de admin (aceeași pe care o pune GCS pe numele / banner-ul membrilor). */
export const customStyleClass = (kind: "name_style" | "banner", key: string) => `gcs-${kind === "name_style" ? "name" : "banner"}Style--${PLUGIN_KEY.replace(/[^a-z0-9_]/g, "-")}--${key}`;

export type Look = { cls: string; style: string };

/** Variabilele culorilor unei liste (`--c1` … `--c5`). */
function colorVars(colors: string[]): Record<string, string> {
  return Object.fromEntries(colors.slice(0, 5).map((c, i) => [`c${i + 1}`, c]));
}

/** Efectul afișat: ca în GCS, animațiile vechi ale umplerii au echivalentul lor, mai multe culori fără efect = gradient. */
export function shownEffect(style: NameStyleData, colors: number): Effect {
  if (style.custom) return "none";
  if (style.effect !== "none") return style.effect;
  if (style.animation === "flow") return "shimmer";
  if (style.animation === "aurora") return "holo";
  if (style.animation === "pulse") return "pulse";
  if (style.animation === "shine") return "chrome";
  return colors > 1 ? "gradient" : "none";
}

/**
 * Aspectul unui stil de nume (o variantă): clasele de previzualizare ale GCS (`gcs-nfx gcs-nfx--<efect>`, aceleași
 * reguli ca pe numele membrilor din site) și culorile ca variabile `--nfx-*`. Un stil CSS scris de admin primește și
 * clasa lui. Elementul trebuie să aibă și `data-text` (numele), pentru straturile efectelor.
 */
export function nameLook(style: NameStyleData, variant: Variant, key?: string): Look {
  const n = Math.min(variant.colors.length, 5);
  const cls = [
    "gcsp-ns",
    "gcs-nfx",
    `gcs-nfx--${shownEffect(style, n)}`,
    `gcs-nfx--n${n}`,
    style.italic ? "gcs-nfx--italic" : "",
    style.bold ? "" : "gcs-nfx--light",
    style.custom && key ? customStyleClass("name_style", key) : "",
  ]
    .filter(Boolean)
    .join(" ");
  const colors = Object.fromEntries(variant.colors.slice(0, 5).map((c, i) => [`nfx-c${i + 1}`, c]));
  return {
    cls,
    style: vars({ ...colors, "nfx-ang": `${style.angle}deg`, "nfx-sp": SPEED[style.speed] === 1 ? null : SPEED[style.speed], "nfx-gc": variant.glow ?? null, "nfx-glow": variant.glow ? 1 : null }),
  };
}

/** Aspectul unui banner (pastila de sub nume), cu animația lui; un banner CSS scris de admin primește clasa lui. */
export function bannerLook(b: BannerData, key?: string): Look {
  if (b.custom && key) return { cls: `gcsp-pill gcsp-pill--custom ${customStyleClass("banner", key)}`, style: "" };
  const n = Math.min(b.fill.colors.length, 5);
  const cls = ["gcsp-pill", `gcsp-pill--n${n}`, b.fill.animation !== "none" ? `gcsp-pill--${b.fill.animation}` : ""].filter(Boolean).join(" ");
  return { cls, style: vars({ ...colorVars(b.fill.colors), ga: `${b.fill.angle}deg`, ink: b.text, sp: SPEED[b.fill.speed] ?? 1 }) };
}

/** Banner-ul implicit (al grupului / al accentului), când membrul nu a ales unul. */
export const DEFAULT_BANNER: BannerData = { fill: { colors: ["#D62839"], angle: 90, animation: "none", speed: "normal" }, text: "#FFFFFF" };
