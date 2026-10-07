import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { compileThemeCss } from "./css";
import {
  DEFAULT_THEME_SETTINGS,
  THEME_ELEMENT_COLORS,
  THEME_OPAQUE_ELEMENTS,
  normalizeThemeSettings,
  themeElementAllowsTransparent,
  themeElementColor,
  themeSettingsErrors,
  withThemePath,
  type GcsThemeElements,
  type GcsThemePalette,
} from "./settings";

const MIGRATION = new URL("../../../db/prisma/migrations/20261025000000_title_bands/migration.sql", import.meta.url);

/** Culoarea hex a unei valori de element, în paleta unui mod. */
const resolve = (value: string, palette: GcsThemePalette) => (value.startsWith("@") ? palette[value.slice(1) as keyof GcsThemePalette] : value);

/** Blocul unui mod din CSS-ul compilat (`dark` = `html:root`, `light` = `html[data-theme="light"]`). */
const block = (css: string, mode: "dark" | "light") => {
  const [dark, rest] = css.split('html[data-theme="light"]');
  return mode === "dark" ? dark! : rest!.split("@media")[0]!;
};

describe("banda titlurilor: fundalul implicit al antetului casetelor", () => {
  test("implicit `@surface2`, în ambele moduri, diferit de pagină și de conținutul casetei", () => {
    for (const mode of ["dark", "light"] as const) {
      const elements: GcsThemeElements = DEFAULT_THEME_SETTINGS.elements[mode];
      const palette = DEFAULT_THEME_SETTINGS[mode];
      expect(elements.boxHeaderBg).toBe("@surface2");
      const band = resolve(elements.boxHeaderBg, palette)!.toUpperCase();
      expect(band).not.toBe(resolve(elements.boxBg, palette)!.toUpperCase());
      expect(band).not.toBe(resolve(elements.bodyBg, palette)!.toUpperCase());
    }
  });

  test("CSS-ul compilat dă benzii tokenul paletei în ambele moduri", () => {
    const css = compileThemeCss(DEFAULT_THEME_SETTINGS, "");
    expect(block(css, "dark")).toContain("--gcs-box-header-bg: var(--gcs-surface2);");
    expect(block(css, "light")).toContain("--gcs-box-header-bg: var(--gcs-surface2);");
    expect(css).not.toContain("--gcs-box-header-bg: transparent;");
  });

  test("o culoare aleasă de admin ajunge în CSS doar în modul ei", () => {
    const css = compileThemeCss(withThemePath(structuredClone(DEFAULT_THEME_SETTINGS), "elements.light.boxHeaderBg", "#E1E4EA"), "");
    expect(block(css, "dark")).toContain("--gcs-box-header-bg: var(--gcs-surface2);");
    expect(block(css, "light")).toContain("--gcs-box-header-bg: #E1E4EA;");
  });
});

describe("banda titlurilor: elementele opace", () => {
  test("doar antetul casetelor e opac; celelalte elemente pot fi în continuare transparente", () => {
    expect(THEME_OPAQUE_ELEMENTS).toEqual(["boxHeaderBg"]);
    expect(themeElementAllowsTransparent("boxHeaderBg")).toBe(false);
    for (const key of THEME_ELEMENT_COLORS.filter((k) => k !== "boxHeaderBg")) expect(themeElementAllowsTransparent(key), key).toBe(true);
  });

  test("`transparent` sau gol devine fundalul implicit doar la elementele opace", () => {
    expect(themeElementColor("boxHeaderBg", "transparent")).toBe("@surface2");
    expect(themeElementColor("boxHeaderBg", "")).toBe("@surface2");
    expect(themeElementColor("boxHeaderBg", "  ")).toBe("@surface2");
    expect(themeElementColor("boxHeaderBg", "#202430")).toBe("#202430");
    expect(themeElementColor("boxHeaderBg", "@accent")).toBe("@accent");
    expect(themeElementColor("footerBg", "transparent")).toBe("transparent");
  });

  test("normalizarea: o temă salvată cu antetul transparent primește banda implicită, restul rămâne", () => {
    const s = normalizeThemeSettings({
      elements: {
        dark: { boxHeaderBg: "transparent", footerBg: "transparent", headerBg: "@accent" },
        light: { boxHeaderBg: "transparent", boxHeaderText: "@muted" },
      },
    });
    expect(s.elements.dark.boxHeaderBg).toBe("@surface2");
    expect(s.elements.light.boxHeaderBg).toBe("@surface2");
    expect(s.elements.dark.footerBg).toBe("transparent");
    expect(s.elements.dark.headerBg).toBe("@accent");
    expect(s.elements.light.boxHeaderText).toBe("@muted");
  });

  test("normalizarea păstrează o culoare de bandă aleasă și repară una goală sau stricată", () => {
    const s = normalizeThemeSettings({ elements: { dark: { boxHeaderBg: "#20242E" }, light: { boxHeaderBg: "" } } });
    expect(s.elements.dark.boxHeaderBg).toBe("#20242E");
    expect(s.elements.light.boxHeaderBg).toBe("@surface2");
  });

  test("validarea acceptă în continuare `transparent` (importuri, clienți vechi); valoarea se normalizează la citire", () => {
    expect(themeSettingsErrors({ elements: { dark: { boxHeaderBg: "transparent" }, light: { boxHeaderBg: "@surface" } } })).toEqual({});
    expect(themeSettingsErrors({ elements: { dark: { boxHeaderBg: "none" } } })).toEqual({ "elements.dark.boxHeaderBg": "invalid_color" });
  });

  test("CSS-ul compilat nu scoate antetul transparent nici din setări nenormalizate (previzualizarea editorului)", () => {
    const raw = withThemePath(structuredClone(DEFAULT_THEME_SETTINGS), "elements.dark.boxHeaderBg", "transparent");
    const css = compileThemeCss(raw, "");
    expect(block(css, "dark")).toContain("--gcs-box-header-bg: var(--gcs-surface2);");
    expect(css).not.toContain("--gcs-box-header-bg: transparent;");
  });
});

describe("banda titlurilor: migrarea temelor existente", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  test("înlocuiește exact `transparent` cu valoarea implicită din cod, în setări și în draft, pe ambele moduri", () => {
    const expected = DEFAULT_THEME_SETTINGS.elements.dark.boxHeaderBg;
    expect(DEFAULT_THEME_SETTINGS.elements.light.boxHeaderBg).toBe(expected);
    const updates = [...sql.matchAll(/UPDATE "themes" SET "(settings|draft)" = jsonb_set\("\1", '\{elements,(dark|light),boxHeaderBg\}', '"([^"]+)"'\)\s+WHERE "\1" #>> '\{elements,\2,boxHeaderBg\}' = 'transparent';/g)];
    expect(updates.map((m) => `${m[1]}.${m[2]}`).sort()).toEqual(["draft.dark", "draft.light", "settings.dark", "settings.light"]);
    for (const m of updates) expect(m[3]).toBe(expected);
  });

  test("temele publicate schimbate primesc o versiune nouă (CSS-ul temei nu rămâne în cache)", () => {
    expect(sql).toMatch(/UPDATE "themes" SET "version" = "version" \+ 1[^;]*WHERE "settings" #>> '\{elements,dark,boxHeaderBg\}' = 'transparent' OR "settings" #>> '\{elements,light,boxHeaderBg\}' = 'transparent';/);
    // Versiunea crește înainte ca setările să fie schimbate (altfel condiția n-ar mai găsi nimic).
    expect(sql.indexOf('"version" = "version" + 1')).toBeLessThan(sql.indexOf('SET "settings" = jsonb_set'));
  });
});
