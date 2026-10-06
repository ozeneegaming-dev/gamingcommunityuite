import type { GcsThemePalette, GcsThemeSettings } from "./service";

const TOKEN_VARS: Record<keyof GcsThemePalette, string> = {
  bg: "--gcs-bg",
  surface: "--gcs-surface",
  surface2: "--gcs-surface2",
  border: "--gcs-border",
  text: "--gcs-text",
  muted: "--gcs-muted",
  accent: "--gcs-accent",
  accentInk: "--gcs-accentInk",
  chrome: "--gcs-chrome",
  chrome2: "--gcs-chrome2",
  ok: "--gcs-ok",
  warn: "--gcs-warn",
};

const GOOGLE_FONTS_IMPORT = /^@import\s+url\(\s*["']?https:\/\/fonts\.googleapis\.com\/css2?\?[^"')\s]+["']?\s*\)\s*;?$/i;

/**
 * CSS-ul extra al unei teme (scris de admin), curățat înainte de a ajunge în pagină:
 * - fără `<` (deci fără `</style>` sau HTML strecurat);
 * - fără `expression(`, `javascript:`, `vbscript:`, `-moz-binding`, `behavior:` (vectori vechi de execuție);
 * - `@import` doar de la Google Fonts; `url(...)` doar spre `https:` sau fișierele site-ului (`/files/…`);
 * - fără `@charset`.
 */
export function sanitizeThemeCss(raw: string): string {
  let css = raw.replace(/\r\n?/g, "\n").replace(/</g, "").replace(/\\3c/gi, "");
  css = css.replace(/expression\s*\(/gi, "/* removed */(").replace(/(?:java|vb)script\s*:/gi, "").replace(/-moz-binding/gi, "").replace(/behavior\s*:/gi, "");
  css = css
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^@charset/i.test(t)) return false;
      if (/^@import/i.test(t)) return GOOGLE_FONTS_IMPORT.test(t);
      return true;
    })
    .join("\n");
  css = css.replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (m, _q: string, url: string) => (/^(https:\/\/|\/files\/)/i.test(url.trim()) ? m : "none"));
  return css.trim();
}

const palette = (p: GcsThemePalette) =>
  (Object.keys(TOKEN_VARS) as (keyof GcsThemePalette)[]).map((k) => `  ${TOKEN_VARS[k]}: ${p[k]};`).join("\n");

/** Fonturile livrate cu aplicația (prin next/font) au o variabilă proprie; restul vin din Google Fonts. */
const BUNDLED_FONTS: Record<string, string> = { "Chakra Petch": "var(--font-gcs-display)", Manrope: "var(--font-gcs-text)" };

const fontStack = (name: string, fallback: string) => {
  const family = `"${name.replace(/"/g, "")}"`;
  return BUNDLED_FONTS[name] ? `${BUNDLED_FONTS[name]}, ${family}, ${fallback}` : `${family}, ${fallback}`;
};

/**
 * CSS-ul unei teme: paleta dark pe `html:root`, cea light pe `html[data-theme="light"]` (și pe „auto” când sistemul
 * e luminos), fonturile, raza, lățimea paginii, apoi CSS-ul extra (deja sanitizat). Selectorii au specificitate mai
 * mare decât `tokens.css`, ca tema să câștige indiferent de ordinea fișierelor.
 */
export function compileThemeCss(settings: GcsThemeSettings, customCss: string): string {
  const fontImports = [...new Set([settings.fontDisplay, settings.fontText])]
    .filter((f) => !BUNDLED_FONTS[f])
    .map((f) => `@import url("https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700&display=swap");`);
  return [
    ...fontImports,
    `html:root {\n${palette(settings.dark)}\n  --gcs-font-display: ${fontStack(settings.fontDisplay, "sans-serif")};\n  --gcs-font-text: ${fontStack(settings.fontText, "system-ui, sans-serif")};\n  --gcs-radius: ${settings.radius}px;\n  --gcs-page-width: ${settings.width}px;\n}`,
    `html[data-theme="light"] {\n${palette(settings.light)}\n}`,
    `@media (prefers-color-scheme: light) {\n  html[data-theme="auto"] {\n${palette(settings.light).replace(/^/gm, "  ")}\n  }\n}`,
    `.gcs-card {\n  border-radius: var(--gcs-radius);\n}`,
    customCss ? `/* CSS extra */\n${sanitizeThemeCss(customCss)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
