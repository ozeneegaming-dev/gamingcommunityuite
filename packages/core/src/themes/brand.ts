import { readableFill } from "./palette";

/**
 * Brandul GamingCommunitySuite, direcția „Forja” (aleasă de proprietar pe 2026-11-02 pe board-ul de brand): SINGURA sursă
 * a valorilor vizuale ale produsului. Din ea vin:
 * - paleta temelor GCS Dark / GCS White (`NOVA_THEME_SETTINGS`), deci tema implicită a forumului;
 * - `@gcs/ui/tokens.css`: valorile brute (`--gcs-brand-*`), rezerva tokenilor comuni pe `:root` și cromul produsului
 *   (`.gcs-product`: ACP, installer, intrarea în ACP), care nu se schimbă cu tema site-ului;
 * - `docs/brand/gcs-brand.css` și `docs/brand/gcs-mark.svg`: pentru panourile PHP (Data Center, portalul și site-ul).
 * Fișierele generate se rescriu cu `pnpm --filter @gcs/web brand`; testele pică dacă nu mai sunt la zi.
 */

/** Culorile unui mod (întunecat / luminos). */
export type GcsBrandScheme = {
  bg: string;
  chrome: string;
  chrome2: string;
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  text: string;
  heading: string;
  muted: string;
  /** Culoarea mărcii: logo, accente mari, grafică. */
  accent: string;
  /** Accentul ca text (linkuri, etichete), ≥ 4.5:1 pe suprafață. */
  accentInk: string;
  /** Accentul ca fundal plin sub text alb (butonul principal), ≥ 4.5:1 și în starea de hover. */
  accentFill: string;
  secondary: string;
  secondaryText: string;
  ok: string;
  /** Chihlimbar, nu portocaliu: avertismentul nu trebuie să semene cu accentul. */
  warn: string;
  danger: string;
  info: string;
  /** Aplicațiile premium și VIP. */
  premium: string;
};

const ACCENT = "#DF390C";

const DARK: GcsBrandScheme = {
  bg: "#0B0F17",
  chrome: "#0E121A",
  chrome2: "#10141D",
  surface: "#151922",
  surface2: "#1A1F29",
  border: "#1E2533",
  borderStrong: "#2A3242",
  text: "#CED5DE",
  heading: "#FFFFFF",
  muted: "#7E8999",
  accent: ACCENT,
  accentInk: "#FF6A3D",
  accentFill: readableFill(ACCENT, "#FFFFFF"),
  secondary: "#202630",
  secondaryText: "#FFFFFF",
  ok: "#2ECC71",
  warn: "#F2B33D",
  danger: "#F0444F",
  info: "#4D9BE6",
  premium: "#F2B33D",
};

const LIGHT: GcsBrandScheme = {
  bg: "#F1F3F7",
  chrome: "#FFFFFF",
  chrome2: "#F7F8FA",
  surface: "#FFFFFF",
  surface2: "#F3F5F9",
  border: "#DCE1E9",
  borderStrong: "#C9D0DB",
  text: "#1B2230",
  heading: "#0B0F17",
  muted: "#596374",
  accent: ACCENT,
  accentInk: "#C2300A",
  accentFill: readableFill(ACCENT, "#FFFFFF"),
  secondary: "#E9EDF2",
  secondaryText: "#1B2230",
  ok: "#167A45",
  warn: "#9A6200",
  danger: "#C8283A",
  info: "#2167C2",
  premium: "#9A6200",
};

export const GCS_BRAND = {
  name: "GamingCommunitySuite",
  short: "GCS",
  color: { dark: DARK, light: LIGHT },
  /** Scara neutrelor (fundal → text), pentru documentație și panouri. */
  neutrals: {
    950: "#0B0F17",
    900: "#0E121A",
    850: "#151922",
    800: "#1A1F29",
    700: "#1E2533",
    600: "#2A3242",
    500: "#4A5466",
    400: "#7E8999",
    300: "#A9B2BF",
    200: "#CED5DE",
    100: "#E6EAF0",
    0: "#FFFFFF",
  },
  font: {
    family: "DM Sans",
    mono: "JetBrains Mono",
    stack: '"DM Sans", system-ui, sans-serif',
    monoStack: '"JetBrains Mono", ui-monospace, Consolas, monospace',
  },
  /** Scara tipografică (px): mărime / înălțimea rândului / grosime. */
  type: {
    display: [44, 48, 800],
    h1: [30, 36, 800],
    h2: [22, 28, 700],
    h3: [17, 24, 700],
    body: [15, 24, 400],
    small: [13, 20, 500],
    label: [11, 14, 700],
  },
  radius: { button: 4, input: 6, badge: 6, card: 12, pill: 999 },
  shadow: {
    card: "0 2px 4px -1px rgb(11 15 23 / 0.1)",
    menu: "0 4px 16px rgb(0 0 0 / 0.16)",
    dialog: "0 12px 34px rgb(0 0 0 / 0.34)",
  },
  space: [4, 8, 12, 16, 24, 32, 48, 64],
  motion: { fast: "0.15s", base: "0.2s", slow: "0.3s", ease: "cubic-bezier(0.22, 1, 0.36, 1)" },
} as const;

/** Marca GCS (pătratul plin cu G-ul geometric), pe o grilă de 64. */
export const GCS_MARK = {
  viewBox: "0 0 64 64",
  radius: 14,
  path: "M42.6 21.4 A15 15 0 1 0 47 32 H33.5",
  stroke: 7.5,
} as const;

/** Marca GCS ca SVG (favicon, emailuri, panourile PHP). `mono`: alb, pentru fundaluri colorate sau foto. */
export function brandMarkSvg(opts: { size?: number; mono?: boolean } = {}): string {
  const size = opts.size ?? 64;
  const fill = opts.mono ? "#FFFFFF" : ACCENT;
  const ink = opts.mono ? DARK.bg : "#FFFFFF";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${GCS_MARK.viewBox}" role="img" aria-label="${GCS_BRAND.name}">`,
    `<rect width="64" height="64" rx="${GCS_MARK.radius}" fill="${fill}"/>`,
    `<path d="${GCS_MARK.path}" fill="none" stroke="${ink}" stroke-width="${GCS_MARK.stroke}" stroke-linecap="square"/>`,
    `</svg>`,
  ].join("");
}

const kebab = (key: string) => key.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);

/** Tokenii comuni (`--gcs-*`, aceleași nume ca în teme) și cheia brandului din care vin. */
const COMMON: [string, keyof GcsBrandScheme][] = [
  ["bg", "bg"],
  ["surface", "surface"],
  ["surface2", "surface2"],
  ["border", "border"],
  ["text", "text"],
  ["muted", "muted"],
  ["accent", "accent"],
  ["accentInk", "accentInk"],
  ["chrome", "chrome"],
  ["chrome2", "chrome2"],
  ["ok", "ok"],
  ["warn", "warn"],
  ["danger", "danger"],
  ["info", "info"],
];

const raw = (prefix: string, s: GcsBrandScheme) => (Object.keys(s) as (keyof GcsBrandScheme)[]).map((k) => `  --gcs-brand-${prefix}${kebab(k)}: ${s[k]};`);
const common = (prefix: string, keys = COMMON) => keys.map(([name, k]) => `  --gcs-${name}: var(--gcs-brand-${prefix}${kebab(k)});`);
const block = (selector: string, lines: string[], indent = "") =>
  `${indent}${selector} {\n${lines.map((l) => indent + l).join("\n")}\n${indent}}`;
/** Aceleași declarații pentru modul luminos ales explicit și pentru `auto` cu sistemul pe luminos. */
const lightBlocks = (light: string, auto: string, lines: string[]) =>
  [block(light, lines), `@media (prefers-color-scheme: light) {\n${block(auto, lines, "  ")}\n}`].join("\n");

function scales(): string[] {
  const b = GCS_BRAND;
  return [
    `  --gcs-brand-font: ${b.font.stack};`,
    `  --gcs-brand-font-mono: ${b.font.monoStack};`,
    ...Object.entries(b.radius).map(([k, v]) => `  --gcs-brand-radius-${k}: ${v}px;`),
    ...Object.entries(b.shadow).map(([k, v]) => `  --gcs-brand-shadow-${k}: ${v};`),
    ...b.space.map((v, i) => `  --gcs-brand-space-${i + 1}: ${v}px;`),
    `  --gcs-brand-ease: ${b.motion.ease};`,
    `  --gcs-brand-duration-fast: ${b.motion.fast};`,
    `  --gcs-brand-duration: ${b.motion.base};`,
    `  --gcs-brand-duration-slow: ${b.motion.slow};`,
  ];
}

/**
 * Cromul produsului: tokenii comuni din brand, plus fonturile, razele și butoanele lui. ACP-ul anulează celelalte
 * culori de element ale temei site-ului (`acp.css`), deci regulile de bază le folosesc rezerva.
 */
const productLines = (prefix: string) => [
  ...common(prefix),
  `  --gcs-heading: var(--gcs-brand-${prefix}heading);`,
  `  --gcs-accent-fill: var(--gcs-brand-${prefix}accent-fill);`,
  `  --gcs-btn-primary-bg: var(--gcs-brand-${prefix}accent-fill);`,
  `  --gcs-btn-primary-text: #FFFFFF;`,
  `  --gcs-btn-primary-hover: color-mix(in srgb, var(--gcs-brand-${prefix}accent-fill) 92%, #fff);`,
  `  --gcs-btn-secondary-bg: var(--gcs-brand-${prefix}secondary);`,
  `  --gcs-btn-secondary-text: var(--gcs-brand-${prefix}secondary-text);`,
];

/** Conținutul `@gcs/ui/tokens.css`. */
export function brandTokensCss(): string {
  const light = COMMON.filter(([name]) => name === "danger" || name === "info");
  return [
    `/*`,
    ` * GENERAT din packages/core/src/themes/brand.ts: nu edita de mână (\`pnpm --filter @gcs/web brand\`).`,
    ` * Brandul GamingCommunitySuite: valorile brute (\`--gcs-brand-*\`), rezerva tokenilor comuni pe \`:root\` (tema`,
    ` * publicată îi suprascrie pe \`html:root\`) și cromul produsului (\`.gcs-product\`: ACP, installer), care nu urmează tema.`,
    ` */`,
    block(":root", [
      ...raw("", DARK),
      ...raw("light-", LIGHT),
      ...scales(),
      `  /* Rezerva tokenilor comuni: brandul, întunecat. */`,
      ...common(""),
      `  --gcs-font-display: var(--gcs-brand-font);`,
      `  --gcs-font-text: var(--gcs-brand-font);`,
    ]),
    `/* Temele nu compilează culorile de eroare și informare: urmează modul paginii. */`,
    lightBlocks(':root[data-theme="light"]', ':root[data-theme="auto"]', common("light-", light)),
    `/* Cromul produsului GCS: aceleași culori, fonturi și forme oricare ar fi tema site-ului. */`,
    block(".gcs-product", [
      ...productLines(""),
      `  --gcs-font-display: var(--font-gcs-nova), var(--gcs-brand-font);`,
      `  --gcs-font-text: var(--font-gcs-nova), var(--gcs-brand-font);`,
      `  --gcs-radius: var(--gcs-brand-radius-card);`,
      `  --gcs-radius-sm: var(--gcs-brand-radius-input);`,
      `  --gcs-btn-radius: var(--gcs-brand-radius-button);`,
      `  --gcs-sweep: rgb(255 255 255 / 0.08);`,
      `  color-scheme: dark;`,
      `  font-family: var(--gcs-font-text);`,
    ]),
    lightBlocks('.gcs-product[data-theme="light"]', '.gcs-product[data-theme="auto"]', [
      ...productLines("light-"),
      `  --gcs-sweep: color-mix(in srgb, var(--gcs-text) 7%, transparent);`,
      `  color-scheme: light;`,
    ]),
    "",
  ].join("\n");
}

/**
 * Conținutul `docs/brand/gcs-brand.css`: tokenii pentru panourile PHP (Data Center, portalul și site-ul), fără
 * dependențe de aplicația Node. Fiecare panou își leagă variabilele proprii de acestea; `data-theme="light"` pe
 * `<html>` sau `<body>` trece pe modul luminos.
 */
export function brandPanelCss(): string {
  const fonts = `https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=JetBrains+Mono:wght@400;500;600&display=swap`;
  const scheme = (prefix: string) => [
    ...common(prefix),
    `  --gcs-heading: var(--gcs-brand-${prefix}heading);`,
    `  --gcs-border-strong: var(--gcs-brand-${prefix}border-strong);`,
    `  --gcs-accent-fill: var(--gcs-brand-${prefix}accent-fill);`,
    `  --gcs-secondary: var(--gcs-brand-${prefix}secondary);`,
    `  --gcs-secondary-text: var(--gcs-brand-${prefix}secondary-text);`,
    `  --gcs-premium: var(--gcs-brand-${prefix}premium);`,
  ];
  return [
    `/*`,
    ` * GamingCommunitySuite: tokenii brandului pentru panourile PHP (Data Center, portalul și site-ul de prezentare).`,
    ` * GENERAT din packages/core/src/themes/brand.ts (\`pnpm --filter @gcs/web brand\`); ghidul: docs/BRAND.md.`,
    ` */`,
    `@import url("${fonts}");`,
    block(":root", [
      ...raw("", DARK),
      ...raw("light-", LIGHT),
      ...Object.entries(GCS_BRAND.neutrals).map(([k, v]) => `  --gcs-brand-n${k}: ${v};`),
      ...scales(),
      ...scheme(""),
      `  --gcs-font-display: var(--gcs-brand-font);`,
      `  --gcs-font-text: var(--gcs-brand-font);`,
      `  --gcs-font-mono: var(--gcs-brand-font-mono);`,
      `  color-scheme: dark;`,
    ]),
    block(':root[data-theme="light"],\n[data-theme="light"]', [...scheme("light-"), `  color-scheme: light;`]),
    "",
  ].join("\n");
}
