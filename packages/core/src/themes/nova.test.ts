import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { compileThemeCss } from "./css";
import { headerPreset } from "./headerBuilder";
import { GcsThemeCssService } from "./files";
import { GCS_DARK_SEED_MARK, GCS_DARK_THEME_KEY, GCS_WHITE_THEME_KEY, GcsThemeService, NOVA_SEED_MARK, NOVA_THEME_KEY } from "./service";
import {
  DEFAULT_THEME_SETTINGS,
  GCS_DARK_THEME_SETTINGS,
  GCS_WHITE_THEME_SETTINGS,
  NOVA_ONLY_FIELDS,
  themeHasDesignDecor,
  themeSingleScheme,
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

  test("doar decorul e al designului GCS; funcțiile (antetul, consola, bara de jos, efectele) sunt ale sistemului", () => {
    expect([...NOVA_ONLY_FIELDS].sort()).toEqual(["bands.icon", "bands.style", "header.crumbs", "header.image", "header.overlay", "header.pattern"]);
    for (const path of ["header.layout", "header.dropdowns", "header.mega", "cockpit.enabled", "mobileNav.placement", "mobileNav.items", "effects.hover"]) {
      expect(NOVA_ONLY_FIELDS, path).not.toContain(path);
    }
    expect(themeHasDesignDecor("nova")).toBe(true);
    expect(themeHasDesignDecor("classic")).toBe(false);
  });

  test("GCS Dark: doar întunecată; GCS White: doar luminoasă, cu paleta luminoasă a designului; restul identic", () => {
    expect(themeSingleScheme(GCS_DARK_THEME_SETTINGS)).toBe("dark");
    expect(themeSingleScheme(GCS_WHITE_THEME_SETTINGS)).toBe("light");
    expect(themeSingleScheme(NOVA_THEME_SETTINGS)).toBeNull();
    expect(GCS_WHITE_THEME_SETTINGS.light).toEqual(NOVA_THEME_SETTINGS.light);
    expect({ ...GCS_DARK_THEME_SETTINGS, scheme: null }).toEqual({ ...NOVA_THEME_SETTINGS, scheme: null });
    expect(themeSettingsErrors(GCS_DARK_THEME_SETTINGS)).toEqual({});
    expect(themeSettingsErrors(GCS_WHITE_THEME_SETTINGS)).toEqual({});
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
    expect(css).toContain("html.gcs-nova .gcs-crumbBar {\n  display: none;");
    // Căutarea nu dispare odată cu rândul: iconița din antet revine.
    expect(css).toContain("html.gcs-nova .gcs-siteHeader__tools .gcs-headerSearch {\n  display: flex;");
    expect(compileThemeCss(nova("bands.style", "accent"), "")).toContain("--gcs-band-shadow: inset 3px 0 0 var(--gcs-accent);");
    expect(compileThemeCss(nova("bands.icon", "rounded"), "")).toContain("--gcs-band-icon-radius: 10px;");
  });

  test("designul clasic: fără decorul GCS; butonul plin se luminează la hover, ca în orice temă", () => {
    const css = compileThemeCss(DEFAULT_THEME_SETTINGS, "");
    expect(css).toContain("--gcs-btn-primary-hover: color-mix(in srgb, var(--gcs-accent) 92%, #fff);");
    expect(css).not.toContain(".gcs-nova");
    expect(css).not.toContain("--font-gcs-nova");
  });
});

describe("temele incluse: instalare nouă și actualizare", () => {
  let w: GcsTestWorld;

  beforeEach(async () => {
    w = await createWorld([]);
    // Lumea de test are deja seed-ul: pornim de la o bază fără teme și fără marcajele temelor.
    await w.db.theme.deleteMany();
    const state = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
    await w.db.systemState.update({ where: { id: 1 }, data: { seedMarks: state.seedMarks.filter((m) => m !== NOVA_SEED_MARK && m !== GCS_DARK_SEED_MARK) } });
  });

  afterAll(async () => {
    await w.db.$disconnect();
  });

  const seed = () => w.db.$transaction((tx) => GcsThemeService.seedDefault(tx));
  const rows = () => w.db.theme.findMany({ orderBy: { key: "asc" }, select: { id: true, key: true, name: true, isDefault: true, enabled: true, settings: true } });
  const marks = async () => (await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } })).seedMarks;
  /** O instalare de dinaintea redenumirii: „GCS Nova” (implicită, cu CSS și un șablon propriu) și „Clasic”. */
  async function legacyInstall(novaKey = NOVA_THEME_KEY) {
    // Antetul „Standard” de atunci: fără luna / soarele (comutatorul perechii a venit odată cu GCS Dark / White).
    const standard = headerPreset("classic");
    for (const d of ["desktop", "tablet", "mobile"] as const) for (const r of ["top", "main", "bottom"] as const) for (const z of ["left", "center", "right"] as const) standard[d][r][z] = standard[d][r][z].filter((k) => k !== "themeToggle");
    const settings = withThemePath(withThemePath(structuredClone(NOVA_THEME_SETTINGS), "dark.accent", "#123456"), "header.layout", standard);
    const nova = await w.db.theme.create({ data: { key: novaKey, name: "GCS Nova", isDefault: true, settings: settings as never } });
    await w.db.$transaction((tx) => GcsThemeCssService.seed(tx, nova.id, ".gcs-card { outline: 1px solid red; }", { authorId: null, authorName: "" }));
    await w.db.themeTemplate.create({ data: { themeId: nova.id, key: "forum.row", source: "<div>{{ forum.title }}</div>", baseVersion: 1, baseSource: "" } });
    const classic = await w.db.theme.create({ data: { key: "default", name: "Clasic", settings: DEFAULT_THEME_SETTINGS as never } });
    await w.db.systemState.update({ where: { id: 1 }, data: { seedMarks: { push: NOVA_SEED_MARK } } });
    return { nova, classic };
  }

  test("o instalare nouă primește GCS Dark (implicită) și GCS White (activă), fără „Clasic”; seed-ul repetat nu schimbă nimic", async () => {
    await seed();
    await seed();
    const themes = await rows();
    expect(themes.map((t) => [t.key, t.name, t.isDefault, t.enabled])).toEqual([
      [GCS_DARK_THEME_KEY, "GCS Dark", true, true],
      [GCS_WHITE_THEME_KEY, "GCS White", false, true],
    ]);
    expect(normalizeThemeSettings(themes[0]!.settings)).toEqual(GCS_DARK_THEME_SETTINGS);
    expect(normalizeThemeSettings(themes[1]!.settings)).toEqual(GCS_WHITE_THEME_SETTINGS);
    expect((await marks()).filter((m) => m === GCS_DARK_SEED_MARK)).toHaveLength(1);
    // Fiecare temă are fișierul `custom.css` al editorului vizual.
    expect(await w.db.themeCssFile.count({ where: { name: "custom.css" } })).toBe(2);
  });

  test("migrarea: „GCS Nova” devine „GCS Dark” cu aceleași setări, CSS, șabloane și alegerea membrilor; GCS White se adaugă", async () => {
    const { nova, classic } = await legacyInstall();
    const ana = await w.createUser("Ana", "member");
    const ion = await w.createUser("Ion", "member");
    await w.db.$executeRaw`UPDATE users SET prefs = prefs || jsonb_build_object('skin', 'nova') WHERE id = ${ana.id}`;
    await w.db.$executeRaw`UPDATE users SET prefs = prefs || jsonb_build_object('skin', 'default') WHERE id = ${ion.id}`;
    await seed();
    await seed();

    const themes = await rows();
    expect(themes.map((t) => [t.key, t.name, t.isDefault])).toEqual([
      ["default", "Clasic", false],
      [GCS_DARK_THEME_KEY, "GCS Dark", true],
      [GCS_WHITE_THEME_KEY, "GCS White", false],
    ]);
    const dark = themes.find((t) => t.key === GCS_DARK_THEME_KEY)!;
    // Același rând (același id): fișierele CSS și șabloanele merg cu el; setările rămân, doar modul devine fix.
    expect(dark.id).toBe(nova.id);
    const s = normalizeThemeSettings(dark.settings);
    expect(s.dark.accent).toBe("#123456");
    expect(s.preset).toBe("nova");
    expect(themeSingleScheme(s)).toBe("dark");
    // Antetul „Standard” neatins primește luna / soarele.
    expect(s.header.layout).toEqual(headerPreset("classic"));
    expect(s.header.layout.desktop.main.right).toContain("themeToggle");
    expect((await w.db.themeCssFile.findFirstOrThrow({ where: { themeId: nova.id, name: "custom.css" } })).content).toContain("outline: 1px solid red");
    expect(await w.db.themeTemplate.count({ where: { themeId: nova.id, key: "forum.row" } })).toBe(1);
    // Membrii care aleseseră Nova o păstrează sub cheia nouă; ceilalți rămân la alegerea lor.
    const prefs = async (id: string) => ((await w.db.user.findUniqueOrThrow({ where: { id }, select: { prefs: true } })).prefs as Record<string, unknown>).skin;
    expect(await prefs(ana.id)).toBe(GCS_DARK_THEME_KEY);
    expect(await prefs(ion.id)).toBe("default");
    // Tema „Clasic” păstrează totul; antetul ei neatins devine aspectul „Clasic” al constructorului (același antet).
    const kept = themes.find((t) => t.key === "default")!;
    expect(kept.id).toBe(classic.id);
    expect(normalizeThemeSettings(kept.settings).header.layout).toEqual(headerPreset("basic"));
    expect((await marks()).filter((m) => m === GCS_DARK_SEED_MARK)).toHaveLength(1);
  });

  test("cookie-ul vechi (`gcs-skin=nova`) duce la GCS Dark", async () => {
    await legacyInstall();
    await seed();
    const themes = new GcsThemeService({ db: w.db, cache: w.cache, bus: w.bus, acp: w.acp });
    expect((await themes.active("nova")).key).toBe(GCS_DARK_THEME_KEY);
    expect((await themes.active("default")).key).toBe("default");
  });

  test("o instalare de dinaintea Nova: Nova se creează o dată, apoi devine GCS Dark; numele ales de admin rămâne", async () => {
    await w.db.theme.create({ data: { key: "default", name: "Tema mea", isDefault: true, settings: DEFAULT_THEME_SETTINGS as never } });
    await w.db.theme.create({ data: { key: "neon", name: "Neon", settings: withThemePath(structuredClone(DEFAULT_THEME_SETTINGS), "header.layout", headerPreset("esports")) as never } });
    await seed();
    const themes = await rows();
    expect(themes.map((t) => [t.key, t.name, t.isDefault])).toEqual([
      ["default", "Tema mea", false],
      [GCS_DARK_THEME_KEY, "GCS Dark", true],
      [GCS_WHITE_THEME_KEY, "GCS White", false],
      ["neon", "Neon", false],
    ]);
    // Un antet ales de admin (aici Esports) nu e atins de migrare.
    expect(normalizeThemeSettings(themes.find((t) => t.key === "neon")!.settings).header.layout.preset).toBe("esports");
  });

  test("o cheie `nova` a altei teme rămâne; tema inclusă (`gcs-nova`) devine GCS Dark; o cheie `gcs-white` ocupată nu se suprascrie", async () => {
    await legacyInstall("gcs-nova");
    await w.db.theme.create({ data: { key: "nova", name: "Nova veche", settings: DEFAULT_THEME_SETTINGS as never } });
    await w.db.theme.create({ data: { key: GCS_WHITE_THEME_KEY, name: "Albă proprie", settings: DEFAULT_THEME_SETTINGS as never } });
    await seed();
    const themes = await rows();
    expect(themes.map((t) => [t.key, t.name])).toEqual([
      ["default", "Clasic"],
      [GCS_DARK_THEME_KEY, "GCS Dark"],
      [GCS_WHITE_THEME_KEY, "Albă proprie"],
      ["nova", "Nova veche"],
    ]);
  });
});
