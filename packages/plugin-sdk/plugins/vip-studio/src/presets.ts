/**
 * Catalogul implicit al Studioului VIP, creat pentru GCS: stiluri de nume (cu variante de culoare), bannere, rame,
 * fundaluri de card, arme, fundaluri de profil și teme. Se inserează la prima rulare (cu aceeași validare ca în ACP) și
 * se poate restaura din ACP; adminii le pot redenumi, reordona, dezactiva sau restricționa la planuri.
 */
import { ASSET_BASE, inkFor, VARIANTS, type Animation, type Effect, type Kind, type Speed } from "./model";

/** Versiunea catalogului implicit: crește când se adaugă presetări noi (se inserează doar cele lipsă). */
export const PRESETS_VERSION = 1;

export type Preset = { kind: Kind; key: string; name: string; category?: string; data: Record<string, unknown>; plans?: string[] };

const ALL_VARIANTS = Object.entries(VARIANTS).map(([key, colors]) => ({ key, colors }));
const pick = (...keys: string[]) => keys.map((key) => ({ key, colors: VARIANTS[key]! }));

type NameDef = { key: string; name: string; effect?: Effect; colors?: string[]; variants?: { key: string; colors: string[]; glow?: string }[]; angle?: number; animation?: Animation; speed?: Speed; italic?: boolean; plans?: string[] };

/** ~50 de stiluri: culori pline, gradiente, animate; câteva cu bandă de variante. */
const NAME_STYLES: NameDef[] = [
  // Cu variante de culoare (banda de culori din studio).
  { key: "neon", name: "Neon", effect: "neon", variants: ALL_VARIANTS },
  { key: "pulse", name: "Puls", effect: "pulse", variants: ALL_VARIANTS },
  { key: "duo", name: "Duo", variants: ALL_VARIANTS, angle: 90 },
  { key: "wave", name: "Val", effect: "shimmer", variants: ALL_VARIANTS },
  { key: "chrome", name: "Crom", effect: "chrome", variants: pick("white", "gold", "cyan", "red", "purple", "green") },
  { key: "scanline", name: "Linii de scanare", effect: "scan", variants: pick("cyan", "green", "red", "purple", "gold", "white") },
  { key: "glitch", name: "Glitch", effect: "glitch", variants: [{ key: "classic", colors: ["#FFFFFF", "#FF2E63", "#08D9D6"] }, { key: "toxic", colors: ["#D9F99D", "#A3E635", "#22D3EE"] }, { key: "sunset", colors: ["#FFE4B5", "#FF6B35", "#7B2FF7"] }] },
  { key: "flame", name: "Flacără", effect: "fire", angle: 0, variants: [{ key: "orange", colors: ["#FFE066", "#FF8C00", "#E63946"] }, { key: "blue", colors: ["#E0F2FE", "#38BDF8", "#1D4ED8"] }, { key: "green", colors: ["#ECFCCB", "#84CC16", "#166534"] }, { key: "purple", colors: ["#F5D0FE", "#C026D3", "#581C87"] }] },
  { key: "terminal", name: "Terminal", effect: "caret", variants: pick("green", "white", "cyan", "gold"), italic: false },
  { key: "solid", name: "Culoare plină", variants: Object.entries(VARIANTS).filter(([k]) => k !== "rainbow").map(([key, c]) => ({ key, colors: [c[0]!] })) },
  // Culori pline.
  { key: "ember", name: "Jar", colors: ["#FF5A36"] },
  { key: "frost", name: "Ger", colors: ["#9BE7FF"] },
  { key: "venom", name: "Venin", colors: ["#A3E635"] },
  { key: "royal", name: "Regal", colors: ["#A78BFA"] },
  { key: "blossom", name: "Floare de cireș", colors: ["#F9A8D4"] },
  { key: "ivory", name: "Fildeș", colors: ["#F5F1E8"] },
  { key: "amber", name: "Chihlimbar", colors: ["#F59E0B"] },
  { key: "abyss", name: "Abis", colors: ["#2DD4BF"] },
  // Gradiente fixe.
  { key: "sunset", name: "Apus", colors: ["#FF5F6D", "#FFC371"] },
  { key: "ocean", name: "Ocean", colors: ["#2193B0", "#6DD5ED"] },
  { key: "mint", name: "Mentă", colors: ["#A8FF78", "#78FFD6"] },
  { key: "peach", name: "Piersică", colors: ["#FFB88C", "#DE6262"] },
  { key: "dusk", name: "Amurg", colors: ["#7F7FD5", "#86A8E7", "#91EAE4"] },
  { key: "berry", name: "Fructe de pădure", colors: ["#8E2DE2", "#F000FF"] },
  { key: "citrus", name: "Citrice", colors: ["#F7971E", "#FFD200"] },
  { key: "lagoon", name: "Lagună", colors: ["#43CEA2", "#185A9D"] },
  { key: "rose_gold", name: "Aur roz", colors: ["#F4C4B4", "#B76E79"] },
  { key: "steel", name: "Oțel", colors: ["#E2E8F0", "#64748B"] },
  { key: "candy", name: "Bomboană", colors: ["#FF9A9E", "#FAD0C4", "#A18CD1"] },
  { key: "jungle", name: "Junglă", colors: ["#56AB2F", "#A8E063"] },
  // Animate.
  { key: "aurora", name: "Auroră", effect: "shimmer", colors: ["#00F5A0", "#00D9F5", "#7B2FF7"], speed: "slow" },
  { key: "plasma", name: "Plasmă", effect: "shimmer", colors: ["#FF00CC", "#3333FF"], speed: "fast" },
  { key: "lava", name: "Lavă", effect: "fire", colors: ["#FFF3B0", "#F12711", "#F5AF19"], angle: 0 },
  { key: "nebula", name: "Nebuloasă", effect: "holo", colors: ["#8E2DE2", "#4A00E0", "#F000FF"] },
  { key: "holo", name: "Holografic", effect: "holo", colors: ["#FF8A8A", "#FFD27F", "#8AFFC1", "#8AC6FF", "#D18AFF"] },
  { key: "gold_rush", name: "Aur pur", effect: "chrome", colors: ["#FDE68A", "#F59E0B", "#B45309"] },
  { key: "silver", name: "Argint", effect: "chrome", colors: ["#FFFFFF", "#94A3B8", "#E2E8F0"] },
  { key: "cyber", name: "Cyber", effect: "glitch", colors: ["#F9F871", "#FF2E63", "#08D9D6"] },
  { key: "matrix", name: "Matrice", effect: "caret", colors: ["#00FF41"] },
  { key: "ghost", name: "Fantomă", effect: "pulse", colors: ["#E0E7FF"], italic: true },
  { key: "inferno", name: "Infern", effect: "fire", colors: ["#FFD000", "#FF4E00", "#B80000"], angle: 0, speed: "fast" },
  { key: "toxic_glow", name: "Radioactiv", effect: "neon", colors: ["#B6FF3B"] },
  { key: "ice_neon", name: "Neon polar", effect: "neon", colors: ["#7DF9FF"] },
  { key: "vapor", name: "Vapor", effect: "scan", colors: ["#FF71CE", "#01CDFE", "#B967FF"] },
  { key: "galaxy", name: "Galaxie", effect: "shimmer", colors: ["#0F0C29", "#6A3093", "#A044FF", "#E0C3FC"], speed: "slow" },
  { key: "sunrise", name: "Răsărit", effect: "shimmer", colors: ["#FF512F", "#F09819", "#FFE29F"] },
  { key: "royal_flow", name: "Purpură", effect: "shimmer", colors: ["#C471F5", "#FA71CD"] },
  { key: "emerald", name: "Smarald", effect: "chrome", colors: ["#D1FAE5", "#10B981", "#065F46"] },
  { key: "ruby", name: "Rubin", effect: "pulse", colors: ["#FF4D6D", "#C9184A"] },
  { key: "storm", name: "Furtună", effect: "glitch", colors: ["#E0F2FE", "#60A5FA", "#F472B6"] },
];

/** Bannerele (~70): culori pline, gradiente și animate. Textul (eticheta planului) are culoarea lizibilă. */
const SOLID_BANNERS: [string, string, string][] = [
  ["crimson", "Carmin", "#D62839"],
  ["scarlet", "Stacojiu", "#FF3B4E"],
  ["tangerine", "Mandarină", "#FF7A00"],
  ["sun", "Soare", "#FFC300"],
  ["lime", "Lime", "#9EF01A"],
  ["emerald", "Smarald", "#10B981"],
  ["teal", "Turcoaz", "#14B8A6"],
  ["sky", "Cer", "#38BDF8"],
  ["cobalt", "Cobalt", "#2563EB"],
  ["indigo", "Indigo", "#4F46E5"],
  ["violet", "Violet", "#8B5CF6"],
  ["orchid", "Orhidee", "#C026D3"],
  ["rose", "Trandafir", "#F43F5E"],
  ["slate", "Ardezie", "#475569"],
  ["onyx", "Onix", "#111318"],
  ["pearl", "Perlă", "#F1F5F9"],
];

const GRADIENT_BANNERS: [string, string, string[], number?][] = [
  ["gold", "Auriu", ["#FDE68A", "#F59E0B", "#B45309"], 135],
  ["gold_dark", "Aur vechi", ["#B45309", "#78350F"], 135],
  ["silver", "Argintiu", ["#F8FAFC", "#94A3B8"], 135],
  ["bronze", "Bronz", ["#E7A86B", "#8C4A1E"], 135],
  ["sunset", "Apus", ["#FF5F6D", "#FFC371"]],
  ["ocean", "Ocean", ["#2193B0", "#6DD5ED"]],
  ["forest", "Pădure", ["#134E5E", "#71B280"]],
  ["berry", "Fructe", ["#8E2DE2", "#F000FF"]],
  ["fire", "Foc", ["#F12711", "#F5AF19"]],
  ["ice", "Gheață", ["#E0F7FF", "#5BC0EB"], 135],
  ["night", "Noapte", ["#0F2027", "#203A43", "#2C5364"]],
  ["candy", "Bomboană", ["#FF9A9E", "#FECFEF"]],
  ["lagoon", "Lagună", ["#43CEA2", "#185A9D"]],
  ["royal", "Regal", ["#4B0082", "#8A2BE2"], 135],
  ["blood", "Sânge", ["#870000", "#190A05"], 135],
  ["mint", "Mentă", ["#A8FF78", "#78FFD6"]],
  ["peach", "Piersică", ["#FFB88C", "#DE6262"]],
  ["steel", "Oțel", ["#485563", "#29323C"]],
  ["dusk", "Amurg", ["#7F7FD5", "#86A8E7", "#91EAE4"]],
  ["citrus", "Citrice", ["#F7971E", "#FFD200"]],
  ["carbon", "Carbon", ["#232526", "#414345"]],
  ["sakura", "Sakura", ["#FBC2EB", "#A6C1EE"]],
  ["toxic", "Toxic", ["#D4FC79", "#96E6A1"]],
  ["cosmic", "Cosmic", ["#0F0C29", "#302B63", "#24243E"]],
];

const ANIMATED_BANNERS: [string, string, string[], Animation, Speed?][] = [
  ["neon_flow", "Neon în mișcare", ["#FF00CC", "#3333FF", "#00F5FF"], "flow"],
  ["plasma", "Plasmă", ["#FF0080", "#7928CA", "#FF0080"], "flow", "fast"],
  ["aurora", "Auroră", ["#00F5A0", "#00D9F5", "#7B2FF7"], "aurora", "slow"],
  ["aurora_pink", "Auroră roz", ["#FF6FD8", "#3813C2"], "aurora"],
  ["lava_flow", "Lavă curgătoare", ["#FF4E00", "#EC9F05", "#FF0000"], "flow"],
  ["ocean_flow", "Maree", ["#00C6FF", "#0072FF", "#00C6FF"], "flow", "slow"],
  ["rainbow", "Curcubeu", ["#FF4D4D", "#FFB020", "#3DDC97", "#38BDF8", "#A78BFA"], "flow"],
  ["toxic_flow", "Radioactiv", ["#B6FF3B", "#00FF87", "#60EFFF"], "flow"],
  ["vapor", "Vaporwave", ["#FF71CE", "#01CDFE", "#B967FF"], "flow"],
  ["inferno", "Infern", ["#FFD000", "#FF4E00", "#B80000"], "flow", "fast"],
  ["galaxy", "Galaxie", ["#0F0C29", "#6A3093", "#A044FF"], "aurora", "slow"],
  ["cyber", "Cyber", ["#F9F871", "#FF2E63", "#08D9D6"], "flow"],
  ["gold_shine", "Aur strălucitor", ["#F59E0B", "#B45309"], "shine"],
  ["silver_shine", "Argint strălucitor", ["#CBD5E1", "#64748B"], "shine"],
  ["ruby_shine", "Rubin", ["#E11D48", "#881337"], "shine"],
  ["emerald_shine", "Smarald strălucitor", ["#10B981", "#065F46"], "shine"],
  ["sapphire_shine", "Safir", ["#2563EB", "#1E3A8A"], "shine"],
  ["obsidian_shine", "Obsidian", ["#1F2937", "#030712"], "shine", "slow"],
  ["pulse_red", "Puls roșu", ["#D62839"], "pulse"],
  ["pulse_cyan", "Puls cyan", ["#06B6D4"], "pulse"],
  ["pulse_violet", "Puls violet", ["#8B5CF6"], "pulse"],
  ["pulse_gold", "Puls auriu", ["#F59E0B"], "pulse"],
  ["pulse_green", "Puls verde", ["#22C55E"], "pulse"],
  ["pulse_pink", "Puls roz", ["#EC4899"], "pulse"],
  ["storm_flow", "Furtună", ["#1E3A8A", "#60A5FA", "#E0F2FE"], "flow", "fast"],
  ["sunrise_flow", "Răsărit", ["#FF512F", "#F09819", "#FFE29F"], "aurora"],
  ["midnight", "Miez de noapte", ["#232526", "#5B21B6", "#232526"], "flow", "slow"],
  ["blossom_flow", "Petale", ["#FBC2EB", "#F9A8D4", "#A6C1EE"], "flow", "slow"],
  ["electric", "Electric", ["#4F46E5", "#22D3EE"], "shine", "fast"],
  ["blood_moon", "Lună roșie", ["#450A0A", "#DC2626", "#450A0A"], "flow"],
];

/** Ramele (desenele în `art/frames.ts`), pe categorii. */
const FRAMES: [string, string, string, number?][] = [
  ["ember", "Inel de foc", "Elemente"],
  ["frost", "Gheață", "Elemente"],
  ["plasma", "Plasmă", "Elemente"],
  ["toxic", "Toxic", "Elemente"],
  ["circuit", "Circuit", "Tech"],
  ["hex", "Hexagon", "Tech"],
  ["reticle", "Țintă", "Tech"],
  ["pixel", "Pixeli", "Tech", 128],
  ["laurel", "Laur", "Regal", 134],
  ["crown", "Coroană", "Regal", 136],
  ["wings", "Aripi", "Regal", 138],
  ["thorns", "Spini", "Întunecat"],
  ["runic", "Runic", "Întunecat"],
  ["camo", "Camuflaj", "Întunecat", 128],
  ["galaxy", "Galaxie", "Cosmic"],
  ["twin_neon", "Neon dublu", "Cosmic"],
];

/** Fundalurile de card (scenele din `art/scenes.ts`), pe categorii. */
const CARDS: [string, string, string][] = [
  ["synthwave", "Retro neon", "Neon"],
  ["arena", "Arenă", "Neon"],
  ["hexes", "Hexagoane", "Neon"],
  ["nebula", "Nebuloasă", "Cosmos"],
  ["aurora", "Auroră", "Cosmos"],
  ["peaks", "Vârfuri", "Natură"],
  ["hills", "Dealuri", "Natură"],
  ["ocean", "Ocean", "Natură"],
  ["dunes", "Dune", "Natură"],
  ["carbon", "Carbon", "Texturi"],
  ["topo", "Topografic", "Texturi"],
  ["circuit", "Circuit", "Texturi"],
  ["storm", "Furtună", "Dramatic"],
  ["lava", "Lavă", "Dramatic"],
  ["skyline", "Oraș", "Dramatic"],
];

/** Fundalurile de profil (imagini mari; adminii pot adăuga videoclipuri din ACP). */
const BACKGROUNDS: [string, string, string][] = [
  ["synthwave", "Retro neon", "Neon"],
  ["skyline", "Oraș de noapte", "Neon"],
  ["nebula", "Nebuloasă", "Cosmos"],
  ["aurora", "Auroră", "Cosmos"],
  ["peaks", "Munți", "Natură"],
  ["ocean", "Ocean", "Natură"],
  ["storm", "Furtună", "Dramatic"],
  ["lava", "Lavă", "Dramatic"],
];

/** Armele (desenele în `art/weapons.ts`). */
const WEAPONS: [string, string][] = [
  ["rifle", "Pușcă de asalt"],
  ["sniper", "Pușcă cu lunetă"],
  ["pistol", "Pistol"],
  ["revolver", "Revolver"],
  ["smg", "Pistol-mitralieră"],
  ["shotgun", "Shotgun"],
  ["lmg", "Mitralieră"],
  ["knife", "Cuțit"],
  ["grenade", "Grenadă"],
  ["bow", "Arc"],
  ["crossbow", "Arbaletă"],
  ["katana", "Katana"],
  ["axe", "Topor"],
  ["launcher", "Lansator"],
];

/** Temele profilului: accentul, al doilea accent, suprafața panourilor și strălucirea. */
const THEMES: [string, string, Record<string, unknown>][] = [
  ["carbon", "Carbon", { accent: "#22D3EE", accent2: "#38BDF8", surface: "#0B1220", glow: true }],
  ["ember", "Jar", { accent: "#FF6B35", accent2: "#FFD166", surface: "#1A0F0A", glow: true }],
  ["venom", "Venin", { accent: "#A3E635", accent2: "#4ADE80", surface: "#0D140A", glow: false }],
  ["regal", "Regal", { accent: "#C084FC", accent2: "#F0ABFC", surface: "#140B1F", glow: true }],
  ["glacier", "Ghețar", { accent: "#7DD3FC", accent2: "#E0F2FE", surface: "#0A1622", glow: false }],
];

/** Toate presetările, în ordinea din studio. */
export function defaultPresets(): Preset[] {
  const out: Preset[] = [];
  for (const s of NAME_STYLES) {
    out.push({
      kind: "name_style",
      key: s.key,
      name: s.name,
      data: {
        effect: s.effect ?? "none",
        variants: s.variants ?? [{ key: "default", colors: s.colors! }],
        angle: s.angle ?? 90,
        animation: "none",
        speed: s.speed ?? "normal",
        bold: true,
        italic: s.italic === true,
      },
      ...(s.plans ? { plans: s.plans } : {}),
    });
  }
  for (const [key, name, color] of SOLID_BANNERS) out.push({ kind: "banner", key, name, data: { fill: { colors: [color], angle: 90, animation: "none", speed: "normal" }, text: inkFor(color) } });
  for (const [key, name, colors, angle] of GRADIENT_BANNERS) {
    out.push({ kind: "banner", key, name, data: { fill: { colors, angle: angle ?? 90, animation: "none", speed: "normal" }, text: inkFor(colors[Math.floor(colors.length / 2)]!) } });
  }
  for (const [key, name, colors, animation, speed] of ANIMATED_BANNERS) {
    out.push({ kind: "banner", key, name, data: { fill: { colors, angle: 90, animation, speed: speed ?? "normal" }, text: inkFor(colors[0]!) } });
  }
  for (const [key, name, category, scale] of FRAMES) out.push({ kind: "frame", key, name, category, data: { image: `${ASSET_BASE}/frames/${key}.png`, scale: scale ?? 130, x: 0, y: 0 } });
  for (const [key, name, category] of CARDS) out.push({ kind: "card", key, name, category, data: { image: `${ASSET_BASE}/cards/${key}.webp` } });
  for (const [key, name] of WEAPONS) out.push({ kind: "weapon", key, name, data: { icon: `${ASSET_BASE}/weapons/${key}.png` } });
  for (const [key, name, category] of BACKGROUNDS) {
    out.push({ kind: "background", key, name, category, data: { image: `${ASSET_BASE}/backgrounds/${key}.webp`, thumb: `${ASSET_BASE}/backgrounds/${key}-thumb.webp` } });
  }
  for (const [key, name, data] of THEMES) out.push({ kind: "theme", key, name, data });
  return out;
}

/** Fișierele de construit (art): cheile ramelor, ale armelor, ale cardurilor și ale fundalurilor. */
export const ART_KEYS = {
  frames: FRAMES.map((f) => f[0]),
  weapons: WEAPONS.map((w) => w[0]),
  cards: CARDS.map((c) => c[0]),
  backgrounds: BACKGROUNDS.map((b) => b[0]),
};
