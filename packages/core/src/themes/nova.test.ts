import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { compileThemeCss } from "./css";
import { CLASSIC_THEME_KEY, GcsThemeService, NOVA_SEED_MARK, NOVA_THEME_KEY } from "./service";
import {
  DEFAULT_THEME_SETTINGS,
  NOVA_ONLY_FIELDS,
  NOVA_THEME_SETTINGS,
  THEME_FIELDS,
  THEME_FONTS,
  normalizeThemeSettings,
  themeDefaults,
  themeFieldError,
  themePath,
  themeSettingsErrors,
  withThemePath,
  type GcsThemePalette,
} from "./settings";

/** Luminanța relativă WCAG a unei culori `#RRGGBB`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
};
const resolve = (value: string, p: GcsThemePalette) => (value.startsWith("@") ? p[value.slice(1) as keyof GcsThemePalette] : value);
const nova = (path: string, value: unknown) => withThemePath(structuredClone(NOVA_THEME_SETTINGS), path, value);

describe("designul Nova: setările", () => {
  test("valorile din referință: bleumarin, portocaliu-roșu, DM Sans 13 px, casete 12 px, butoane 4 px", () => {
    expect(NOVA_THEME_SETTINGS.preset).toBe("nova");
    expect(NOVA_THEME_SETTINGS.dark).toMatchObject({ bg: "#0B0F17", surface: "#151922", border: "#1E2533", text: "#CED5DE", accent: "#DF390C" });
    expect(NOVA_THEME_SETTINGS.light.accent).toBe(NOVA_THEME_SETTINGS.dark.accent);
    expect(NOVA_THEME_SETTINGS.elements.dark.btnSecondaryBg).toBe("#202630");
    expect(NOVA_THEME_SETTINGS.elements.dark.heading).toBe("#FFFFFF");
    expect(NOVA_THEME_SETTINGS.elements.dark.link).toBe("#FFFFFF");
    expect(NOVA_THEME_SETTINGS.elements.dark.linkHover).toBe("@accent");
    expect([NOVA_THEME_SETTINGS.fontText, NOVA_THEME_SETTINGS.fontDisplay]).toEqual(["DM Sans", "DM Sans"]);
    expect(THEME_FONTS).toContain("DM Sans");
    expect(NOVA_THEME_SETTINGS.typography.baseSize).toBe(13);
    expect(NOVA_THEME_SETTINGS.radius).toBe(12);
    expect(NOVA_THEME_SETTINGS.buttons.radius).toBe(4);
    expect(NOVA_THEME_SETTINGS.boxes.shadow).toBe("subtle");
    expect(NOVA_THEME_SETTINGS.scheme.default).toBe("dark");
  });

  test("fiecare valoare Nova e validă pentru câmpul ei; designul clasic rămâne cel de până acum", () => {
    for (const settings of [NOVA_THEME_SETTINGS, DEFAULT_THEME_SETTINGS]) {
      const bad = Object.entries(THEME_FIELDS)
        .map(([path, field]) => [path, themeFieldError(field, themePath(settings, path))] as const)
        .filter(([, err]) => err !== null);
      expect(bad).toEqual([]);
    }
    expect(DEFAULT_THEME_SETTINGS.preset).toBe("classic");
    expect(DEFAULT_THEME_SETTINGS.dark.accent).toBe("#D62839");
    expect(themeDefaults("nova")).toBe(NOVA_THEME_SETTINGS);
    expect(themeDefaults("classic")).toBe(DEFAULT_THEME_SETTINGS);
    expect(themeDefaults(undefined)).toBe(DEFAULT_THEME_SETTINGS);
  });

  test("normalizarea completează din designul temei: o temă Nova parțială primește valorile Nova", () => {
    const s = normalizeThemeSettings({ preset: "nova", dark: { accent: "#3366FF" }, header: { overlay: 40 } });
    expect(s.preset).toBe("nova");
    expect(s.dark.accent).toBe("#3366FF");
    expect(s.dark.bg).toBe(NOVA_THEME_SETTINGS.dark.bg);
    expect(s.header.overlay).toBe(40);
    expect(s.header.height).toBe(NOVA_THEME_SETTINGS.header.height);
    expect(s.fontText).toBe("DM Sans");
    // Fără design (temele vechi) sau cu unul necunoscut: clasic.
    expect(normalizeThemeSettings({ radius: 8 }).dark.accent).toBe(DEFAULT_THEME_SETTINGS.dark.accent);
    expect(normalizeThemeSettings({ preset: "matrix" }).preset).toBe("classic");
  });

  test("setările noi se validează strict", () => {
    expect(themeSettingsErrors({ preset: "nova", header: { image: "/files/abc_1", overlay: 55, pattern: false, crumbs: true }, bands: { style: "gradient", icon: "rounded" }, effects: { hover: false } })).toEqual({});
    expect(
      themeSettingsErrors({ preset: "matrix", header: { image: "https://x.example/a.jpg", overlay: 99 }, bands: { style: "neon", icon: "star" }, effects: { hover: "da" } }),
    ).toEqual({
      preset: "invalid_choice",
      "header.image": "invalid",
      "header.overlay": "invalid_range",
      "bands.style": "invalid_choice",
      "bands.icon": "invalid_choice",
      "effects.hover": "invalid_type",
    });
    for (const path of NOVA_ONLY_FIELDS) expect(THEME_FIELDS[path], path).toBeDefined();
  });

  test("contrastul: textul, textul secundar, linkurile și butonul principal se citesc în ambele moduri", () => {
    for (const mode of ["dark", "light"] as const) {
      const p = NOVA_THEME_SETTINGS[mode];
      const e = NOVA_THEME_SETTINGS.elements[mode];
      for (const surface of [p.bg, p.surface, p.surface2]) {
        expect(contrast(p.text, surface), `${mode} text`).toBeGreaterThanOrEqual(7);
        expect(contrast(p.muted, surface), `${mode} muted`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.accentInk, surface), `${mode} accentInk`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(resolve(e.link, p)!, surface), `${mode} link`).toBeGreaterThanOrEqual(4.5);
      }
      // Accentul măsurat în referință (#DF390C) dă 4.44:1 cu textul alb al butoanelor (semibold); îl păstrăm exact.
      expect(contrast("#FFFFFF", p.accent), `${mode} buton`).toBeGreaterThanOrEqual(4.4);
      // Antetul e închis în ambele moduri (imaginea cu stratul întunecat).
      expect(contrast(resolve(e.headerText, p)!, resolve(e.headerBg, p)!), `${mode} antet`).toBeGreaterThanOrEqual(7);
    }
  });

  test("banda titlurilor diferă și de pagină, și de casetă, în ambele moduri", () => {
    for (const mode of ["dark", "light"] as const) {
      const p = NOVA_THEME_SETTINGS[mode];
      const e = NOVA_THEME_SETTINGS.elements[mode];
      const band = resolve(e.boxHeaderBg, p)!.toUpperCase();
      expect(band).not.toBe(resolve(e.boxBg, p)!.toUpperCase());
      expect(band).not.toBe(resolve(e.bodyBg, p)!.toUpperCase());
    }
  });
});

describe("designul Nova: CSS-ul compilat", () => {
  test("DM Sans vine cu aplicația (fără Google Fonts), hover-ul butonului e +8% alb, umbra fină", () => {
    const css = compileThemeCss(NOVA_THEME_SETTINGS, "");
    expect(css).toContain("--gcs-font-text: var(--font-gcs-nova), \"DM Sans\", system-ui, sans-serif;");
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).toContain("--gcs-btn-primary-hover: color-mix(in srgb, var(--gcs-accent) 92%, #fff);");
    expect(css).toContain("--gcs-box-shadow: 0 2px 4px -1px rgb(11 15 23 / 0.1);");
    expect(css).toContain("--gcs-btn-radius: 4px;");
    expect(css).toContain("--gcs-base-size: 0.8125rem;");
    expect(css).toContain("--gcs-header-image: none;");
    expect(css).toContain("--gcs-header-overlay: 0.7;");
  });

  test("valorile Nova implicite nu adaugă reguli; cele schimbate țintesc doar `.gcs-nova`", () => {
    const plain = compileThemeCss(NOVA_THEME_SETTINGS, "");
    expect(plain).not.toContain(".gcs-nova");
    let s = nova("bands.style", "gradient");
    s = withThemePath(s, "bands.icon", "none");
    s = withThemePath(s, "effects.hover", false);
    s = withThemePath(s, "header.pattern", false);
    s = withThemePath(s, "header.crumbs", false);
    s = withThemePath(s, "header.image", "/files/hero01");
    const css = compileThemeCss(s, "");
    expect(css).toContain('--gcs-header-image: url("/files/hero01");');
    expect(css).toContain("--gcs-band-bg: linear-gradient(90deg");
    expect(css).toContain("--gcs-band-icon-radius: 0;");
    expect(css).toContain("--gcs-band-icon-bg: transparent;");
    expect(css).toContain("--gcs-hover-scale: 1;");
    expect(css).toContain("--gcs-hero-pattern: none;");
    expect(css).toContain("html:root .gcs-nova .gcs-crumbBar {\n  display: none;");
    expect(compileThemeCss(nova("bands.style", "accent"), "")).toContain("--gcs-band-shadow: inset 3px 0 0 var(--gcs-accent);");
    expect(compileThemeCss(nova("bands.icon", "rounded"), "")).toContain("--gcs-band-icon-radius: 10px;");
  });

  test("designul clasic nu se schimbă: hover-ul din machete și aceleași variabile", () => {
    const css = compileThemeCss(DEFAULT_THEME_SETTINGS, "");
    expect(css).toContain("--gcs-btn-primary-hover: #E23446;");
    expect(css).not.toContain(".gcs-nova");
    expect(css).not.toContain("--font-gcs-nova");
  });
});

describe("temele incluse: instalare nouă și actualizare", () => {
  let w: GcsTestWorld;

  beforeEach(async () => {
    w = await createWorld([]);
    // Lumea de test are deja seed-ul: pornim de la o bază fără teme și fără marcajul Nova.
    await w.db.theme.deleteMany();
    const state = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
    await w.db.systemState.update({ where: { id: 1 }, data: { seedMarks: state.seedMarks.filter((m) => m !== NOVA_SEED_MARK) } });
  });

  afterAll(async () => {
    await w.db.$disconnect();
  });

  const seed = () => w.db.$transaction((tx) => GcsThemeService.seedDefault(tx));
  const rows = () => w.db.theme.findMany({ orderBy: { key: "asc" }, select: { key: true, name: true, isDefault: true, enabled: true, settings: true } });

  test("o instalare nouă primește GCS Nova (implicită) și Clasic; seed-ul repetat nu schimbă nimic", async () => {
    await seed();
    await seed();
    const themes = await rows();
    expect(themes.map((t) => [t.key, t.name, t.isDefault])).toEqual([
      [CLASSIC_THEME_KEY, "Clasic", false],
      [NOVA_THEME_KEY, "GCS Nova", true],
    ]);
    expect(normalizeThemeSettings(themes.find((t) => t.key === NOVA_THEME_KEY)!.settings).preset).toBe("nova");
    expect(normalizeThemeSettings(themes.find((t) => t.key === CLASSIC_THEME_KEY)!.settings)).toEqual(DEFAULT_THEME_SETTINGS);
    expect((await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } })).seedMarks.filter((m) => m === NOVA_SEED_MARK)).toHaveLength(1);
    // Fiecare temă are fișierul `custom.css` al editorului vizual.
    expect(await w.db.themeCssFile.count({ where: { name: "custom.css" } })).toBe(2);
  });

  test("o instalare existentă primește Nova o singură dată; vechea temă devine „Clasic”, alegerea ulterioară a adminului rămâne", async () => {
    await w.db.theme.create({ data: { key: "default", name: "Default", isDefault: true, settings: DEFAULT_THEME_SETTINGS as never } });
    await w.db.theme.create({ data: { key: "neon", name: "Neon", settings: DEFAULT_THEME_SETTINGS as never } });
    await seed();
    let themes = await rows();
    expect(themes.map((t) => [t.key, t.name, t.isDefault])).toEqual([
      ["default", "Clasic", false],
      ["neon", "Neon", false],
      [NOVA_THEME_KEY, "GCS Nova", true],
    ]);
    // Adminul revine la tema clasică: la repornire seed-ul nu mai schimbă tema implicită.
    await w.db.theme.updateMany({ data: { isDefault: false } });
    await w.db.theme.update({ where: { key: "default" }, data: { isDefault: true } });
    await seed();
    themes = await rows();
    expect(themes.filter((t) => t.isDefault).map((t) => t.key)).toEqual(["default"]);
    expect(themes).toHaveLength(3);
  });

  test("un nume ales de admin pentru vechea temă rămâne; o cheie `nova` ocupată primește alternativa", async () => {
    await w.db.theme.create({ data: { key: "default", name: "Tema mea", isDefault: true, settings: DEFAULT_THEME_SETTINGS as never } });
    await w.db.theme.create({ data: { key: "nova", name: "Nova veche", settings: DEFAULT_THEME_SETTINGS as never } });
    await seed();
    const themes = await rows();
    expect(themes.map((t) => [t.key, t.name, t.isDefault])).toEqual([
      ["default", "Tema mea", false],
      ["gcs-nova", "GCS Nova", true],
      ["nova", "Nova veche", false],
    ]);
  });
});
