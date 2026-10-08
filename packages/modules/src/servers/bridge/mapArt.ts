/**
 * Arta generică a hărților (specul 2026-10-08-servere-bridge §13): o imagine **originală**, desenată aici (SVG), un card
 * în culorile jocului cu un model geometric. Numele hărții se scrie peste ea la afișare. Nu conține text, imagini
 * externe sau scripturi; GCS nu livrează niciodată capturi de hărți ale altora.
 */

type Palette = { from: string; to: string; accent: string; line: string };

const PALETTES: Record<string, Palette> = {
  cs16: { from: "#2A1A08", to: "#6B4410", accent: "#F4B740", line: "#FFE2A3" },
  cs2: { from: "#3A1A0A", to: "#7C2D12", accent: "#FF9F1C", line: "#FFD6A5" },
};
const DEFAULT_PALETTE: Palette = { from: "#0D1B2A", to: "#1B3A5C", accent: "#5EA2FF", line: "#CFE3FF" };

/** Jocurile cu artă proprie (restul primesc paleta implicită). */
export const MAP_ART_GAMES = Object.keys(PALETTES);

/** SVG-ul generic al unui joc (640 × 360), determinist. */
export function mapArtSvg(game: string): string {
  const p = PALETTES[game] ?? DEFAULT_PALETTE;
  // Un model izometric de hexagoane, mai dens spre colțul din dreapta-sus, peste un degrade diagonal.
  const hexes: string[] = [];
  const r = 26;
  const w = Math.sqrt(3) * r;
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 14; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0);
      const cy = row * r * 1.5;
      const weight = Math.max(0, 1 - Math.hypot(640 - cx, cy) / 640);
      if (weight < 0.18) continue;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return `${(cx + r * 0.9 * Math.cos(a)).toFixed(1)},${(cy + r * 0.9 * Math.sin(a)).toFixed(1)}`;
      }).join(" ");
      hexes.push(`<polygon points="${pts}" fill="none" stroke="${p.line}" stroke-opacity="${(weight * 0.35).toFixed(2)}" stroke-width="1.5"/>`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360" role="img" aria-hidden="true">`,
    `<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient>`,
    `<radialGradient id="glow" cx="0.82" cy="0.18" r="0.7"><stop offset="0" stop-color="${p.accent}" stop-opacity="0.45"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#g)"/>`,
    `<rect width="640" height="360" fill="url(#glow)"/>`,
    `<g>${hexes.join("")}</g>`,
    `<path d="M0 300 L220 180 L330 240 L470 140 L640 230 L640 360 L0 360 Z" fill="${p.from}" fill-opacity="0.55"/>`,
    `<path d="M0 330 L160 260 L300 310 L430 230 L640 300 L640 360 L0 360 Z" fill="${p.from}" fill-opacity="0.8"/>`,
    `<circle cx="540" cy="80" r="18" fill="none" stroke="${p.accent}" stroke-width="3" stroke-opacity="0.8"/>`,
    `<path d="M540 52 V66 M540 94 V108 M512 80 H526 M554 80 H568" stroke="${p.accent}" stroke-width="3" stroke-linecap="round" stroke-opacity="0.8"/>`,
    `<rect width="640" height="360" fill="url(#fade)"/>`,
    `</svg>`,
  ].join("");
}
