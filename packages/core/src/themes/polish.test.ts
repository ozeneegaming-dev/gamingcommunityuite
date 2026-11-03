import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { compileThemeCss } from "./css";
import { contrastRatio, derivePalette, mixHex, readableFill } from "./palette";
import { THEME_HTML_ATTRS, themeHtmlAttrs } from "./attrs";
import {
  DEFAULT_THEME_SETTINGS,
  GCS_DARK_THEME_SETTINGS,
  GCS_WHITE_THEME_SETTINGS,
  NOVA_ONLY_FIELDS,
  NOVA_THEME_SETTINGS,
  THEME_FIELDS,
  THEME_LOADERS,
  normalizeThemeSettings,
  themeSettingsErrors,
  withThemePath,
} from "./settings";

/**
 * Pachetul de finisare (nova-polish): aspectul listelor, statisticile forumurilor la hover, stilul loader-ului, banda
 * de derulare și bara de derulare, lățimea completă, fragmentul din lista topicurilor. Toate sunt setări ale SISTEMULUI
 * (orice temă); designul GCS doar alege valorile implicite.
 */
describe("setările pachetului de finisare", () => {
  test("câmpurile noi există, sunt ale sistemului și se validează strict", () => {
    for (const path of ["lists.layout", "lists.stats", "loader.style", "scroll.rail", "scroll.bar", "layout.fullWidth", "layout.topicSnippet"]) {
      expect(THEME_FIELDS[path], path).toBeDefined();
      expect(NOVA_ONLY_FIELDS, path).not.toContain(path);
    }
    expect(themeSettingsErrors({ lists: { layout: "cards", stats: "hover" }, loader: { style: "bars" }, scroll: { rail: false, bar: true }, layout: { fullWidth: true, topicSnippet: true } })).toEqual({});
    expect(themeSettingsErrors({ lists: { layout: "grid", stats: "sometimes" }, loader: { style: "gif" }, scroll: { rail: "yes" }, layout: { fullWidth: 1 } })).toEqual({
      "lists.layout": "invalid_choice",
      "lists.stats": "invalid_choice",
      "loader.style": "invalid_choice",
      "scroll.rail": "invalid_type",
      "layout.fullWidth": "invalid_type",
    });
  });

  test("între 15 și 20 de loadere, chei unice, fiecare cu stilul lui în loaders.css (inelul e cel implicit)", () => {
    expect(THEME_LOADERS.length).toBeGreaterThanOrEqual(15);
    expect(THEME_LOADERS.length).toBeLessThanOrEqual(20);
    expect(new Set(THEME_LOADERS).size).toBe(THEME_LOADERS.length);
    const sheet = readFileSync(new URL("../../../ui/src/loaders.css", import.meta.url), "utf8");
    expect(THEME_LOADERS[0]).toBe("ring");
    for (const k of THEME_LOADERS.slice(1)) expect(sheet, k).toContain(`[data-gcs-loader="${k}"]`);
  });

  test("designul GCS livrează cardurile separate cu contoarele la hover; Clasic rămâne lista continuă cu ele vizibile", () => {
    expect(NOVA_THEME_SETTINGS.lists).toEqual({ layout: "cards", stats: "hover" });
    expect(GCS_DARK_THEME_SETTINGS.lists.layout).toBe("cards");
    expect(GCS_WHITE_THEME_SETTINGS.lists.layout).toBe("cards");
    expect(DEFAULT_THEME_SETTINGS.lists).toEqual({ layout: "list", stats: "visible" });
    expect(DEFAULT_THEME_SETTINGS.scroll).toEqual({ rail: true, bar: true });
    expect(DEFAULT_THEME_SETTINGS.layout.fullWidth).toBe(false);
    expect(DEFAULT_THEME_SETTINGS.layout.topicSnippet).toBe(false);
  });

  test("o temă GCS veche (salvată fără setările noi) primește valorile designului; una clasică pe cele clasice", () => {
    expect(normalizeThemeSettings({ preset: "nova" }).lists.layout).toBe("cards");
    expect(normalizeThemeSettings({}).lists.layout).toBe("list");
    expect(normalizeThemeSettings({ preset: "classic", lists: { layout: "cards" } }).lists.layout).toBe("cards");
  });
});

describe("atributele de pe <html>", () => {
  test("fiecare setare a sistemului devine un atribut (aceleași nume pentru server, sincronizare și previzualizare)", () => {
    const s = withThemePath(withThemePath(withThemePath(DEFAULT_THEME_SETTINGS, "lists.stats", "hover"), "scroll.rail", false), "layout.topicSnippet", true);
    expect(themeHtmlAttrs(s)).toEqual({
      "data-gcs-lists": "list",
      "data-gcs-stats": "hover",
      "data-gcs-loader": DEFAULT_THEME_SETTINGS.loader.style,
      "data-gcs-rail": "off",
      "data-gcs-scrollbar": "on",
      "data-gcs-snippet": "on",
      "data-gcs-header-image": "off",
      "data-gcs-header-image-mobile": "on",
    });
    expect(Object.keys(themeHtmlAttrs(NOVA_THEME_SETTINGS)).sort()).toEqual([...THEME_HTML_ATTRS].sort());
  });
});

describe("culorile: contrastul și generatorul de paletă", () => {
  test("contrastul WCAG", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#DF390C", "#FFFFFF")).toBeCloseTo(4.44, 1);
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });

  test("butonul principal: nuanța accentului ajunge la ≥ 4.5:1 cu textul alb, și în starea de hover", () => {
    const fill = readableFill("#DF390C", "#FFFFFF");
    expect(fill).not.toBe("#DF390C");
    expect(contrastRatio(fill, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mixHex(fill, "#FFFFFF", 0.08), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    // Un accent deja închis rămâne la fel.
    expect(readableFill("#7A1020", "#FFFFFF")).toBe("#7A1020");
  });

  test("CSS-ul compilat: accentul mărcii rămâne, doar fundalul butonului principal primește nuanța lizibilă", () => {
    const css = compileThemeCss(NOVA_THEME_SETTINGS, "");
    expect(css).toContain("--gcs-accent: #DF390C;");
    const fill = /--gcs-btn-primary-bg: (#[0-9A-F]{6});/.exec(css)?.[1];
    expect(fill).toBeDefined();
    expect(contrastRatio(fill!, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain(`--gcs-accent-fill: ${fill};`);
  });

  test("generatorul de paletă (fundal + accent → suprafețe, chenar, text estompat), lizibil în ambele moduri", () => {
    for (const [mode, bg] of [["dark", "#0B0F17"], ["light", "#F1F3F7"]] as const) {
      const p = derivePalette(bg, "#DF390C", mode);
      expect(p.bg).toBe(bg);
      expect(p.accent).toBe("#DF390C");
      for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
      expect(contrastRatio(p.text, p.surface)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.muted, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.accentInk, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(p.surface).not.toBe(p.bg);
      expect(p.border).not.toBe(p.surface);
    }
  });
});

describe("CSS-ul compilat al setărilor noi", () => {
  test("lățimea completă: pagina nu mai are lățime maximă", () => {
    expect(compileThemeCss(DEFAULT_THEME_SETTINGS, "")).toContain(`--gcs-page-width: ${DEFAULT_THEME_SETTINGS.width}px;`);
    expect(compileThemeCss(withThemePath(DEFAULT_THEME_SETTINGS, "layout.fullWidth", true), "")).toContain("--gcs-page-width: 100%;");
  });
});
