import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsConflict, GcsForbidden, GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { compileThemeCss, sanitizeThemeCss } from "./css";
import { GcsThemeService } from "./service";
import {
  DEFAULT_THEME_SETTINGS,
  THEME_FIELDS,
  mergeThemeObjects,
  normalizeThemeSettings,
  themeFieldError,
  themePath,
  themeSettingsErrors,
  withThemePath,
  type GcsThemeSettings,
} from "./settings";

/** Setările implicite cu o valoare schimbată la o cale. */
const withSetting = (path: string, value: unknown): GcsThemeSettings => withThemePath(structuredClone(DEFAULT_THEME_SETTINGS), path, value);

let w: GcsTestWorld;
let themes: GcsThemeService;
let root: GcsActor;
let member: GcsActor;

beforeEach(async () => {
  w = await createWorld([]);
  themes = new GcsThemeService({ db: w.db, cache: w.cache, bus: w.bus, acp: w.acp });
  await w.db.$transaction((tx) => GcsThemeService.seedDefault(tx));
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
  member = await w.actorFor(await w.createUser("Ana", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
});

describe("sanitizeThemeCss", () => {
  test("scoate HTML-ul, vectorii de execuție, @import străin și url-urile externe nesigure", () => {
    const out = sanitizeThemeCss(
      [
        "</style><script>alert(1)</script>",
        "@charset 'utf-8';",
        "@import url('https://evil.example/x.css');",
        '@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");',
        ".a { width: expression(alert(1)); background: url(javascript:alert(1)); }",
        ".b { -moz-binding: url(x.xml#xss); behavior: url(x.htc); }",
        ".c { background: url(http://insecure.example/a.png); }",
        ".d { background: url('/files/abc123'); } .e { background: url(https://cdn.example/a.png); }",
      ].join("\n"),
    );
    expect(out).not.toContain("<");
    expect(out).not.toMatch(/expression\s*\(/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/-moz-binding/i);
    expect(out).not.toMatch(/behavior\s*:/i);
    expect(out).not.toContain("@charset");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("fonts.googleapis.com");
    expect(out).not.toContain("insecure.example");
    expect(out).toContain("url('/files/abc123')");
    expect(out).toContain("url(https://cdn.example/a.png)");
  });

  test("CSS-ul compilat are paletele dark/light, modul auto și fontul ales", () => {
    const css = compileThemeCss({ ...DEFAULT_THEME_SETTINGS, fontText: "Inter", radius: 6 }, ".x{color:red}");
    expect(css).toContain("html:root {");
    expect(css).toContain('html[data-theme="light"]');
    expect(css).toContain('html[data-theme="auto"]');
    expect(css).toContain("family=Inter");
    expect(css).not.toContain("family=Manrope");
    expect(css).toContain("--gcs-radius: 6px;");
    expect(css).toContain(".x{color:red}");
  });

  test("setările stricate revin la valorile implicite", () => {
    const s = normalizeThemeSettings({ dark: { bg: "red", accent: "#112233" }, fontText: "Comic Sans", radius: 99 });
    expect(s.dark.bg).toBe(DEFAULT_THEME_SETTINGS.dark.bg);
    expect(s.dark.accent).toBe("#112233");
    expect(s.fontText).toBe(DEFAULT_THEME_SETTINGS.fontText);
    expect(s.radius).toBe(DEFAULT_THEME_SETTINGS.radius);
  });
});

describe("setările editorului vizual", () => {
  test("fiecare valoare implicită e validă pentru câmpul ei", () => {
    const bad = Object.entries(THEME_FIELDS)
      .map(([path, field]) => [path, themeFieldError(field, themePath(DEFAULT_THEME_SETTINGS, path))] as const)
      .filter(([, err]) => err !== null);
    expect(bad).toEqual([]);
  });

  test("o temă veche (doar paleta, fonturile, raza, lățimea) primește valorile implicite noi", () => {
    const legacy = { dark: { accent: "#112233" }, light: {}, fontDisplay: "Inter", fontText: "Manrope", radius: 8, width: 1400 };
    const s = normalizeThemeSettings(legacy);
    expect(s.dark.accent).toBe("#112233");
    expect(s.fontDisplay).toBe("Inter");
    expect(s.radius).toBe(8);
    expect(s.header).toEqual(DEFAULT_THEME_SETTINGS.header);
    expect(s.elements.light).toEqual(DEFAULT_THEME_SETTINGS.elements.light);
    expect(s.logo.imageLight).toBeNull();
  });

  test("valorile imbricate stricate revin la implicit, cele valide rămân", () => {
    const s = normalizeThemeSettings({
      header: { height: 500, sticky: false },
      elements: { dark: { headerBg: "@accent", footerBg: "url(x)" } },
      layout: { forumIndex: "masonry", topicView: "compact" },
      logo: { imageLight: "https://evil.example/a.png", text: "GCS" },
    });
    expect(s.header.height).toBe(DEFAULT_THEME_SETTINGS.header.height);
    expect(s.header.sticky).toBe(false);
    expect(s.elements.dark.headerBg).toBe("@accent");
    expect(s.elements.dark.footerBg).toBe(DEFAULT_THEME_SETTINGS.elements.dark.footerBg);
    expect(s.layout.forumIndex).toBe("list");
    expect(s.layout.topicView).toBe("compact");
    expect(s.logo.imageLight).toBeNull();
    expect(s.logo.text).toBe("GCS");
  });

  test("validarea strictă: intervale, pași, enumerări, culori, tokenuri, fișiere, texte, chei necunoscute", () => {
    expect(
      themeSettingsErrors({
        header: { height: 20, navIcons: "da" },
        width: 1005,
        typography: { contentSize: 103, fontTextCustom: "Open Sans" },
        sidebar: { position: "middle" },
        elements: { dark: { headerBg: "@nope", footerBg: "transparent", boxBg: "#12345" }, light: { link: "@accentInk" } },
        dark: { accent: "@accent" },
        logo: { imageMobile: "/files/abc_123", imageLight: "/etc/passwd", slogan: "x".repeat(81) },
        foo: { bar: 1 },
      }),
    ).toEqual({
      "header.height": "invalid_range",
      "header.navIcons": "invalid_type",
      width: "invalid_range",
      "typography.contentSize": "invalid_range",
      "sidebar.position": "invalid_choice",
      "elements.dark.headerBg": "invalid_color",
      "elements.dark.boxBg": "invalid_color",
      "dark.accent": "invalid_color",
      "logo.imageLight": "invalid",
      "logo.slogan": "too_long",
      "foo.bar": "unknown_setting",
    });
    expect(themeSettingsErrors({ typography: { fontDisplayCustom: 'Inter"; } body{' } })).toEqual({ "typography.fontDisplayCustom": "invalid" });
    expect(themeSettingsErrors({ logo: { text: "a\u0000b" } })).toEqual({ "logo.text": "invalid" });
  });

  test("îmbinarea în adâncime păstrează celelalte valori ale grupului", () => {
    const merged = mergeThemeObjects({ header: { height: 70, sticky: true }, dark: { bg: "#000000" } }, { header: { sticky: false }, logo: { imageLight: null } });
    expect(merged).toEqual({ header: { height: 70, sticky: false }, dark: { bg: "#000000" }, logo: { imageLight: null } });
  });
});

describe("compileThemeCss (setările noi)", () => {
  test("valorile implicite reproduc aspectul actual: variabile cu tokenuri, fără reguli condiționale", () => {
    const css = compileThemeCss(DEFAULT_THEME_SETTINGS, "");
    expect(css).toContain("--gcs-header-bg: var(--gcs-chrome);");
    expect(css).toContain("--gcs-drawer-text: var(--gcs-accentInk);");
    expect(css).toContain("--gcs-box-header-bg: transparent;");
    expect(css).toContain("--gcs-btn-primary-text: #FFFFFF;");
    expect(css).toContain("--gcs-btn-primary-hover: #E23446;");
    expect(css).toContain("--gcs-header-h: 64px;");
    expect(css).toContain("--gcs-logo-max-h: 42px;");
    expect(css).toContain("--gcs-base-size: 1rem;");
    expect(css).toContain("--gcs-content-scale: 1;");
    expect(css).toContain("--gcs-avatar-radius: 50%;");
    expect(css).toContain("--gcs-btn-radius: 10px;");
    for (const marker of [".gcs-forumIndex", ".gcs-siteFooter__scheme", ".gcs-forumLayout", "data-post-number", ".gcs-drawer__panel", "position: sticky", "box-shadow: var("]) {
      expect(css).not.toContain(marker);
    }
  });

  test("culorile de element sunt pe mod: hex-ul luminos apare doar în blocul luminos", () => {
    const s = withSetting("elements.light.headerBg", "#ABCDEF");
    const css = compileThemeCss(s, "");
    const [dark, rest] = css.split('html[data-theme="light"]');
    expect(dark).toContain("--gcs-header-bg: var(--gcs-chrome);");
    expect(rest).toContain("--gcs-header-bg: #ABCDEF;");
    expect(compileThemeCss(withSetting("elements.dark.btnPrimaryBg", "#00AA55"), "")).toContain("--gcs-btn-primary-hover: color-mix(in srgb, #00AA55 86%, #fff);");
  });

  test("dimensiunile, fonturile personalizate și regulile condiționale", () => {
    let s = withSetting("header.height", 80);
    s = withThemePath(s, "logo.height", 50);
    s = withThemePath(s, "typography.fontTextCustom", "Open Sans");
    s = withThemePath(s, "typography.contentSize", 120);
    s = withThemePath(s, "layout.forumIndex", "grid");
    s = withThemePath(s, "layout.featureFirstPost", true);
    s = withThemePath(s, "sidebar.position", "left");
    s = withThemePath(s, "sidebar.sticky", true);
    s = withThemePath(s, "scheme.toggle", false);
    s = withThemePath(s, "mobileNav.side", "right");
    s = withThemePath(s, "avatars.rounded", false);
    const css = compileThemeCss(s, "");
    expect(css).toContain("--gcs-header-h: 80px;");
    expect(css).toContain("--gcs-logo-max-h: 40px;");
    expect(css).toContain("--gcs-content-scale: 1.2;");
    expect(css).toContain("family=Open+Sans");
    expect(css).toContain('--gcs-font-text: "Open Sans", system-ui, sans-serif;');
    expect(css).toContain("html:root .gcs-forumIndex .gcs-category {");
    expect(css).toContain('.gcs-post[data-post-number="1"]');
    expect(css).toContain("flex-direction: row-reverse;");
    expect(css).toContain("top: calc(var(--gcs-header-h) + 16px);");
    expect(css).toContain(".gcs-siteFooter__scheme {\n  display: none;");
    expect(css).toContain("animation-name: gcs-drawer-in-right;");
    expect(css).toContain("--gcs-avatar-radius: 18%;");
    expect(compileThemeCss(withSetting("boxes.shadow", "soft"), "")).toContain("box-shadow: var(--gcs-box-shadow);");
  });
});

describe("GcsThemeService", () => {
  test("draft-ul se îmbină în adâncime; setările noi ajung în CSS și la publicare", async () => {
    await themes.saveDraft(root, "default", { header: { height: 80 } });
    await themes.saveDraft(root, "default", { header: { sticky: false }, elements: { dark: { headerBg: "#202020" } } });
    const t = await themes.active();
    expect(t.draft).toMatchObject({ header: { height: 80, sticky: false } });
    const draftCss = themes.css(t, { draft: true });
    expect(draftCss).toContain("--gcs-header-h: 80px;");
    expect(draftCss).toContain("--gcs-header-bg: #202020;");
    expect(themes.css(t)).toContain("--gcs-header-h: 64px;");

    const published = await themes.publish(root, "default");
    expect(published.settings.header).toEqual({ ...DEFAULT_THEME_SETTINGS.header, height: 80, sticky: false });
    expect(published.settings.elements.dark.headerBg).toBe("#202020");
    expect(published.settings.elements.light.headerBg).toBe(DEFAULT_THEME_SETTINGS.elements.light.headerBg);
  });

  test("setările imbricate invalide sunt refuzate pe căi", async () => {
    const err = await themes
      .saveDraft(root, "default", { header: { height: 999 }, elements: { dark: { headerBg: "red" } }, logo: { imageLight: "x" } } as never)
      .catch((e) => e);
    expect(err).toBeInstanceOf(GcsValidationError);
    expect((err as GcsValidationError).fields).toEqual({ "header.height": "invalid_range", "elements.dark.headerBg": "invalid_color", "logo.imageLight": "invalid" });
  });

  test("renunțarea la draft e trecută în jurnal (doar când există un draft)", async () => {
    await themes.discardDraft(root, "default");
    expect(await w.db.auditLog.count({ where: { action: "theme.discard" } })).toBe(0);
    await themes.saveDraft(root, "default", { buttons: { radius: 4 } });
    await themes.discardDraft(root, "default");
    expect(await w.db.auditLog.count({ where: { action: "theme.discard" } })).toBe(1);
    expect((await themes.active()).draft).toBeNull();
  });

  test("refuză culorile, fonturile și fișierele invalide", async () => {
    const err = await themes.saveDraft(root, "default", { dark: { bg: "red" }, fontDisplay: "Papyrus", logoUrl: "https://x.example/a.png" }).catch((e) => e);
    expect(err).toBeInstanceOf(GcsValidationError);
    expect((err as GcsValidationError).fields).toMatchObject({ "dark.bg": "invalid_color", fontDisplay: "invalid_choice", logoUrl: "invalid" });
  });

  test("un membru nu poate edita teme", async () => {
    await expect(themes.saveDraft(member, "default", { radius: 4 })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("draft-ul nu schimbă CSS-ul public; publicarea îl aplică și crește versiunea", async () => {
    await themes.saveDraft(root, "default", { dark: { accent: "#123456" }, customCss: ".z{color:blue}</style>" });
    const before = await themes.active();
    expect(before.version).toBe(1);
    expect(themes.css(before)).not.toContain("#123456");
    expect(themes.css(before, { draft: true })).toContain("#123456");
    expect(themes.css(before, { draft: true })).not.toContain("</style>");

    const published = await themes.publish(root, "default");
    expect(published.version).toBe(2);
    expect(published.draft).toBeNull();
    expect(themes.css(await themes.active())).toContain("--gcs-accent: #123456;");
    expect(await w.db.auditLog.count({ where: { action: "theme.publish" } })).toBe(1);

    await expect(themes.publish(root, "default")).rejects.toBeInstanceOf(GcsConflict);
  });

  test("renunțarea la draft păstrează tema publicată", async () => {
    await themes.saveDraft(root, "default", { radius: 2 });
    await themes.discardDraft(root, "default");
    const t = await themes.active();
    expect(t.draft).toBeNull();
    expect(t.settings.radius).toBe(DEFAULT_THEME_SETTINGS.radius);
  });

  test("membrul alege doar dintre temele active; tema implicită nu poate fi dezactivată sau ștearsă", async () => {
    await themes.create(root, { key: "neon", name: "Neon", from: "default" });
    expect((await themes.active("neon")).key).toBe("neon");
    await themes.update(root, "neon", { enabled: false });
    expect((await themes.active("neon")).key).toBe("default");
    expect((await themes.active("nu-exista")).key).toBe("default");

    await expect(themes.update(root, "default", { enabled: false })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(themes.remove(root, "default")).rejects.toBeInstanceOf(GcsValidationError);

    await themes.update(root, "neon", { isDefault: true });
    expect((await themes.active()).key).toBe("neon");
    await themes.remove(root, "default");
    expect((await themes.list()).map((t) => t.key)).toEqual(["neon"]);
  });

  test("cheile invalide sau duplicate sunt refuzate", async () => {
    await expect(themes.create(root, { key: "Bad Key", name: "X" })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(themes.create(root, { key: "default", name: "X" })).rejects.toBeInstanceOf(GcsValidationError);
  });
});
