/** Stilul numelui unui grup (spec §9). Se compilează în clasa `.gcs-name--<key>`. */
export type GcsNameStyle = {
  color?: string;
  gradient?: string[];
  animated?: boolean;
  glow?: string;
  bold?: boolean;
  italic?: boolean;
  icon?: string;
};

export type GcsNameStyleGroup = { key: string; nameStyle: GcsNameStyle | null; color: string | null };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const GROUP_KEY = /^[a-z0-9_]+$/;
/** Iconul: 1–4 caractere „sigure” (litere, cifre, emoji, spațiu). Fără ghilimele, acolade sau backslash. */
const SAFE_ICON = /^[\p{L}\p{N}\p{Extended_Pictographic}‍️ ]{1,4}$/u;

export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX_COLOR.test(v);

function hexToRgba(hex: string, alpha: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function ruleFor(group: GcsNameStyleGroup): { css: string; animated: boolean } | null {
  if (!GROUP_KEY.test(group.key)) return null;
  const style = group.nameStyle ?? {};
  const decls: string[] = [];
  let animated = false;

  const gradient = (style.gradient ?? []).filter(isHexColor);
  if (gradient.length >= 2) {
    // Prima culoare se repetă la final, ca animația să se reia fără „salt” (ca în machetă).
    decls.push(
      `background:linear-gradient(90deg,${[...gradient, gradient[0]].join(",")})`,
      "background-size:200% auto",
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
    );
    if (style.animated) {
      decls.push("animation:gcsShimmer 3s linear infinite");
      animated = true;
    }
  } else {
    const color = isHexColor(style.color) ? style.color : isHexColor(group.color) ? group.color : null;
    if (color) decls.push(`color:${color}`);
  }

  if (isHexColor(style.glow)) decls.push(`text-shadow:0 0 10px ${hexToRgba(style.glow, ".55")}`);
  decls.push(`font-weight:${style.bold ? 700 : 600}`);
  if (style.italic) decls.push("font-style:italic");

  let css = `.gcs-name--${group.key}{${decls.join(";")}}`;
  if (typeof style.icon === "string" && SAFE_ICON.test(style.icon)) {
    css += `.gcs-name--${group.key}::before{content:"${style.icon}";margin-right:.25em}`;
  }
  return { css, animated };
}

/**
 * Generează CSS-ul cu stilurile de nume ale tuturor grupurilor. Culorile sunt validate ca `#RRGGBB`
 * și cheile ca `[a-z0-9_]+`; orice altă valoare e ignorată, deci din ACP nu se poate injecta CSS.
 * Animațiile se opresc sub `prefers-reduced-motion: reduce`.
 */
export function compileNameStylesCss(groups: GcsNameStyleGroup[]): string {
  const rules = groups.map(ruleFor).filter((r) => r !== null);
  const parts = rules.map((r) => r.css);
  if (rules.some((r) => r.animated)) parts.push("@keyframes gcsShimmer{to{background-position:200% center}}");
  parts.push('@media (prefers-reduced-motion: reduce){[class*="gcs-name--"],[class*="gcs-name--"]::before{animation:none}}');
  return parts.join("\n");
}
