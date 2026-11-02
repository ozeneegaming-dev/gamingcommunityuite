import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { brandMarkSvg, brandPanelCss, brandTokensCss, GCS_BRAND, type GcsBrandScheme } from "./brand";
import { contrastRatio, HOVER_WHITE, mixHex } from "./palette";
import { GCS_DARK_THEME_SETTINGS, GCS_WHITE_THEME_SETTINGS, NOVA_THEME_SETTINGS, THEME_TOKENS } from "./settings";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("brandul GCS (direcția Forja)", () => {
  const schemes: [string, GcsBrandScheme][] = [
    ["întunecat", GCS_BRAND.color.dark],
    ["luminos", GCS_BRAND.color.light],
  ];

  test.each(schemes)("modul %s: textul, accentul și stările se citesc (≥ 4.5:1) pe suprafață și pe fundal", (_name, s) => {
    for (const fg of [s.text, s.muted, s.accentInk, s.ok, s.warn, s.danger, s.info]) {
      expect(contrastRatio(fg, s.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fg, s.bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(s.secondaryText, s.secondary)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(schemes)("modul %s: butonul principal are text alb lizibil, și la hover", (_name, s) => {
    expect(contrastRatio("#FFFFFF", s.accentFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", mixHex(s.accentFill, "#FFFFFF", HOVER_WHITE))).toBeGreaterThanOrEqual(4.5);
  });

  test("avertismentul e chihlimbar, nu portocaliul mărcii", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    expect(hue(GCS_BRAND.color.dark.warn) - hue(GCS_BRAND.color.dark.accent)).toBeGreaterThan(25);
  });

  test("tema implicită (GCS Dark / GCS White) are paleta brandului", () => {
    for (const settings of [NOVA_THEME_SETTINGS, GCS_DARK_THEME_SETTINGS, GCS_WHITE_THEME_SETTINGS]) {
      for (const k of THEME_TOKENS) {
        expect(settings.dark[k]).toBe(GCS_BRAND.color.dark[k]);
        expect(settings.light[k]).toBe(GCS_BRAND.color.light[k]);
      }
      expect(settings.fontDisplay).toBe(GCS_BRAND.font.family);
      expect(settings.fontText).toBe(GCS_BRAND.font.family);
      expect(settings.buttons.radius).toBe(GCS_BRAND.radius.button);
      expect(settings.radius).toBe(GCS_BRAND.radius.card);
    }
  });

  test("fișierele generate sunt la zi (altfel: `pnpm --filter @gcs/web brand`)", () => {
    expect(read("../../../ui/src/tokens.css")).toBe(brandTokensCss());
    expect(read("../../../../docs/brand/gcs-brand.css")).toBe(brandPanelCss());
    expect(read("../../../../docs/brand/gcs-mark.svg")).toBe(`${brandMarkSvg()}\n`);
  });

  test("tokens.css: rezerva pe `:root` și cromul produsului, în ambele moduri", () => {
    const css = brandTokensCss();
    expect(css).toContain("--gcs-brand-bg: #0B0F17;");
    expect(css).toContain("--gcs-brand-accent: #DF390C;");
    expect(css).toContain("--gcs-accent: var(--gcs-brand-accent);");
    expect(css).toContain(".gcs-product {");
    expect(css).toContain('.gcs-product[data-theme="light"]');
    expect(css).toContain('.gcs-product[data-theme="auto"]');
    expect(css).toContain("--gcs-btn-primary-bg: var(--gcs-brand-accent-fill);");
    expect(css).not.toContain("<");
  });

  test("marca: SVG valid, colorată sau monocromă", () => {
    expect(brandMarkSvg()).toMatch(/^<svg [^>]*viewBox="0 0 64 64"[^>]*>.*<\/svg>$/);
    expect(brandMarkSvg()).toContain(`fill="${GCS_BRAND.color.dark.accent}"`);
    expect(brandMarkSvg({ mono: true, size: 16 })).toContain('fill="#FFFFFF"');
    expect(brandMarkSvg({ mono: true, size: 16 })).toContain('width="16"');
  });
});
