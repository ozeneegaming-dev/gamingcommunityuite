import { describe, expect, test } from "vitest";
import { GCS_BADGE_SHAPES, GCS_BADGE_TIERS, resolveBadgeArt, type GcsBadgeArtSpec } from "./art";
import { badgeArtSvg } from "./server";
import { renderBadgeArtSvg } from "./svg";

/** Un SVG bine format (parser XML strict) și fără nimic executabil sau extern. */
function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  expect(doc.documentElement.tagName).toBe("svg");
  return doc;
}

const ALLOWED_TAGS = new Set(["svg", "defs", "linearGradient", "stop", "clipPath", "filter", "feGaussianBlur", "g", "path", "ellipse", "text"]);

function assertInert(doc: Document): void {
  for (const el of Array.from(doc.getElementsByTagName("*"))) {
    expect(ALLOWED_TAGS.has(el.tagName), el.tagName).toBe(true);
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.startsWith("on"), attr.name).toBe(false);
      expect(["href", "xlink:href", "style", "src"]).not.toContain(attr.name);
      // Singurele `url(...)` sunt referințe interne la gradienți, decupaj și filtru.
      if (attr.value.includes("url(")) expect(attr.value).toMatch(/^url\(#gcs-[a-z]\)$/);
    }
  }
}

describe("insignele: desenul SVG", () => {
  test("toate formele × nivelurile, cu iconiță și cu text, sunt SVG valid și inert", () => {
    for (const shape of GCS_BADGE_SHAPES) {
      for (const tier of GCS_BADGE_TIERS) {
        for (const glyph of [{ kind: "icon", style: "solid", name: "trophy" }, { kind: "text", text: "GG" }] as const) {
          const svg = badgeArtSvg({ shape, tier, color: "#5EA2FF", glyph });
          assertInert(parse(svg));
          expect(svg).toContain('viewBox="-2 -2 104 104"');
        }
      }
    }
  });

  test("glifa: iconița din registru e desenată; una necunoscută primește iconița implicită", () => {
    const trophy = badgeArtSvg({ shape: "medal", tier: "gold", color: "#F4B740", glyph: { kind: "icon", style: "solid", name: "trophy" } });
    const unknown = badgeArtSvg({ shape: "medal", tier: "gold", color: "#F4B740", glyph: { kind: "icon", style: "solid", name: "nu-exista-deloc" } });
    expect(parse(trophy).getElementsByTagName("path").length).toBeGreaterThan(6);
    expect(unknown).not.toContain("nu-exista");
    expect(parse(unknown).getElementsByTagName("text")).toHaveLength(0);
  });

  test("textul insignei e escapat; numele și culoarea ostile din badge nu ajung în SVG", () => {
    const spec = resolveBadgeArt({ name: '"><script>alert(1)</script>', color: '#FFF" onload="x', symbol: "<b>" });
    const svg = badgeArtSvg(spec);
    const doc = parse(svg);
    assertInert(doc);
    expect(svg).not.toContain("<b>");
    expect(svg).not.toContain("script");
    expect(svg).not.toContain("onload");
    expect(Array.from(doc.getElementsByTagName("text")).map((t) => t.textContent)).toEqual(["<b>", "<b>"]);
  });

  test("o descriere construită ocolind validarea e refuzată", () => {
    const bad = (patch: Partial<Record<keyof GcsBadgeArtSpec, unknown>>) => ({ shape: "medal", tier: "gold", color: "#FFFFFF", glyph: { kind: "text", text: "A" }, ...patch }) as GcsBadgeArtSpec;
    expect(() => renderBadgeArtSvg(bad({ shape: '"/><script>' }))).toThrow();
    expect(() => renderBadgeArtSvg(bad({ tier: "wood" }))).toThrow();
    expect(() => renderBadgeArtSvg(bad({ color: 'red" onload="x' }))).toThrow();
    // Un text invalid ajuns până aici devine „?”; căile unei iconițe care nu sunt doar comenzi SVG sunt ignorate.
    expect(renderBadgeArtSvg(bad({ glyph: { kind: "text", text: "<script>" } }))).not.toContain("script");
    const forged = renderBadgeArtSvg(bad({ glyph: { kind: "icon", style: "solid", name: "x" } }), { width: 512, height: 512, paths: ['M0 0"/><script>x</script>'] });
    expect(forged).not.toContain("script");
    assertInert(parse(forged));
  });

  test("strălucirea doar la aur și platină, scânteile doar la platină", () => {
    const svg = (tier: GcsBadgeArtSpec["tier"]) => badgeArtSvg({ shape: "hexagon", tier, color: "#3DDC97", glyph: { kind: "text", text: "A" } });
    expect(svg("gold")).toContain("feGaussianBlur");
    expect(svg("platinum")).toContain("feGaussianBlur");
    expect(svg("silver")).not.toContain("feGaussianBlur");
    expect(svg("platinum").match(/fill="#FFFFFF"\/>/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
