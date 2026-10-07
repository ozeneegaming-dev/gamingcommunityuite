import { GCS_BADGE_SHAPES, GCS_BADGE_TIERS, isBadgeColor, isBadgeText, type GcsBadgeArtSpec, type GcsBadgeShape } from "./art";
import { badgePalette, type GcsBadgePalette } from "./palette";

/**
 * Desenul unei insigne ca SVG (specul `2026-10-07-insigne-grafice.md`, §2): strălucire, decor (panglică / cozi),
 * rama de metal, șanțul, emailul, filetul, luciul, glifa cu umbră și scânteia. Totul e compus din formele de aici,
 * culori `#RRGGBB` calculate de paletă, numere și glifa (căile unei iconițe Font Awesome sau un text escapat):
 * fără `script`, `style`, `href`, atribute `on*` sau referințe externe.
 */

/** Căile unei iconițe (din registrul Font Awesome, pe server). */
export type GcsBadgeIconShape = { width: number; height: number; paths: string[] };

type Pt = readonly [number, number];
type Seg = { c: "M" | "L"; p: Pt } | { c: "C"; a: Pt; b: Pt; p: Pt } | { c: "A"; r: number; large: 0 | 1; sweep: 0 | 1; p: Pt } | { c: "Z" };

const n = (v: number) => String(Math.round(v * 100) / 100);

function scalePt([x, y]: Pt, s: number, [ox, oy]: Pt): Pt {
  return [ox + (x - ox) * s, oy + (y - oy) * s];
}

function pathD(segs: Seg[], s = 1, o: Pt = [50, 50]): string {
  return segs
    .map((g) => {
      if (g.c === "Z") return "Z";
      const p = scalePt(g.p, s, o);
      if (g.c === "C") {
        const a = scalePt(g.a, s, o);
        const b = scalePt(g.b, s, o);
        return `C${n(a[0])} ${n(a[1])} ${n(b[0])} ${n(b[1])} ${n(p[0])} ${n(p[1])}`;
      }
      if (g.c === "A") return `A${n(g.r * s)} ${n(g.r * s)} 0 ${g.large} ${g.sweep} ${n(p[0])} ${n(p[1])}`;
      return `${g.c}${n(p[0])} ${n(p[1])}`;
    })
    .join("");
}

const circle = (cx: number, cy: number, r: number): Seg[] => [
  { c: "M", p: [cx - r, cy] },
  { c: "A", r, large: 1, sweep: 0, p: [cx + r, cy] },
  { c: "A", r, large: 1, sweep: 0, p: [cx - r, cy] },
  { c: "Z" },
];

const polygon = (pts: Pt[]): Seg[] => [...pts.map((p, i): Seg => ({ c: i === 0 ? "M" : "L", p })), { c: "Z" }];

/** Puncte pe un cerc, de la vârf, în sensul acelor de ceasornic; `radius(i)` dă raza fiecărui punct. */
function ring(cx: number, cy: number, count: number, radius: (i: number) => number): Pt[] {
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return [cx + radius(i) * Math.cos(a), cy + radius(i) * Math.sin(a)] as const;
  });
}

/** Discul rozetei: 16 lobi (arce mici spre exterior între puncte vecine). */
function lobes(cx: number, cy: number, r: number, count: number, lobe: number): Seg[] {
  const pts = ring(cx, cy, count, () => r);
  return [{ c: "M", p: pts[0]! }, ...pts.map((_, i): Seg => ({ c: "A", r: lobe, large: 0, sweep: 1, p: pts[(i + 1) % count]! })), { c: "Z" }];
}

type ShapeDef = {
  outer: Seg[];
  /** Centrul formei: originea micșorărilor și centrul glifei. */
  center: Pt;
  /** Câmpul de email: o geometrie proprie sau rama micșorată cu `fieldScale`. */
  field?: Seg[];
  fieldScale: number;
  /** „Raza” câmpului (pentru luciu). */
  fieldR: number;
  /** Latura casetei glifei (unități din 100). */
  glyph: number;
  sparkle: Pt;
  back?: (p: GcsBadgePalette) => string;
  front?: (p: GcsBadgePalette, field: (s: number) => string) => string;
};

/** Silueta pietrei (forma `diamond`). */
const GEM: Pt[] = [
  [27, 7],
  [73, 7],
  [97, 34],
  [50, 96],
  [3, 34],
];

const ribbonStroke = (p: GcsBadgePalette) => `stroke="${p.edge}" stroke-width="1.5" stroke-linejoin="round"`;

const SHAPES: Record<GcsBadgeShape, ShapeDef> = {
  // Moneda atârnată de o panglică în V (dunga din mijloc e din metalul nivelului).
  medal: {
    outer: circle(50, 60, 37.5),
    center: [50, 60],
    fieldScale: 0.78,
    fieldR: 29,
    glyph: 36,
    sparkle: [78, 35],
    back: (p) =>
      `<path d="M21 0L41 0L59 40L39 40Z" fill="url(#gcs-r)" ${ribbonStroke(p)}/>` +
      `<path d="M28.5 0L33.5 0L51.5 40L46.5 40Z" fill="${p.light}"/>` +
      `<path d="M21 0L41 0L59 40L39 40Z" fill="${p.edge}" opacity=".28"/>` +
      `<path d="M59 0L79 0L61 40L41 40Z" fill="url(#gcs-r)" ${ribbonStroke(p)}/>` +
      `<path d="M66.5 0L71.5 0L53.5 40L48.5 40Z" fill="${p.light}"/>`,
  },
  shield: {
    outer: [
      { c: "M", p: [50, 3] },
      { c: "C", a: [61, 9], b: [75, 12.5], p: [89, 12.5] },
      { c: "L", p: [89, 46] },
      { c: "C", a: [89, 70], b: [72, 86.5], p: [50, 97] },
      { c: "C", a: [28, 86.5], b: [11, 70], p: [11, 46] },
      { c: "L", p: [11, 12.5] },
      { c: "C", a: [25, 12.5], b: [39, 9], p: [50, 3] },
      { c: "Z" },
    ],
    center: [50, 49],
    fieldScale: 0.76,
    fieldR: 30,
    glyph: 38,
    sparkle: [80, 19],
  },
  hexagon: {
    outer: polygon(ring(50, 50, 6, () => 47)),
    center: [50, 50],
    fieldScale: 0.76,
    fieldR: 33,
    glyph: 38,
    sparkle: [81, 28],
  },
  // Disc cu lobi și două cozi de panglică crestate în V.
  rosette: {
    outer: lobes(50, 44, 36, 16, 8),
    center: [50, 44],
    field: circle(50, 44, 27),
    fieldScale: 1,
    fieldR: 27,
    glyph: 32,
    sparkle: [78, 17],
    back: (p) =>
      `<path d="M37 64L53 71L44.5 98L37.5 90.5L28.5 95Z" fill="url(#gcs-r)" ${ribbonStroke(p)}/>` +
      `<path d="M37 64L53 71L44.5 98L37.5 90.5L28.5 95Z" fill="${p.edge}" opacity=".28"/>` +
      `<path d="M63 64L47 71L55.5 98L62.5 90.5L71.5 95Z" fill="url(#gcs-r)" ${ribbonStroke(p)}/>`,
  },
  // Piatra șlefuită: masa plată sus, brâul, apoi vârful; fațetele leagă colțurile câmpului de cele ale ramei.
  diamond: {
    outer: polygon(GEM),
    center: [50, 42],
    fieldScale: 0.7,
    fieldR: 30,
    glyph: 33,
    sparkle: [80, 16],
    front: (p) =>
      `<path d="${GEM.map((pt) => {
        const q = scalePt(pt, 0.7, [50, 42]);
        return `M${n(pt[0])} ${n(pt[1])}L${n(q[0])} ${n(q[1])}`;
      }).join("")}" stroke="${p.hi}" stroke-width="1.4" opacity=".6" fill="none"/>`,
  },
  // Stea cu 8 raze (pecete); câmpul e un cerc.
  star: {
    outer: polygon(ring(50, 50, 16, (i) => (i % 2 === 0 ? 48 : 39.5))),
    center: [50, 50],
    field: circle(50, 50, 30.5),
    fieldScale: 1,
    fieldR: 30.5,
    glyph: 35,
    sparkle: [79, 22],
  },
};

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);

/** O cale SVG conține doar comenzi și numere (căile iconițelor sunt verificate înainte de a intra în desen). */
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\se+-]*$/;

const TEXT_SIZE = [0, 44, 34, 25];
const FONT = "Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif";

function glyphMarkup(spec: GcsBadgeArtSpec, def: ShapeDef, p: GcsBadgePalette, icon: GcsBadgeIconShape | null): string {
  const [cx, cy] = def.center;
  const drop = 2.2;
  if (spec.glyph.kind === "icon" && icon && icon.width > 0 && icon.height > 0 && icon.paths.every((d) => PATH_RE.test(d))) {
    const k = def.glyph / Math.max(icon.width, icon.height);
    const x = cx - (icon.width * k) / 2;
    const y = cy - (icon.height * k) / 2;
    const scale = String(Math.round(k * 10000) / 10000);
    const paths = icon.paths.map((d) => `<path d="${d}"/>`).join("");
    return (
      `<g transform="translate(${n(x)} ${n(y + drop)}) scale(${scale})" fill="${p.glyphShadow}" opacity=".55">${paths}</g>` +
      `<g transform="translate(${n(x)} ${n(y)}) scale(${scale})" fill="url(#gcs-g)">${paths}</g>`
    );
  }
  const text = spec.glyph.kind === "text" && isBadgeText(spec.glyph.text) ? spec.glyph.text : "?";
  const count = Math.min(3, Math.max(1, [...new Intl.Segmenter().segment(text)].length));
  const size = (TEXT_SIZE[count]! * def.glyph) / 38;
  const attrs = `x="${n(cx)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-weight="800" font-size="${n(size)}"`;
  return (
    `<text ${attrs} y="${n(cy + drop)}" fill="${p.glyphShadow}" opacity=".55">${escapeXml(text)}</text>` +
    `<text ${attrs} y="${n(cy)}" fill="url(#gcs-g)">${escapeXml(text)}</text>`
  );
}

const sparkle = ([x, y]: Pt, r: number) =>
  `<path d="M${n(x)} ${n(y - r)}Q${n(x + r * 0.14)} ${n(y - r * 0.14)} ${n(x + r)} ${n(y)}Q${n(x + r * 0.14)} ${n(y + r * 0.14)} ${n(x)} ${n(y + r)}Q${n(x - r * 0.14)} ${n(y + r * 0.14)} ${n(x - r)} ${n(y)}Q${n(x - r * 0.14)} ${n(y - r * 0.14)} ${n(x)} ${n(y - r)}Z" fill="#FFFFFF"/>`;

/**
 * SVG-ul unei insigne. `icon` = căile iconiței din `spec.glyph` (rezolvată pe server din registru); fără ea, o
 * iconiță se desenează ca „?”. Forma și nivelul sunt verificate din nou aici: o valoare necunoscută aruncă eroare.
 */
export function renderBadgeArtSvg(spec: GcsBadgeArtSpec, icon: GcsBadgeIconShape | null = null): string {
  if (!(GCS_BADGE_SHAPES as readonly string[]).includes(spec.shape) || !(GCS_BADGE_TIERS as readonly string[]).includes(spec.tier) || !isBadgeColor(spec.color)) {
    throw new Error("badge art: invalid spec");
  }
  const def = SHAPES[spec.shape];
  const p = badgePalette(spec.tier, spec.color);
  const o = def.center;
  const outer = pathD(def.outer);
  const field = (s: number) => (def.field ? pathD(def.field, s, o) : pathD(def.outer, def.fieldScale * s, o));
  const [cx, cy] = o;
  const r = def.fieldR;
  const band = spec.tier === "platinum" ? p.band : p.light;

  const defs =
    `<defs>` +
    `<linearGradient id="gcs-m" gradientUnits="userSpaceOnUse" x1="14" y1="4" x2="86" y2="96">` +
    `<stop offset="0" stop-color="${p.hi}"/><stop offset=".2" stop-color="${p.light}"/><stop offset=".45" stop-color="${p.base}"/>` +
    `<stop offset=".6" stop-color="${p.shade}"/><stop offset=".74" stop-color="${band}"/><stop offset=".87" stop-color="${p.base}"/><stop offset="1" stop-color="${p.shade}"/>` +
    `</linearGradient>` +
    `<linearGradient id="gcs-e" gradientUnits="userSpaceOnUse" x1="0" y1="${n(cy - r)}" x2="0" y2="${n(cy + r)}">` +
    `<stop offset="0" stop-color="${p.fieldTop}"/><stop offset="1" stop-color="${p.fieldBottom}"/>` +
    `</linearGradient>` +
    `<linearGradient id="gcs-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.glyphTop}"/><stop offset="1" stop-color="${p.glyphBottom}"/></linearGradient>` +
    `<linearGradient id="gcs-r" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="80" y2="0">` +
    `<stop offset="0" stop-color="${p.ribbonLight}"/><stop offset=".5" stop-color="${p.ribbonBase}"/><stop offset="1" stop-color="${p.ribbonDark}"/>` +
    `</linearGradient>` +
    `<clipPath id="gcs-c"><path d="${field(1)}"/></clipPath>` +
    (p.glow ? `<filter id="gcs-b" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="2.2"/></filter>` : "") +
    `</defs>`;

  const body = [
    p.glow ? `<path d="${outer}" fill="${p.glow}" opacity=".55" filter="url(#gcs-b)"/>` : "",
    def.back?.(p) ?? "",
    `<path d="${outer}" fill="url(#gcs-m)" stroke="${p.edge}" stroke-width="2.5" stroke-linejoin="round"/>`,
    `<path d="${def.field ? pathD(def.outer, 0.95, o) : pathD(def.outer, 0.955, o)}" fill="none" stroke="${p.hi}" stroke-width="1.2" stroke-linejoin="round" opacity=".55"/>`,
    `<path d="${field(1.07)}" fill="${p.edge}" opacity=".6"/>`,
    `<path d="${field(1)}" fill="url(#gcs-e)"/>`,
    `<ellipse cx="${n(cx - 4)}" cy="${n(cy - r * 0.5)}" rx="${n(r * 0.95)}" ry="${n(r * 0.55)}" fill="#FFFFFF" opacity=".14" clip-path="url(#gcs-c)"/>`,
    `<path d="${field(1)}" fill="none" stroke="${p.hi}" stroke-width="1.2" stroke-linejoin="round" opacity=".7"/>`,
    def.front?.(p, field) ?? "",
    glyphMarkup(spec, def, p, icon),
    p.sparkle ? sparkle(def.sparkle, 7) + sparkle([def.sparkle[0] + 8, def.sparkle[1] + 11], 3.5) : "",
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 104 104" width="104" height="104">${defs}${body}</svg>`;
}
