/**
 * Fundalurile de card și de profil ale Studioului VIP: scene abstracte originale (SVG generat aici), randate în WebP la
 * construirea pluginului, la mărimea cerută (cardul 720×400, profilul 1600×900, miniaturile 480×270).
 */
type Scene = (w: number, h: number) => string;

const f = (n: number) => Math.round(n * 10) / 10;

/** Generator pseudo-aleator determinist (aceeași imagine la fiecare construire). */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

const wrap = (w: number, h: number, defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;

const stars = (w: number, h: number, count: number, seed: number, maxY = 1) => {
  const r = rng(seed);
  return Array.from({ length: count }, () => `<circle cx="${f(r() * w)}" cy="${f(r() * h * maxY)}" r="${f(0.4 + r() * 1.4)}" fill="#FFFFFF" opacity="${f(0.3 + r() * 0.7)}"/>`).join("");
};

const synthwave: Scene = (w, h) => {
  const horizon = h * 0.58;
  const lines: string[] = [];
  for (let i = -16; i <= 16; i++) lines.push(`<line x1="${f(w / 2 + i * (w / 30))}" y1="${f(horizon)}" x2="${f(w / 2 + i * (w / 5))}" y2="${h}" stroke="#FF3CAC" stroke-width="${f(w / 700)}" opacity=".7"/>`);
  for (let j = 1; j <= 10; j++) {
    const y = horizon + (h - horizon) * Math.pow(j / 10, 1.8);
    lines.push(`<line x1="0" y1="${f(y)}" x2="${w}" y2="${f(y)}" stroke="#FF3CAC" stroke-width="${f(w / 700)}" opacity="${f(0.3 + j * 0.06)}"/>`);
  }
  const sunR = h * 0.24;
  const bands = Array.from({ length: 6 }, (_, i) => `<rect x="0" y="${f(horizon - sunR * 0.55 + i * sunR * 0.12)}" width="${w}" height="${f(sunR * 0.035 + i * 1.5)}" fill="#2B0A3D"/>`).join("");
  return wrap(
    w,
    h,
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140226"/><stop offset=".55" stop-color="#5B1270"/><stop offset=".58" stop-color="#2B0A3D"/><stop offset="1" stop-color="#0D0217"/></linearGradient>` +
      `<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE66D"/><stop offset="1" stop-color="#FF3CAC"/></linearGradient>` +
      `<clipPath id="above"><rect width="${w}" height="${f(horizon)}"/></clipPath>`,
    `<rect width="${w}" height="${h}" fill="url(#sky)"/>${stars(w, h, 70, 11, 0.5)}<g clip-path="url(#above)"><circle cx="${w / 2}" cy="${f(horizon)}" r="${f(sunR)}" fill="url(#sun)"/>${bands}</g>${lines.join("")}`,
  );
};

const nebula: Scene = (w, h) => {
  const r = rng(23);
  const blobs = [
    ["#7C3AED", 0.3, 0.4, 0.45],
    ["#DB2777", 0.65, 0.55, 0.38],
    ["#2563EB", 0.5, 0.25, 0.35],
    ["#06B6D4", 0.82, 0.3, 0.22],
  ]
    .map(([c, x, y, s]) => `<circle cx="${f((x as number) * w)}" cy="${f((y as number) * h)}" r="${f((s as number) * w * 0.55)}" fill="${c}" opacity=".55" filter="url(#b)"/>`)
    .join("");
  const dust = Array.from({ length: 6 }, () => `<ellipse cx="${f(r() * w)}" cy="${f(r() * h)}" rx="${f(w * (0.1 + r() * 0.2))}" ry="${f(h * 0.05)}" fill="#F0ABFC" opacity=".12" filter="url(#b)" transform="rotate(${f(r() * 60 - 30)} ${w / 2} ${h / 2})"/>`).join("");
  return wrap(w, h, `<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(w / 18)}"/></filter>`, `<rect width="${w}" height="${h}" fill="#070512"/>${blobs}${dust}${stars(w, h, 160, 5)}`);
};

const carbon: Scene = (w, h) =>
  wrap(
    w,
    h,
    `<pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#15171C"/><rect width="8" height="8" fill="#22252D"/><rect x="8" y="8" width="8" height="8" fill="#22252D"/><path d="M0 8 L8 0 M8 16 L16 8" stroke="#2E323C" stroke-width="1.2"/></pattern>` +
      `<radialGradient id="v" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></radialGradient>` +
      `<linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset=".35" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity=".12"/><stop offset=".65" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>`,
    `<rect width="${w}" height="${h}" fill="url(#p)"/><rect width="${w}" height="${h}" fill="url(#s)"/><rect width="${w}" height="${h}" fill="url(#v)"/><rect y="${f(h * 0.82)}" width="${w}" height="${f(h * 0.012)}" fill="#D62839"/>`,
  );

const topo: Scene = (w, h) => {
  const r = rng(41);
  const rings: string[] = [];
  for (const [cx, cy] of [
    [0.25, 0.4],
    [0.75, 0.65],
  ]) {
    for (let k = 1; k <= 14; k++) {
      const pts: string[] = [];
      for (let d = 0; d < 360; d += 10) {
        const a = (d * Math.PI) / 180;
        const rad = k * w * 0.028 * (1 + 0.18 * Math.sin(a * 3 + k) + 0.06 * r());
        pts.push(`${f(cx! * w + rad * Math.cos(a))},${f(cy! * h + rad * Math.sin(a) * 0.8)}`);
      }
      rings.push(`<polygon points="${pts.join(" ")}" fill="none" stroke="#2DD4BF" stroke-width="${f(w / 600)}" opacity="${f(0.15 + (k % 4 === 0 ? 0.45 : 0.15))}"/>`);
    }
  }
  return wrap(w, h, `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#062A2A"/><stop offset="1" stop-color="#0B1320"/></linearGradient>`, `<rect width="${w}" height="${h}" fill="url(#g)"/>${rings.join("")}`);
};

const circuitBoard: Scene = (w, h) => {
  const r = rng(77);
  const step = w / 24;
  const traces: string[] = [];
  for (let i = 0; i < 46; i++) {
    let x = Math.floor(r() * 24) * step;
    let y = Math.floor(r() * 14) * step;
    const pts = [`${f(x)},${f(y)}`];
    for (let s = 0; s < 4; s++) {
      if (r() > 0.5) x += step * (1 + Math.floor(r() * 3));
      else y += step * (1 + Math.floor(r() * 2));
      pts.push(`${f(x)},${f(y)}`);
    }
    traces.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#22D3EE" stroke-width="${f(w / 480)}" opacity=".55"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(w / 200)}" fill="#0B1220" stroke="#67E8F9" stroke-width="${f(w / 600)}"/>`);
  }
  return wrap(w, h, `<radialGradient id="g" cx=".5" cy=".5" r=".75"><stop offset="0" stop-color="#0C2340"/><stop offset="1" stop-color="#050A14"/></radialGradient>`, `<rect width="${w}" height="${h}" fill="url(#g)"/>${traces.join("")}`);
};

const dunes: Scene = (w, h) =>
  wrap(
    w,
    h,
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2D1B4E"/><stop offset=".5" stop-color="#F25C54"/><stop offset="1" stop-color="#F7B267"/></linearGradient>`,
    `<rect width="${w}" height="${h}" fill="url(#sky)"/><circle cx="${f(w * 0.7)}" cy="${f(h * 0.48)}" r="${f(h * 0.12)}" fill="#FFE8A3" opacity=".9"/>` +
      `<path d="M0 ${f(h * 0.62)} Q ${f(w * 0.3)} ${f(h * 0.5)} ${f(w * 0.6)} ${f(h * 0.66)} T ${w} ${f(h * 0.6)} L ${w} ${h} L 0 ${h} Z" fill="#B5446E"/>` +
      `<path d="M0 ${f(h * 0.75)} Q ${f(w * 0.35)} ${f(h * 0.64)} ${f(w * 0.7)} ${f(h * 0.8)} T ${w} ${f(h * 0.74)} L ${w} ${h} L 0 ${h} Z" fill="#6B2D5C"/>` +
      `<path d="M0 ${f(h * 0.88)} Q ${f(w * 0.4)} ${f(h * 0.78)} ${w} ${f(h * 0.9)} L ${w} ${h} L 0 ${h} Z" fill="#2D1B3D"/>`,
  );

const storm: Scene = (w, h) => {
  const r = rng(9);
  const clouds = Array.from({ length: 14 }, () => `<ellipse cx="${f(r() * w)}" cy="${f(r() * h * 0.45)}" rx="${f(w * (0.12 + r() * 0.15))}" ry="${f(h * (0.06 + r() * 0.08))}" fill="#1E293B" opacity=".9" filter="url(#b)"/>`).join("");
  const bolt = `<path d="M ${f(w * 0.58)} ${f(h * 0.2)} L ${f(w * 0.52)} ${f(h * 0.5)} L ${f(w * 0.57)} ${f(h * 0.5)} L ${f(w * 0.5)} ${f(h * 0.85)} L ${f(w * 0.63)} ${f(h * 0.42)} L ${f(w * 0.57)} ${f(h * 0.42)} Z" fill="#E0F2FE" filter="url(#gl)"/>`;
  return wrap(
    w,
    h,
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0F172A"/><stop offset="1" stop-color="#1E3A5F"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="${f(w / 60)}"/></filter><filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(w / 160)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>${clouds}<rect width="${w}" height="${h}" fill="#7DD3FC" opacity=".05"/>${bolt}`,
  );
};

const hexes: Scene = (w, h) => {
  const s = w / 22;
  const cells: string[] = [];
  const r = rng(13);
  for (let row = -1; row < h / (s * 1.5) + 1; row++) {
    for (let col = -1; col < w / (s * 1.732) + 1; col++) {
      const cx = col * s * 1.732 + (row % 2 ? s * 0.866 : 0);
      const cy = row * s * 1.5;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        return `${f(cx + s * 0.92 * Math.cos(a))},${f(cy + s * 0.92 * Math.sin(a))}`;
      }).join(" ");
      const lit = r() > 0.84;
      cells.push(`<polygon points="${pts}" fill="${lit ? "#8B5CF6" : "#160D2E"}" fill-opacity="${lit ? 0.75 : 1}" stroke="#A78BFA" stroke-opacity=".4" stroke-width="${f(w / 700)}"/>`);
    }
  }
  return wrap(w, h, `<radialGradient id="v" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></radialGradient>`, `<rect width="${w}" height="${h}" fill="#0B0618"/>${cells.join("")}<rect width="${w}" height="${h}" fill="url(#v)"/>`);
};

const hills: Scene = (w, h) => {
  const layer = (y: number, amp: number, color: string, seed: number) => {
    const r = rng(seed);
    let d = `M0 ${f(h * y)}`;
    for (let x = 0; x <= w; x += w / 8) d += ` Q ${f(x + w / 16)} ${f(h * (y - amp * r()))} ${f(x + w / 8)} ${f(h * (y - amp * 0.3 * r()))}`;
    return `<path d="${d} L ${w} ${h} L 0 ${h} Z" fill="${color}"/>`;
  };
  return wrap(
    w,
    h,
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0F2027"/><stop offset="1" stop-color="#2C5364"/></linearGradient>`,
    `<rect width="${w}" height="${h}" fill="url(#sky)"/>${stars(w, h, 40, 3, 0.4)}${layer(0.55, 0.15, "#2F7A6F", 1)}${layer(0.68, 0.12, "#225C55", 2)}${layer(0.8, 0.1, "#17423D", 4)}${layer(0.92, 0.08, "#0C2A27", 6)}`,
  );
};

const ocean: Scene = (w, h) => {
  const waves = Array.from({ length: 6 }, (_, i) => {
    const y = h * (0.45 + i * 0.1);
    let d = `M0 ${f(y)}`;
    for (let x = 0; x <= w; x += w / 6) d += ` q ${f(w / 24)} ${f(-h * 0.04)} ${f(w / 12)} 0 t ${f(w / 12)} 0`;
    return `<path d="${d} L ${w} ${h} L 0 ${h} Z" fill="${["#0E7490", "#0B5E7A", "#0A4D66", "#083B52", "#062C40", "#041F2E"][i]}"/>`;
  }).join("");
  return wrap(w, h, `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0C4A6E"/><stop offset="1" stop-color="#7DD3FC"/></linearGradient>`, `<rect width="${w}" height="${h}" fill="url(#sky)"/>${waves}`);
};

const lava: Scene = (w, h) => {
  const r = rng(31);
  const cracks = Array.from({ length: 18 }, () => {
    let x = r() * w;
    let y = r() * h;
    const pts = [`${f(x)},${f(y)}`];
    for (let s = 0; s < 6; s++) {
      x += (r() - 0.5) * w * 0.12;
      y += (r() - 0.3) * h * 0.12;
      pts.push(`${f(x)},${f(y)}`);
    }
    return `<polyline points="${pts.join(" ")}" fill="none" stroke="#FF7A00" stroke-width="${f(w / 260 + r() * (w / 300))}" stroke-linejoin="round" filter="url(#gl)"/>`;
  }).join("");
  return wrap(
    w,
    h,
    `<radialGradient id="g" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#4A0E0E"/><stop offset="1" stop-color="#0C0606"/></radialGradient><filter id="gl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${f(w / 300)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>${cracks}`,
  );
};

const arena: Scene = (w, h) => {
  const beams = [0.15, 0.38, 0.62, 0.85]
    .map((x, i) => `<polygon points="${f(w * x - w * 0.02)},0 ${f(w * x + w * 0.02)},0 ${f(w * (0.5 + (x - 0.5) * 0.4) + w * 0.12)},${h} ${f(w * (0.5 + (x - 0.5) * 0.4) - w * 0.12)},${h}" fill="${i % 2 ? "#38BDF8" : "#F472B6"}" opacity=".16" filter="url(#b)"/>`)
    .join("");
  return wrap(
    w,
    h,
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0A0A12"/><stop offset="1" stop-color="#1C1630"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="${f(w / 120)}"/></filter>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>${beams}<ellipse cx="${w / 2}" cy="${f(h * 0.95)}" rx="${f(w * 0.45)}" ry="${f(h * 0.12)}" fill="#7C3AED" opacity=".25" filter="url(#b)"/>`,
  );
};

const aurora: Scene = (w, h) => {
  const curtains = ["#22C55E", "#14B8A6", "#A855F7"]
    .map((c, i) => `<path d="M 0 ${f(h * (0.35 + i * 0.08))} C ${f(w * 0.25)} ${f(h * (0.1 + i * 0.05))}, ${f(w * 0.55)} ${f(h * (0.55 + i * 0.03))}, ${w} ${f(h * (0.25 + i * 0.06))}" fill="none" stroke="${c}" stroke-width="${f(h * 0.12)}" opacity=".5" filter="url(#b)"/>`)
    .join("");
  return wrap(
    w,
    h,
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020617"/><stop offset="1" stop-color="#0F2A2A"/></linearGradient><filter id="b" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${f(h / 20)}"/></filter>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>${stars(w, h, 120, 17)}${curtains}<path d="M0 ${f(h * 0.85)} L ${f(w * 0.2)} ${f(h * 0.7)} L ${f(w * 0.35)} ${f(h * 0.82)} L ${f(w * 0.55)} ${f(h * 0.66)} L ${f(w * 0.75)} ${f(h * 0.8)} L ${w} ${f(h * 0.7)} L ${w} ${h} L 0 ${h} Z" fill="#030712"/>`,
  );
};

const skyline: Scene = (w, h) => {
  const r = rng(53);
  const buildings: string[] = [];
  let x = 0;
  while (x < w) {
    const bw = w * (0.03 + r() * 0.05);
    const bh = h * (0.2 + r() * 0.45);
    buildings.push(`<rect x="${f(x)}" y="${f(h - bh)}" width="${f(bw)}" height="${f(bh)}" fill="#0B0B1A"/>`);
    for (let wy = h - bh + h * 0.03; wy < h - h * 0.03; wy += h * 0.035) {
      for (let wx = x + bw * 0.15; wx < x + bw * 0.85; wx += bw * 0.22) {
        if (r() > 0.62) buildings.push(`<rect x="${f(wx)}" y="${f(wy)}" width="${f(bw * 0.1)}" height="${f(h * 0.012)}" fill="${r() > 0.5 ? "#F472B6" : "#38BDF8"}" opacity=".8"/>`);
      }
    }
    x += bw + w * 0.004;
  }
  return wrap(
    w,
    h,
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A0B2E"/><stop offset=".7" stop-color="#4C1D95"/><stop offset="1" stop-color="#DB2777"/></linearGradient>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>${stars(w, h, 50, 29, 0.4)}${buildings.join("")}`,
  );
};

const peaks: Scene = (w, h) =>
  wrap(
    w,
    h,
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020617"/><stop offset="1" stop-color="#1E3A8A"/></linearGradient><linearGradient id="snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E2E8F0"/><stop offset=".4" stop-color="#64748B"/><stop offset="1" stop-color="#0F172A"/></linearGradient>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>${stars(w, h, 140, 61, 0.6)}<circle cx="${f(w * 0.2)}" cy="${f(h * 0.22)}" r="${f(h * 0.07)}" fill="#F8FAFC" opacity=".9"/>` +
      `<path d="M0 ${f(h * 0.8)} L ${f(w * 0.18)} ${f(h * 0.42)} L ${f(w * 0.3)} ${f(h * 0.6)} L ${f(w * 0.48)} ${f(h * 0.3)} L ${f(w * 0.66)} ${f(h * 0.62)} L ${f(w * 0.8)} ${f(h * 0.45)} L ${w} ${f(h * 0.75)} L ${w} ${h} L 0 ${h} Z" fill="url(#snow)"/>` +
      `<path d="M0 ${f(h * 0.9)} L ${f(w * 0.25)} ${f(h * 0.7)} L ${f(w * 0.45)} ${f(h * 0.85)} L ${f(w * 0.7)} ${f(h * 0.68)} L ${w} ${f(h * 0.88)} L ${w} ${h} L 0 ${h} Z" fill="#020617"/>`,
  );

/** Scenele, după cheie (cheile, numele și categoriile sunt în `src/presets.ts`). */
export const SCENES: Record<string, Scene> = { synthwave, nebula, carbon, topo, circuit: circuitBoard, dunes, storm, hexes, hills, ocean, lava, arena, aurora, skyline, peaks };
