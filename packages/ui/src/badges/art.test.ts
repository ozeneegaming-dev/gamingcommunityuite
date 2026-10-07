import { describe, expect, test } from "vitest";
import { badgeArtFile, badgeArtSrc, badgeArtUrl, GCS_BADGE_SHAPES, GCS_BADGE_TIERS, isBadgeText, parseBadgeArtFile, parseBadgeIcon, resolveBadgeArt } from "./art";
import { badgePalette, capLightness } from "./palette";

describe("insignele: rezolvarea din câmpurile badge-ului", () => {
  test("forma, nivelul și iconița alese în ACP au prioritate", () => {
    expect(resolveBadgeArt({ name: "Campion", color: "#ff6b74", artShape: "rosette", artTier: "gold", artIcon: "fa-solid fa-trophy", symbol: "GG" })).toEqual({
      shape: "rosette",
      tier: "gold",
      color: "#FF6B74",
      glyph: { kind: "icon", style: "solid", name: "trophy" },
    });
  });

  test("fără grafică: medalie (automat) sau rozetă (manual), nivelul „culoarea badge-ului”, glifa din simbol", () => {
    expect(resolveBadgeArt({ name: "Activ", color: "#F4B740", symbol: "A" })).toEqual({ shape: "medal", tier: "custom", color: "#F4B740", glyph: { kind: "text", text: "A" } });
    expect(resolveBadgeArt({ name: "MVP", color: "#F4B740", symbol: "fa-solid fa-star", manual: true })).toMatchObject({ shape: "rosette", glyph: { kind: "icon", name: "star" } });
    // Simbol invalid (prea lung) → prima literă a numelui, cu majusculă.
    expect(resolveBadgeArt({ name: "ștrengar", color: "#F4B740", symbol: "ABCD" }).glyph).toEqual({ kind: "text", text: "Ș" });
  });

  test("valorile necunoscute sau ostile din baza de date nu trec mai departe", () => {
    const spec = resolveBadgeArt({ name: "<script>", color: "red;}<svg onload=x>", artShape: "circle\"/><script>", artTier: "diamond", artIcon: "fa-solid fa-x\"/><script>", symbol: "<b>" });
    expect(spec.shape).toBe("medal");
    expect(spec.tier).toBe("custom");
    expect(spec.color).toBe("#A1A7B4");
    // Simbolul „<b>” e un text valid de 3 caractere: ajunge în SVG doar escapat (vezi testele randării).
    expect(spec.glyph).toEqual({ kind: "text", text: "<b>" });
  });

  test("textul insignei: 1–3 caractere vizibile, fără caractere de control sau de direcție", () => {
    expect(isBadgeText("GG")).toBe(true);
    expect(isBadgeText("1K")).toBe(true);
    expect(isBadgeText("👨‍👩‍👧")).toBe(true);
    expect(isBadgeText("ABCD")).toBe(false);
    expect(isBadgeText("")).toBe(false);
    expect(isBadgeText(" A")).toBe(false);
    expect(isBadgeText(`A${String.fromCharCode(0x202e)}`)).toBe(false);
    expect(isBadgeText(`A${String.fromCharCode(0)}`)).toBe(false);
  });

  test("iconițele: doar `fa-{solid|regular|brands} fa-{nume}`", () => {
    expect(parseBadgeIcon("fa-brands fa-steam")).toEqual({ kind: "icon", style: "brands", name: "steam" });
    for (const bad of ["fa-solid", "fa-light fa-star", "fa-solid fa-Star", "fa-solid fa-star extra", "fa-solid fa-../x", null, 5]) expect(parseBadgeIcon(bad)).toBeNull();
  });
});

describe("insignele: adresa imaginii", () => {
  test("adresa descrie complet desenul și se citește înapoi la fel", () => {
    const specs = [
      resolveBadgeArt({ name: "x", color: "#5EA2FF", artShape: "medal", artTier: "bronze", artIcon: "fa-solid fa-pen-nib" }),
      resolveBadgeArt({ name: "x", color: "#B794FF", artShape: "star", artTier: "custom", symbol: "RP" }),
      resolveBadgeArt({ name: "x", color: "#22D3EE", symbol: "🎮" }),
    ];
    for (const spec of specs) expect(parseBadgeArtFile(badgeArtFile(spec))).toEqual(spec);
    expect(badgeArtUrl(specs[0]!)).toBe("/badge-art/v1/medal-bronze-5ea2ff-i-solid-pen-nib.svg");
    expect(badgeArtSrc({ name: "x", color: "#B794FF", artShape: "star", artTier: "custom", symbol: "RP" })).toBe("/badge-art/v1/star-custom-b794ff-t-5250.svg");
  });

  test("orice altă formă a adresei e respinsă (404)", () => {
    for (const file of [
      "medal-bronze-5EA2FF-i-solid-pen-nib.svg", // culoarea cu majuscule nu e canonică
      "circle-bronze-5ea2ff-i-solid-pen-nib.svg",
      "medal-wood-5ea2ff-i-solid-pen-nib.svg",
      "medal-bronze-5ea2f-i-solid-pen-nib.svg",
      "medal-bronze-5ea2ff-i-light-pen-nib.svg",
      "medal-bronze-5ea2ff-i-solid-pen-nib.png",
      "medal-bronze-5ea2ff-t-41424344.svg", // 4 caractere
      "medal-bronze-5ea2ff-t-ff.svg", // UTF-8 invalid
      "medal-bronze-5ea2ff-t-0a.svg", // caracter de control
      "medal-bronze-5ea2ff-t-3c.svg/../x",
      "../medal-bronze-5ea2ff-t-41.svg",
    ]) {
      expect(parseBadgeArtFile(file), file).toBeNull();
    }
    expect(parseBadgeArtFile("medal-bronze-5ea2ff-t-3c.svg")).toMatchObject({ glyph: { kind: "text", text: "<" } });
  });

  test("toate combinațiile de formă și nivel au adrese distincte", () => {
    const files = new Set<string>();
    for (const shape of GCS_BADGE_SHAPES) for (const tier of GCS_BADGE_TIERS) files.add(badgeArtFile({ shape, tier, color: "#FFFFFF", glyph: { kind: "text", text: "A" } }));
    expect(files.size).toBe(GCS_BADGE_SHAPES.length * GCS_BADGE_TIERS.length);
  });
});

describe("insignele: paleta", () => {
  test("emailul rămâne închis și pe un badge alb (glifa deschisă se citește)", () => {
    const p = badgePalette("gold", "#FFFFFF");
    for (const c of [p.fieldTop, p.fieldBottom]) {
      const l = parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16);
      expect(l / 3).toBeLessThan(0.45 * 255);
    }
    expect(capLightness("#102030", 0.5)).toBe("#102030");
  });

  test("toate culorile paletei sunt `#RRGGBB`, și pentru o culoare invalidă", () => {
    for (const tier of GCS_BADGE_TIERS) {
      for (const color of ["#5EA2FF", "#000000", "#FFFFFF", "nu-e-culoare"]) {
        for (const value of Object.values(badgePalette(tier, color))) {
          if (typeof value === "string") expect(value).toMatch(/^#[0-9A-F]{6}$/);
        }
      }
    }
  });
});
