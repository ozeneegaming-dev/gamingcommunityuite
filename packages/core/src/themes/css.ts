import {
  NOVA_THEME_SETTINGS,
  THEME_ELEMENT_COLORS,
  THEME_TOKENS,
  themeColorCss,
  themeDefaults,
  themeElementColor,
  themeFonts,
  type GcsThemeElementColor,
  type GcsThemeElements,
  type GcsThemePalette,
  type GcsThemeSettings,
} from "./settings";

/**
 * Variabilele CSS ale culorilor de element (folosite de `base.css`, `layout.css`, `forum.css`, `widgets.css`, cu
 * valoarea de până acum ca rezervă). ACP-ul le anulează (`acp.css`), ca tema site-ului să nu-i schimbe aspectul.
 */
export const THEME_ELEMENT_VARS: Record<GcsThemeElementColor, string> = {
  bodyBg: "--gcs-body-bg",
  heading: "--gcs-heading",
  link: "--gcs-link",
  linkHover: "--gcs-link-hover",
  headerBg: "--gcs-header-bg",
  headerText: "--gcs-header-text",
  footerBg: "--gcs-footer-bg",
  footerText: "--gcs-footer-text",
  drawerBg: "--gcs-drawer-bg",
  drawerText: "--gcs-drawer-text",
  boxBg: "--gcs-box-bg",
  boxBorder: "--gcs-box-border",
  boxHeaderBg: "--gcs-box-header-bg",
  boxHeaderText: "--gcs-box-header-text",
  widgetTitle: "--gcs-widget-title",
  widgetIcon: "--gcs-widget-icon",
  btnPrimaryBg: "--gcs-btn-primary-bg",
  btnPrimaryText: "--gcs-btn-primary-text",
  btnSecondaryBg: "--gcs-btn-secondary-bg",
  btnSecondaryText: "--gcs-btn-secondary-text",
};

const GOOGLE_FONTS_IMPORT = /^@import\s+url\(\s*["']?https:\/\/fonts\.googleapis\.com\/css2?\?[^"')\s]+["']?\s*\)\s*;?$/i;

/** Fișierul editorului vizual (dialogul „CSS personalizat”): nu se redenumește și nu se șterge. */
export const CUSTOM_CSS_FILE = "custom.css";

/** De ce a fost scos ceva din CSS-ul unei teme (lista arătată adminului după salvare). */
export type GcsCssRemovalReason = "html" | "escape" | "expression" | "script_url" | "binding" | "behavior" | "charset" | "import" | "url";
export type GcsCssRemoval = { line: number; text: string; reason: GcsCssRemovalReason };

const lineAt = (text: string, offset: number) => {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};
const snippet = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);

/**
 * CSS-ul extra al unei teme (scris de admin), curățat înainte de a ajunge în pagină, plus lista a ce s-a scos (rândul,
 * fragmentul și motivul), ca editorul să-i poată spune adminului exact ce nu e permis:
 * - fără `<` (deci fără `</style>` sau HTML strecurat);
 * - fără `expression(`, `javascript:`, `vbscript:`, `-moz-binding`, `behavior:` (vectori vechi de execuție);
 * - `@import` doar de la Google Fonts; `url(...)` doar spre `https:` sau fișierele site-ului (`/files/…`);
 * - fără `@charset`.
 */
export function sanitizeThemeCssReport(raw: string): { css: string; removed: GcsCssRemoval[] } {
  const removed: GcsCssRemoval[] = [];
  /** Rândurile păstrate după scoaterea `@charset`/`@import`, cu numărul lor din textul inițial. */
  let lineMap: number[] | null = null;
  const tracked = (text: string, re: RegExp, reason: GcsCssRemovalReason, replacement: string | ((m: string, ...groups: string[]) => string | null)) =>
    text.replace(re, (match: string, ...rest: unknown[]) => {
      const offset = rest[rest.length - 2] as number;
      const whole = rest[rest.length - 1] as string;
      const out = typeof replacement === "string" ? replacement : replacement(match, ...(rest.slice(0, -2) as string[]));
      if (out === null) return match;
      const line = lineAt(whole, offset);
      removed.push({ line: lineMap?.[line - 1] ?? line, text: snippet(match), reason });
      return out;
    });

  let css = raw.replace(/\r\n?/g, "\n");
  css = tracked(css, /</g, "html", "");
  css = tracked(css, /\\3c/gi, "escape", "");
  css = tracked(css, /expression\s*\(/gi, "expression", "/* removed */(");
  css = tracked(css, /(?:java|vb)script\s*:/gi, "script_url", "");
  css = tracked(css, /-moz-binding/gi, "binding", "");
  css = tracked(css, /behavior\s*:/gi, "behavior", "");
  const kept: number[] = [];
  css = css
    .split("\n")
    .filter((line, i) => {
      const t = line.trim();
      if (/^@charset/i.test(t)) {
        removed.push({ line: i + 1, text: snippet(t), reason: "charset" });
        return false;
      }
      if (/^@import/i.test(t) && !GOOGLE_FONTS_IMPORT.test(t)) {
        removed.push({ line: i + 1, text: snippet(t), reason: "import" });
        return false;
      }
      kept.push(i + 1);
      return true;
    })
    .join("\n");
  lineMap = kept;
  css = tracked(css, /url\(\s*(["']?)([^"')]*)\1\s*\)/gi, "url", (_m, _q, url) => (/^(https:\/\/|\/files\/)/i.test((url ?? "").trim()) ? null : "none"));
  removed.sort((a, b) => a.line - b.line);
  return { css: css.trim(), removed };
}

/** CSS-ul extra curățat (vezi `sanitizeThemeCssReport`). */
export function sanitizeThemeCss(raw: string): string {
  return sanitizeThemeCssReport(raw).css;
}

/** Fișierele CSS ale unei teme, în ordine, ca un singur text (fiecare cu numele lui într-un comentariu). */
export function joinThemeCssFiles(files: readonly { name: string; content: string }[]): string {
  return files
    .filter((f) => f.content.trim())
    .map((f) => `/* ${f.name.replace(/\*\//g, "")} */\n${f.content}`)
    .join("\n\n");
}

const palette = (p: GcsThemePalette) => THEME_TOKENS.map((k) => `  --gcs-${k}: ${p[k]};`).join("\n");

/**
 * Hover-ul butonului principal. Clasic: nuanța din machete pentru accentul implicit, altfel culoarea lui, mai deschisă.
 * Nova: stratul de lumină al sistemului de hover (+8% alb), oricare ar fi culoarea.
 */
function primaryHover(elements: GcsThemeElements, p: GcsThemePalette, base: GcsThemePalette, preset: GcsThemeSettings["preset"]): string {
  if (preset === "nova") return `color-mix(in srgb, ${themeColorCss(elements.btnPrimaryBg)} 92%, #fff)`;
  if (elements.btnPrimaryBg === "@accent" && p.accent.toUpperCase() === base.accent.toUpperCase()) return "#E23446";
  return `color-mix(in srgb, ${themeColorCss(elements.btnPrimaryBg)} 86%, #fff)`;
}

/** Variabilele culorilor de element (elementele opace nu ies niciodată `transparent`, nici din setări nenormalizate). */
const elements = (e: GcsThemeElements, p: GcsThemePalette, base: GcsThemePalette, preset: GcsThemeSettings["preset"]) =>
  [...THEME_ELEMENT_COLORS.map((k) => `  ${THEME_ELEMENT_VARS[k]}: ${themeColorCss(themeElementColor(k, e[k]))};`), `  --gcs-btn-primary-hover: ${primaryHover(e, p, base, preset)};`].join("\n");

/** Fonturile livrate cu aplicația (prin next/font) au o variabilă proprie; restul vin din Google Fonts. */
const BUNDLED_FONTS: Record<string, string> = { "Chakra Petch": "var(--font-gcs-display)", Manrope: "var(--font-gcs-text)", "DM Sans": "var(--font-gcs-nova)" };

const fontStack = (name: string, fallback: string) => {
  const family = `"${name.replace(/["\\]/g, "")}"`;
  return BUNDLED_FONTS[name] ? `${BUNDLED_FONTS[name]}, ${family}, ${fallback}` : `${family}, ${fallback}`;
};

const SHADOWS: Record<GcsThemeSettings["boxes"]["shadow"], string> = {
  none: "none",
  subtle: "0 2px 4px -1px rgb(11 15 23 / 0.1)",
  soft: "0 4px 16px rgb(0 0 0 / 0.16)",
  strong: "0 12px 34px rgb(0 0 0 / 0.34)",
};

/** Variabilele care nu depind de mod (dimensiuni, fonturi, umbre). */
function sizes(s: GcsThemeSettings): string {
  const fonts = themeFonts(s);
  return [
    `  --gcs-font-display: ${fontStack(fonts.display, "sans-serif")};`,
    `  --gcs-font-text: ${fontStack(fonts.text, "system-ui, sans-serif")};`,
    `  --gcs-radius: ${s.radius}px;`,
    `  --gcs-page-width: ${s.width}px;`,
    `  --gcs-base-size: ${s.typography.baseSize / 16}rem;`,
    `  --gcs-content-scale: ${s.typography.contentSize / 100};`,
    `  --gcs-header-h: ${s.header.height}px;`,
    `  --gcs-header-h-mobile: ${s.header.heightMobile}px;`,
    `  --gcs-logo-font: var(${s.logo.font === "text" ? "--gcs-font-text" : "--gcs-font-display"});`,
    `  --gcs-logo-weight: ${s.logo.weight};`,
    `  --gcs-logo-size: ${s.logo.size}px;`,
    `  --gcs-logo-size-mobile: ${s.logo.sizeMobile}px;`,
    `  --gcs-logo-max-h: ${Math.round((s.header.height * s.logo.height) / 100)}px;`,
    `  --gcs-logo-max-h-mobile: ${Math.round((s.header.heightMobile * s.logo.heightMobile) / 100)}px;`,
    `  --gcs-box-border-w: ${s.boxes.borderWidth}px;`,
    `  --gcs-box-shadow: ${SHADOWS[s.boxes.shadow]};`,
    `  --gcs-sidebar-w: ${s.sidebar.width}px;`,
    `  --gcs-avatar-radius: ${s.avatars.rounded ? "50%" : "18%"};`,
    `  --gcs-btn-radius: ${s.buttons.radius}px;`,
    // Nova: imaginea antetului (un fișier al site-ului, deja validat) și stratul închis de peste ea.
    `  --gcs-header-image: ${s.header.image ? `url("${s.header.image}")` : "none"};`,
    `  --gcs-header-overlay: ${s.header.overlay / 100};`,
  ].join("\n");
}

/** Raza iconiței din bandă (Nova), după formă. */
const BAND_ICON_RADIUS: Record<GcsThemeSettings["bands"]["icon"], string> = { circle: "50%", rounded: "10px", none: "0" };

/**
 * Regulile setărilor Nova (`NOVA_ONLY_FIELDS`), doar când diferă de aspectul Nova implicit. Țintesc `.gcs-nova` (clasa
 * pusă de layout-ul site-ului pe designul Nova), deci în designul clasic nu schimbă nimic.
 */
function novaRules(s: GcsThemeSettings): string[] {
  const base = NOVA_THEME_SETTINGS;
  const rules: string[] = [];
  if (s.bands.style === "gradient") {
    rules.push(
      `html:root .gcs-nova {\n  --gcs-band-bg: linear-gradient(90deg, color-mix(in srgb, var(--gcs-accent) 14%, transparent), transparent 62%), var(--gcs-box-header-bg, var(--gcs-surface2));\n}`,
    );
  }
  if (s.bands.style === "accent") rules.push(`html:root .gcs-nova {\n  --gcs-band-shadow: inset 3px 0 0 var(--gcs-accent);\n}`);
  if (s.bands.icon !== base.bands.icon) {
    const none = s.bands.icon === "none" ? `\n  --gcs-band-icon-bg: transparent;\n  --gcs-band-icon-border: transparent;\n  --gcs-band-icon-size: 22px;` : "";
    rules.push(`html:root .gcs-nova {\n  --gcs-band-icon-radius: ${BAND_ICON_RADIUS[s.bands.icon]};${none}\n}`);
  }
  if (!s.effects.hover) rules.push(`html:root .gcs-nova {\n  --gcs-hover-scale: 1;\n  --gcs-hover-lift: 0px;\n  --gcs-ease: 0s;\n}`);
  if (!s.header.pattern) rules.push(`html:root .gcs-nova {\n  --gcs-hero-pattern: none;\n}`);
  if (!s.header.crumbs) rules.push(`html:root .gcs-nova .gcs-crumbBar {\n  display: none;\n}`);
  return rules;
}

/**
 * Regulile care apar doar când o setare diferă de aspectul implicit (aranjamente, comutatoare). Prefixul `html:root`
 * le dă specificitate peste regulile de bază, oricare ar fi ordinea fișierelor CSS.
 */
function conditionalRules(s: GcsThemeSettings): string[] {
  const rules: string[] = [];
  // Aceeași specificitate ca `.gcs-card` (umbrele proprii ale componentelor rămân); nu și în ACP.
  if (s.boxes.shadow !== "none") rules.push(`.gcs-card:where(:not(.gcs-acp *)) {\n  box-shadow: var(--gcs-box-shadow);\n}`);
  if (!s.scheme.toggle) rules.push(`html:root .gcs-siteFooter__scheme {\n  display: none;\n}`);
  if (s.logo.textMobile) rules.push(`@media (max-width: 640px) {\n  html:root .gcs-brand__text {\n    display: flex;\n  }\n}`);
  if (!s.header.navIcons) rules.push(`html:root .gcs-navbar__menu .gcs-nav__link > .gcs-icon:not(.gcs-navbar__caret) {\n  display: none;\n}`);
  if (!s.header.sticky) rules.push(`html:root .gcs-siteHeader {\n  position: relative;\n}`);
  if (s.mobileNav.side === "right") {
    rules.push(
      `html:root .gcs-drawer__panel {\n  inset: 0 0 0 auto;\n  border-right: 0;\n  border-left: 1px solid var(--gcs-border);\n  animation-name: gcs-drawer-in-right;\n}`,
    );
  }
  if (!s.mobileNav.icons) rules.push(`html:root .gcs-drawer__link > .gcs-icon {\n  display: none;\n}`);
  if (s.boxes.clickableRows) {
    rules.push(
      `html:root .gcs-forumRow {\n  position: relative;\n  cursor: pointer;\n}`,
      `html:root .gcs-forumRow__title a::after {\n  content: "";\n  position: absolute;\n  inset: 0;\n}`,
      `html:root .gcs-forumRow__subs a,\nhtml:root .gcs-forumRow__last a,\nhtml:root .gcs-forumRow__last .gcs-avatarFrame,\nhtml:root .gcs-forumRow__last .gcs-avatar {\n  position: relative;\n  z-index: 1;\n}`,
    );
  }
  if (s.sidebar.position === "left") rules.push(`html:root .gcs-forumLayout {\n  flex-direction: row-reverse;\n}`);
  if (s.sidebar.sticky) {
    const top = s.header.sticky ? "calc(var(--gcs-header-h) + 16px)" : "16px";
    rules.push(`@media (min-width: 1100px) {\n  html:root .gcs-forumSidebar {\n    position: sticky;\n    top: ${top};\n  }\n}`);
  }
  if (s.layout.forumIndex === "grid") {
    rules.push(
      `html:root .gcs-forumIndex .gcs-category {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));\n}`,
      `html:root .gcs-forumIndex .gcs-category__header {\n  grid-column: 1 / -1;\n}`,
      `html:root .gcs-forumIndex .gcs-forumRow {\n  flex-direction: column;\n  align-items: flex-start;\n  border-bottom: 0;\n  border-top: 1px solid var(--gcs-border);\n  border-right: 1px solid var(--gcs-border);\n}`,
      `html:root .gcs-forumIndex .gcs-forumRow__main {\n  flex: 1 1 auto;\n  width: 100%;\n}`,
      `html:root .gcs-forumIndex .gcs-forumRow__stats,\nhtml:root .gcs-forumIndex .gcs-forumRow__last {\n  width: 100%;\n}`,
    );
  }
  if (s.layout.topicView === "compact") {
    rules.push(
      `@media (min-width: 721px) {\n  html:root .gcs-post__author.gcs-postbit {\n    flex-basis: 190px;\n    max-width: 190px;\n  }\n  html:root .gcs-postbit__profile {\n    grid-template-columns: minmax(0, 1fr);\n    justify-items: center;\n    text-align: center;\n  }\n  html:root .gcs-postbit__identity {\n    align-items: center;\n  }\n  html:root .gcs-postbit__rows,\n  html:root .gcs-postbit__motto {\n    display: none;\n  }\n}`,
    );
  }
  if (s.layout.featureFirstPost) {
    rules.push(
      `html:root .gcs-post[data-post-number="1"] {\n  border-color: color-mix(in srgb, var(--gcs-accent) 55%, var(--gcs-border));\n  box-shadow: 0 0 0 1px color-mix(in srgb, var(--gcs-accent) 30%, transparent), 0 14px 34px color-mix(in srgb, var(--gcs-accent) 14%, transparent);\n}`,
    );
  }
  return rules;
}

/** Fonturile Google necesare (cele livrate cu aplicația nu se mai descarcă). */
function fontImports(s: GcsThemeSettings): string[] {
  const fonts = themeFonts(s);
  return [...new Set([fonts.display, fonts.text])]
    .filter((f) => !BUNDLED_FONTS[f])
    .map((f) => `@import url("https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap");`);
}

/**
 * CSS-ul unei teme: paleta și culorile elementelor pentru dark pe `html:root`, cele light pe `html[data-theme="light"]`
 * (și pe „auto” când sistemul e luminos), dimensiunile, regulile condiționale, apoi CSS-ul extra (deja sanitizat).
 * Selectorii au specificitate mai mare decât `tokens.css`, ca tema să câștige indiferent de ordinea fișierelor.
 * Funcția e pură: editorul vizual o rulează și în browser, pentru previzualizarea live.
 */
export function compileThemeCss(settings: GcsThemeSettings, customCss: string): string {
  const base = themeDefaults(settings.preset);
  const light = `${palette(settings.light)}\n${elements(settings.elements.light, settings.light, base.light, settings.preset)}`;
  return [
    ...fontImports(settings),
    `html:root {\n${palette(settings.dark)}\n${elements(settings.elements.dark, settings.dark, base.dark, settings.preset)}\n${sizes(settings)}\n}`,
    `html[data-theme="light"] {\n${light}\n}`,
    `@media (prefers-color-scheme: light) {\n  html[data-theme="auto"] {\n${light.replace(/^/gm, "  ")}\n  }\n}`,
    `.gcs-card {\n  border-radius: var(--gcs-radius);\n}`,
    ...conditionalRules(settings),
    ...novaRules(settings),
    customCss ? `/* CSS extra */\n${sanitizeThemeCss(customCss)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
