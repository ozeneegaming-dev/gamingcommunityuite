import { describe, expect, test } from "vitest";
import { activeThemeTogglePair, DEFAULT_THEME_TOGGLE, normalizeThemeTogglePair, themeTogglePairError, themeToggleState } from "./toggle";

describe("comutatorul lună / soare: perechea de teme", () => {
  test("implicit GCS Dark ↔ GCS White, pornit", () => {
    expect(DEFAULT_THEME_TOGGLE).toEqual({ enabled: true, dark: "gcs-dark", light: "gcs-white" });
    expect(normalizeThemeTogglePair(null)).toEqual(DEFAULT_THEME_TOGGLE);
    expect(normalizeThemeTogglePair({ enabled: false, dark: "a1", light: "b2" })).toEqual({ enabled: false, dark: "a1", light: "b2" });
  });

  test("validarea: forma exactă, chei de temă valide, două teme diferite", () => {
    expect(themeTogglePairError({ enabled: true, dark: "noapte", light: "zi" })).toBeNull();
    expect(themeTogglePairError({ enabled: true, dark: "noapte", light: "noapte" })).toBe("same_theme");
    expect(themeTogglePairError({ enabled: "da", dark: "noapte", light: "zi" })).toBe("invalid_type");
    expect(themeTogglePairError({ enabled: true, dark: "Bad Key", light: "zi" })).toBe("invalid");
    expect(themeTogglePairError({ enabled: true, dark: "noapte" })).toBe("invalid");
    expect(themeTogglePairError({ enabled: true, dark: "noapte", light: "zi", extra: 1 })).toBe("invalid");
    expect(themeTogglePairError([])).toBe("invalid_type");
  });

  test("perechea apare doar completă: ambele teme există, sunt active și diferite; comutatorul pornit", () => {
    const themes = [
      { key: "gcs-dark", enabled: true },
      { key: "gcs-white", enabled: true },
      { key: "off", enabled: false },
    ];
    expect(activeThemeTogglePair(DEFAULT_THEME_TOGGLE, themes)).toEqual({ dark: "gcs-dark", light: "gcs-white" });
    expect(activeThemeTogglePair({ ...DEFAULT_THEME_TOGGLE, enabled: false }, themes)).toBeNull();
    expect(activeThemeTogglePair({ ...DEFAULT_THEME_TOGGLE, light: "off" }, themes)).toBeNull();
    expect(activeThemeTogglePair({ ...DEFAULT_THEME_TOGGLE, light: "lipsa" }, themes)).toBeNull();
    expect(activeThemeTogglePair({ ...DEFAULT_THEME_TOGGLE, light: "gcs-dark" }, themes)).toBeNull();
  });

  test("starea: pe tema întunecată soarele duce la cea luminoasă și invers; în afara perechii, după modul afișat", () => {
    const pair = { dark: "gcs-dark", light: "gcs-white" };
    expect(themeToggleState(pair, "gcs-dark", "dark")).toEqual({ side: "dark", target: "gcs-white" });
    expect(themeToggleState(pair, "gcs-white", "light")).toEqual({ side: "light", target: "gcs-dark" });
    expect(themeToggleState(pair, "clasic", "light")).toEqual({ side: "light", target: "gcs-dark" });
    expect(themeToggleState(pair, "clasic", "dark")).toEqual({ side: "dark", target: "gcs-white" });
  });
});
