import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { themeHtmlAttrs } from "./attrs";
import { compileThemeCss } from "./css";
import {
  DEFAULT_THEME_SETTINGS,
  GCS_DARK_THEME_SETTINGS,
  GCS_WHITE_THEME_SETTINGS,
  NOVA_ONLY_FIELDS,
  NOVA_THEME_SETTINGS,
  THEME_FIELDS,
  THEME_HEADER_ARTS,
  normalizeThemeSettings,
  themeSettingsErrors,
  withThemePath,
  type GcsThemeSettings,
} from "./settings";

/**
 * Imaginea antetului (proprietarul, 2026-11-03: „Forja”): o imagine desenată pentru GCS sau una încărcată, în spatele
 * antetului, în orice temă și orice aspect. Setarea e a sistemului; designul doar alege valorile implicite.
 */
const PATHS = ["header.image", "header.art", "header.imageArea", "header.imageDim", "header.imageTint", "header.imageFade", "header.imageMobile"];
const set = (s: GcsThemeSettings, values: Record<string, unknown>) => Object.entries(values).reduce((acc, [p, v]) => withThemePath(acc, p, v), s);

describe("setările imaginii antetului", () => {
  test("câmpurile sunt ale sistemului (nu decor al designului GCS)", () => {
    for (const path of PATHS) {
      expect(THEME_FIELDS[path], path).toBeDefined();
      expect(NOVA_ONLY_FIELDS, path).not.toContain(path);
    }
  });

  test("implicit: pe tot antetul, 15% întunecare, fără nuanță, estompată, și pe telefon; Forja doar la temele incluse", () => {
    const of = (s: GcsThemeSettings) => [s.header.image, s.header.art, s.header.imageArea, s.header.imageDim, s.header.imageTint, s.header.imageFade, s.header.imageMobile];
    for (const s of [DEFAULT_THEME_SETTINGS, NOVA_THEME_SETTINGS]) expect(of(s)).toEqual([null, "none", "all", 15, 0, true, true]);
    // GCS Dark și GCS White (instalările noi) pornesc cu imaginea „Forja” (proprietarul, 2026-11-03).
    for (const s of [GCS_DARK_THEME_SETTINGS, GCS_WHITE_THEME_SETTINGS]) expect(of(s)).toEqual([null, "forja", "all", 15, 0, true, true]);
    // O temă salvată înainte de setări le primește pe cele implicite ale designului: fără imagine (o instalare existentă
    // nu se schimbă singură).
    expect(normalizeThemeSettings({ preset: "nova", header: { image: null } }).header.art).toBe("none");
  });

  test("validarea strictă", () => {
    expect(themeSettingsErrors({ header: { art: "forja", imageArea: "top", imageDim: 40, imageTint: 100, imageFade: false, imageMobile: false } })).toEqual({});
    expect(themeSettingsErrors({ header: { art: "lava", imageArea: "middle", imageDim: 85, imageTint: 12, imageFade: "da", imageMobile: 1 } })).toEqual({
      "header.art": "invalid_choice",
      "header.imageArea": "invalid_choice",
      "header.imageDim": "invalid_range",
      "header.imageTint": "invalid_range",
      "header.imageFade": "invalid_type",
      "header.imageMobile": "invalid_type",
    });
    // Valorile stricate se înlocuiesc cu cele implicite la citire.
    expect(normalizeThemeSettings({ header: { art: "lava", imageDim: 13 } }).header).toMatchObject({ art: "none", imageDim: 15 });
  });
});

describe("CSS-ul temei", () => {
  test("imaginea inclusă vine din variabila de pe <html>, cea încărcată are prioritate", () => {
    expect(compileThemeCss(DEFAULT_THEME_SETTINGS, "")).toContain("--gcs-header-image: none;");
    for (const art of THEME_HEADER_ARTS.filter((a) => a !== "none")) {
      expect(compileThemeCss(set(DEFAULT_THEME_SETTINGS, { "header.art": art }), "")).toContain(`--gcs-header-image: var(--gcs-art-${art});`);
    }
    const css = compileThemeCss(set(NOVA_THEME_SETTINGS, { "header.art": "forja", "header.image": "/files/hero01" }), "");
    expect(css).toContain('--gcs-header-image: url("/files/hero01");');
    expect(css).not.toContain("--gcs-art-forja");
  });

  test("întunecarea, nuanța și estomparea", () => {
    const plain = compileThemeCss(DEFAULT_THEME_SETTINGS, "");
    expect(plain).toContain("--gcs-header-image-dim: 15%;");
    expect(plain).toContain("--gcs-header-image-tint: 0%;");
    expect(plain).toContain("--gcs-header-image-fade: 85%;");
    const css = compileThemeCss(set(DEFAULT_THEME_SETTINGS, { "header.imageDim": 40, "header.imageTint": 35, "header.imageFade": false }), "");
    expect(css).toContain("--gcs-header-image-dim: 40%;");
    expect(css).toContain("--gcs-header-image-tint: 35%;");
    expect(css).toContain("--gcs-header-image-fade: 0%;");
  });
});

describe("atributele de pe <html>", () => {
  test("fără imagine: `off`; cu imaginea inclusă sau încărcată: zona aleasă; telefonul separat", () => {
    expect(themeHtmlAttrs(DEFAULT_THEME_SETTINGS)["data-gcs-header-image"]).toBe("off");
    expect(themeHtmlAttrs(set(DEFAULT_THEME_SETTINGS, { "header.art": "forja" }))["data-gcs-header-image"]).toBe("all");
    expect(themeHtmlAttrs(set(DEFAULT_THEME_SETTINGS, { "header.image": "/files/hero01", "header.imageArea": "top" }))["data-gcs-header-image"]).toBe("top");
    const off = themeHtmlAttrs(set(DEFAULT_THEME_SETTINGS, { "header.art": "arena", "header.imageMobile": false }));
    expect(off["data-gcs-header-image-mobile"]).toBe("off");
  });
});

describe("fișierele", () => {
  const sheet = readFileSync(new URL("../../../ui/src/header-menus.css", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../../../../apps/web/app/layout.tsx", import.meta.url), "utf8");

  test("CSS-ul de bază: tot antetul sau primul rând, telefonul doar cu acordul temei, bara compactă rămâne pe fundalul ei", () => {
    expect(sheet).toContain(':root[data-gcs-header-image="all"] .gcs-hb:not([data-compact], [data-device="mobile"])');
    expect(sheet).toContain(':root[data-gcs-header-image="all"][data-gcs-header-image-mobile="on"] .gcs-hb[data-device="mobile"]:not([data-compact])');
    expect(sheet).toContain(':root[data-gcs-header-image="top"] .gcs-hb:not([data-compact], [data-device="mobile"]) > .gcs-hb__row:first-child');
    expect(sheet).toContain("background-blend-mode: normal, normal, color, normal;");
    // Doar fundaluri: un pseudo-element poziționat ar acoperi rândurile statice ale antetului Esports.
    expect(sheet).not.toMatch(/data-gcs-header-image[^{]*::(before|after)/);
  });

  test("layout-ul rădăcină dă adresa fiecărei imagini incluse", () => {
    for (const art of THEME_HEADER_ARTS.filter((a) => a !== "none")) {
      expect(layout).toContain(`"--gcs-art-${art}"`);
      expect(layout).toContain(`./_art/header-${art}.jpg`);
    }
  });
});
