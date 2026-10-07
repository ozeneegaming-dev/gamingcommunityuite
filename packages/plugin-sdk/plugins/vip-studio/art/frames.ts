/**
 * Ramele de avatar implicite ale Studioului VIP: desene originale (SVG generat aici), randate în PNG transparent de
 * 256×256 la construirea pluginului. Avatarul ocupă cercul central (raza ≈ 98 px la scara implicită 130 %), deci
 * desenul stă între raza 96 și marginea pânzei.
 */
const C = 128;
const R = 104;

const svg = (body: string, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs>${defs}</defs>${body}</svg>`;

/** Un element repetat în jurul cercului (`count` copii, rotite). */
function around(count: number, make: (i: number) => string, offset = 0): string {
  return Array.from({ length: count }, (_, i) => `<g transform="translate(${C} ${C}) rotate(${offset + (360 / count) * i})">${make(i)}</g>`).join("");
}

const glow = (id: string, blur: number) => `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${blur}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
const ring = (r: number, stroke: string, width: number, extra = "") => `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;

/** Un punct pe cerc (unghiul în grade, 0 = sus). */
function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}
const f = (n: number) => Math.round(n * 100) / 100;

function ember(): string {
  const defs =
    `<linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD166"/><stop offset=".5" stop-color="#FF6B35"/><stop offset="1" stop-color="#C1121F"/></linearGradient>` +
    `<radialGradient id="fl" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#FFF3B0"/><stop offset=".45" stop-color="#FF9F1C"/><stop offset="1" stop-color="#E63946" stop-opacity=".2"/></radialGradient>` +
    glow("g", 3);
  const tongue = (i: number) => {
    const h = i % 2 === 0 ? 24 : 15;
    const w = i % 2 === 0 ? 8 : 6;
    return `<path d="M ${-w} 0 Q ${-w + 1} ${-h * 0.45} 0 ${-h} Q ${w - 1} ${-h * 0.45} ${w} 0 Z" transform="translate(0 ${-R + 2})" fill="url(#fl)"/>`;
  };
  return svg(`<g filter="url(#g)">${around(18, tongue, 5)}${ring(R, "url(#r)", 7)}</g>${ring(R - 4, "#FFE29A", 1.2, 'opacity=".7"')}`, defs);
}

function frost(): string {
  const defs = `<linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E0F7FF"/><stop offset="1" stop-color="#5BC0EB"/></linearGradient>` + glow("g", 2.5);
  const spike = (i: number) => {
    const h = i % 3 === 0 ? 26 : i % 3 === 1 ? 16 : 11;
    return `<path d="M -5 0 L 0 ${-h} L 5 0 L 0 4 Z" transform="translate(0 ${-R})" fill="#EAFBFF" stroke="#7FD3F2" stroke-width="1"/><path d="M 0 0 L 0 ${-h + 3}" transform="translate(0 ${-R})" stroke="#FFFFFF" stroke-width=".8" opacity=".8"/>`;
  };
  return svg(`<g filter="url(#g)">${ring(R, "url(#r)", 6)}${around(24, spike)}</g>${ring(R + 4, "#BDEBFF", 1, 'opacity=".6"')}`, defs);
}

function circuit(): string {
  const defs = glow("g", 2);
  const traces: string[] = [];
  const angles = [10, 34, 61, 95, 128, 150, 187, 214, 243, 275, 302, 331];
  angles.forEach((deg, i) => {
    const [x1, y1] = polar(R + 3, deg);
    const len = i % 2 === 0 ? 14 : 9;
    const [x2, y2] = polar(R + 3 + len, deg);
    const [x3, y3] = polar(R + 3 + len, deg + (i % 3 === 0 ? 9 : -7));
    traces.push(`<polyline points="${f(x1)},${f(y1)} ${f(x2)},${f(y2)} ${f(x3)},${f(y3)}" fill="none" stroke="#22D3EE" stroke-width="2" stroke-linejoin="round"/>`);
    traces.push(`<circle cx="${f(x3)}" cy="${f(y3)}" r="3" fill="#0B1220" stroke="#67E8F9" stroke-width="1.6"/>`);
  });
  return svg(`${ring(R, "#0B1220", 10)}<g filter="url(#g)">${ring(R - 3, "#22D3EE", 1.6)}${ring(R + 3, "#0EA5E9", 1.6)}${traces.join("")}</g>`, defs);
}

function laurel(): string {
  const defs = `<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF1B8"/><stop offset=".45" stop-color="#F4B740"/><stop offset="1" stop-color="#9A6212"/></linearGradient>` + glow("g", 1.5);
  const leaves: string[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const deg = 180 + side * (22 + i * 16);
      const [x, y] = polar(R + 6, deg);
      const rot = deg + side * 35;
      leaves.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="5" ry="12" transform="rotate(${f(rot)} ${f(x)} ${f(y)})" fill="url(#gold)" stroke="#7A4B0C" stroke-width=".8"/>`);
    }
  }
  const ribbon = `<path d="M 112 228 L 128 216 L 144 228 L 140 242 L 128 234 L 116 242 Z" fill="#C1121F" stroke="#7A0A12" stroke-width="1.2"/>`;
  return svg(`<g filter="url(#g)">${ring(R - 1, "url(#gold)", 4)}${leaves.join("")}${ribbon}</g>`, defs);
}

function crown(): string {
  const defs = `<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF4C2"/><stop offset=".55" stop-color="#F2B033"/><stop offset="1" stop-color="#8F5A0B"/></linearGradient>` + glow("g", 2);
  const gems = [45, 135, 225, 315].map((d) => {
    const [x, y] = polar(R, d);
    return `<circle cx="${f(x)}" cy="${f(y)}" r="5.5" fill="#E63946" stroke="#FFE7A3" stroke-width="1.5"/>`;
  });
  const crownShape = `<path d="M 92 30 L 100 6 L 114 22 L 128 2 L 142 22 L 156 6 L 164 30 Q 128 22 92 30 Z" fill="url(#gold)" stroke="#7A4B0C" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<circle cx="128" cy="6" r="3.5" fill="#7BDFF2"/><circle cx="100" cy="9" r="2.6" fill="#7BDFF2"/><circle cx="156" cy="9" r="2.6" fill="#7BDFF2"/>`;
  return svg(`<g filter="url(#g)">${ring(R, "url(#gold)", 7)}${ring(R + 5, "#FFE7A3", 1)}${gems.join("")}${crownShape}</g>`, defs);
}

function hex(): string {
  const defs = glow("g", 3.2);
  const pts = (r: number) => Array.from({ length: 6 }, (_, i) => polar(r, i * 60).map(f).join(",")).join(" ");
  return svg(
    `<g filter="url(#g)"><polygon points="${pts(124)}" fill="none" stroke="#D946EF" stroke-width="4" stroke-linejoin="round"/><polygon points="${pts(116)}" fill="none" stroke="#8B5CF6" stroke-width="1.6" stroke-linejoin="round"/>${ring(R - 3, "#F0ABFC", 2)}</g>`,
    defs,
  );
}

function reticle(): string {
  const defs = glow("g", 1.6);
  const bracket = (i: number) => `<path d="M -14 ${-R - 14} L -14 ${-R - 20} L 14 ${-R - 20} L 14 ${-R - 14}" fill="none" stroke="#FF3B4E" stroke-width="3" stroke-linecap="round"/><path d="M 0 ${-R - 6} L 0 ${-R - 22}" stroke="#FF3B4E" stroke-width="${i % 2 === 0 ? 2.4 : 2}" stroke-linecap="round"/>`;
  const ticks = around(36, (i) => (i % 9 === 0 ? "" : `<line x1="0" y1="${-R + 1}" x2="0" y2="${-R - (i % 3 === 0 ? 7 : 4)}" stroke="#FFB4BA" stroke-width="1.2"/>`));
  return svg(`<g filter="url(#g)">${ring(R, "#FF3B4E", 2.6)}${ticks}${around(4, bracket)}</g>`, defs);
}

function thorns(): string {
  const defs = `<linearGradient id="d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5C0A14"/><stop offset="1" stop-color="#1A0306"/></linearGradient>` + glow("g", 1.8);
  const thorn = (i: number) => {
    const h = [16, 9, 22, 12, 7, 18][i % 6]!;
    const lean = i % 2 === 0 ? 4 : -4;
    return `<path d="M -5 2 Q ${lean} ${-h * 0.4} ${lean * 1.5} ${-h} Q ${lean * 0.3} ${-h * 0.35} 5 2 Z" transform="translate(0 ${-R - 2})" fill="url(#d)" stroke="#B3122B" stroke-width="1"/>`;
  };
  return svg(`<g filter="url(#g)">${ring(R, "url(#d)", 9)}${ring(R, "#B3122B", 1.4)}${around(22, thorn, 3)}</g>`, defs);
}

function wings(): string {
  const defs = `<linearGradient id="w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#AEB8C8"/></linearGradient>` + glow("g", 1.4);
  const feathers = (side: 1 | -1) =>
    Array.from({ length: 6 }, (_, i) => {
      const y = 92 + i * 15;
      const len = 30 - Math.abs(i - 2) * 4;
      const x = side === 1 ? 228 : 28;
      return `<ellipse cx="${x - side * 2}" cy="${y}" rx="${len / 2}" ry="5.2" transform="rotate(${side * (-28 + i * 10)} ${x} ${y})" fill="url(#w)" stroke="#8090A8" stroke-width=".9"/>`;
    }).join("");
  return svg(`<g filter="url(#g)">${feathers(-1)}${feathers(1)}${ring(R, "#E8EDF5", 5)}${ring(R + 4, "#9AA6BA", 1.2)}</g>`, defs);
}

function twinNeon(): string {
  const defs = glow("g", 3.5);
  return svg(
    `<g filter="url(#g)">${ring(R - 1, "#FF4FD8", 3.4)}${ring(R + 9, "#22D3EE", 3.4)}</g>` +
      around(4, () => `<circle cx="0" cy="${-R - 4}" r="3" fill="#FFFFFF"/>`, 45),
    defs,
  );
}

function pixel(): string {
  const colors = ["#3DDC97", "#22D3EE", "#A78BFA", "#F472B6", "#FACC15"];
  const cells: string[] = [];
  for (let gx = 0; gx < 32; gx++) {
    for (let gy = 0; gy < 32; gy++) {
      const x = gx * 8 + 4;
      const y = gy * 8 + 4;
      const d = Math.hypot(x - C, y - C);
      if (d > R - 2 && d < R + 12) {
        const ang = Math.atan2(y - C, x - C);
        const c = colors[Math.floor(((ang + Math.PI) / (2 * Math.PI)) * colors.length) % colors.length]!;
        cells.push(`<rect x="${gx * 8}" y="${gy * 8}" width="8" height="8" fill="${c}" stroke="#0B0C10" stroke-width="1"/>`);
      }
    }
  }
  return svg(cells.join(""));
}

function galaxy(): string {
  const defs =
    `<linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C3AED"/><stop offset=".5" stop-color="#2563EB"/><stop offset="1" stop-color="#DB2777"/></linearGradient>` +
    glow("g", 2.4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const stars = Array.from({ length: 34 }, () => {
    const [x, y] = polar(R + 2 + rnd() * 20, rnd() * 360);
    const s = 0.8 + rnd() * 2.2;
    return s > 2.4
      ? `<path d="M ${f(x)} ${f(y - s * 2)} L ${f(x + s * 0.5)} ${f(y - s * 0.5)} L ${f(x + s * 2)} ${f(y)} L ${f(x + s * 0.5)} ${f(y + s * 0.5)} L ${f(x)} ${f(y + s * 2)} L ${f(x - s * 0.5)} ${f(y + s * 0.5)} L ${f(x - s * 2)} ${f(y)} L ${f(x - s * 0.5)} ${f(y - s * 0.5)} Z" fill="#FFFFFF"/>`
      : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s / 2)}" fill="#E0E7FF"/>`;
  });
  return svg(`<g filter="url(#g)">${ring(R, "url(#r)", 8)}${ring(R + 7, "#A5B4FC", 1, 'opacity=".55"')}</g>${stars.join("")}`, defs);
}

function runic(): string {
  const defs = glow("g", 1.6);
  const glyph = (i: number) => {
    const shapes = ["M -3 -6 L 3 -6 M 0 -6 L 0 6", "M -3 6 L 0 -6 L 3 6", "M -3 -6 L 3 0 L -3 6", "M -3 -6 L -3 6 M -3 0 L 3 -4", "M 0 -6 L 0 6 M -3 -2 L 3 2"];
    return `<path d="${shapes[i % shapes.length]}" transform="translate(0 ${-R - 9})" fill="none" stroke="#5EEAD4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  return svg(`<g filter="url(#g)">${ring(R, "#134E4A", 12)}${ring(R - 6, "#D4A017", 1.6)}${ring(R + 6, "#D4A017", 1.6)}${around(16, glyph)}</g>`, defs);
}

function plasma(): string {
  const defs = glow("g", 3);
  const wave = (amp: number, freq: number, phase: number) => {
    const pts: string[] = [];
    for (let d = 0; d <= 360; d += 3) {
      const r = R + 6 + amp * Math.sin(((d * freq + phase) * Math.PI) / 180);
      const [x, y] = polar(r, d);
      pts.push(`${f(x)},${f(y)}`);
    }
    return pts.join(" ");
  };
  return svg(
    `<g filter="url(#g)"><polyline points="${wave(6, 9, 0)}" fill="none" stroke="#F0F" stroke-width="2.6" stroke-linejoin="round"/><polyline points="${wave(5, 7, 90)}" fill="none" stroke="#22D3EE" stroke-width="2.2" stroke-linejoin="round"/>${ring(R - 2, "#C4B5FD", 2)}</g>`,
    defs,
  );
}

function camo(): string {
  const defs =
    `<clipPath id="c"><path d="M 128 ${C - R - 13} A ${R + 13} ${R + 13} 0 1 1 127.99 ${C - R - 13} Z M 128 ${C - R + 3} A ${R - 3} ${R - 3} 0 1 0 128.01 ${C - R + 3} Z" fill-rule="evenodd"/></clipPath>`;
  let seed = 3;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const blobs = Array.from({ length: 70 }, () => {
    const c = ["#4B5320", "#6B7B3A", "#2F3A1C", "#A68A5B"][Math.floor(rnd() * 4)];
    const x = f(rnd() * 256);
    const y = f(rnd() * 256);
    return `<ellipse cx="${x}" cy="${y}" rx="${f(6 + rnd() * 12)}" ry="${f(4 + rnd() * 8)}" transform="rotate(${f(rnd() * 180)} ${x} ${y})" fill="${c}"/>`;
  });
  return svg(`<g clip-path="url(#c)"><rect width="256" height="256" fill="#556B2F"/>${blobs.join("")}</g>${ring(R + 13, "#1F2612", 2)}${ring(R - 3, "#1F2612", 2)}`, defs);
}

function toxic(): string {
  const defs = glow("g", 2.4);
  const drips = [150, 168, 186, 200, 214].map((deg, i) => {
    const [x, y] = polar(R + 3, deg);
    const h = [16, 26, 12, 22, 10][i]!;
    return `<path d="M ${f(x - 4)} ${f(y)} L ${f(x - 3)} ${f(y + h)} A 4 4 0 0 0 ${f(x + 3)} ${f(y + h)} L ${f(x + 4)} ${f(y)} Z" fill="#84CC16"/>`;
  });
  return svg(`<g filter="url(#g)">${ring(R, "#4D7C0F", 9)}${ring(R, "#A3E635", 3.5)}${drips.join("")}</g>`, defs);
}

export type GcsFrameArt = { key: string; render: () => string };

/** Desenele ramelor, după cheie (cheile și numele sunt în `src/presets.ts`). */
export const FRAME_ART: GcsFrameArt[] = [
  { key: "ember", render: ember },
  { key: "frost", render: frost },
  { key: "circuit", render: circuit },
  { key: "laurel", render: laurel },
  { key: "crown", render: crown },
  { key: "hex", render: hex },
  { key: "reticle", render: reticle },
  { key: "thorns", render: thorns },
  { key: "wings", render: wings },
  { key: "twin_neon", render: twinNeon },
  { key: "pixel", render: pixel },
  { key: "galaxy", render: galaxy },
  { key: "runic", render: runic },
  { key: "plasma", render: plasma },
  { key: "camo", render: camo },
  { key: "toxic", render: toxic },
];
