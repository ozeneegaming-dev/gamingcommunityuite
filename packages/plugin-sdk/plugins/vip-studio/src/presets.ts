/**
 * Catalogul implicit al Studioului VIP, creat pentru GCS: stiluri de nume (cu variante de culoare), bannere, rame,
 * fundaluri de card, arme, fundaluri de profil și teme. Se inserează la prima rulare (cu aceeași validare ca în ACP) și
 * se poate restaura din ACP; adminii le pot redenumi, reordona, dezactiva sau restricționa la planuri.
 */
import { ASSET_BASE, inkFor, VARIANTS, type Animation, type Effect, type Kind, type Speed } from "./model";

/**
 * Versiunea catalogului implicit: crește când se adaugă presetări noi (se inserează doar cele lipsă). Versiunea 2
 * (pluginul 1.0.1) înlocuiește stilurile de nume din versiunea 1 cu catalogul nou, pe categorii (`upgradeNameStyles`).
 * Versiunea 3 (pluginul 1.1.0) adaugă categoria „Efecte text” și variantele de culoare care lipseau din stilurile cu
 * bandă de culori (`refreshNameStyles`: doar stilurile neschimbate de admin).
 */
export const PRESETS_VERSION = 3;

export type Preset = { kind: Kind; key: string; name: string; category?: string; data: Record<string, unknown>; plans?: string[] };

const ALL_VARIANTS = Object.entries(VARIANTS).map(([key, colors]) => ({ key, colors }));
const pick = (...keys: string[]) => keys.map((key) => ({ key, colors: VARIANTS[key]! }));

type NameDef = { key: string; name: string; effect?: Effect; colors?: string[]; variants?: { key: string; colors: string[]; glow?: string }[]; angle?: number; animation?: Animation; speed?: Speed; italic?: boolean; plans?: string[]; category?: string };

/**
 * Stilurile de nume ale versiunii 1 (pluginul 1.0.0), păstrate doar pentru actualizare: cele neschimbate de admin se
 * înlocuiesc cu stilul nou cel mai apropiat (`LEGACY_NAME_MAP`), iar alegerile membrilor se mută pe el.
 */
export const LEGACY_NAME_STYLES: NameDef[] = [
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

/** O variantă pe culoare (cheile din `VARIANTS`, cu etichetele lor în studio). */
const v = (key: string, ...colors: string[]) => ({ key, colors });
/** Câte o culoare din fiecare variantă comună (neon, puls, electric…), curcubeul cu toate. */
const SINGLE: Record<string, string> = { red: "#FF3B4E", blue: "#4F8BFF", cyan: "#22D3EE", gold: "#FFD34D", green: "#39FF14", orange: "#FF9F43", pink: "#FF4FD8", purple: "#B57BFF", white: "#F8FAFC" };
const singles = (...keys: string[]) => keys.map((key) => (key === "rainbow" ? v("rainbow", ...VARIANTS.rainbow!) : v(key, SINGLE[key]!)));
const ALL_KEYS = ["red", "blue", "cyan", "gold", "green", "orange", "pink", "purple", "rainbow", "white"];

/**
 * Catalogul de stiluri de nume (versiunea 2): efecte originale GCS, pe categorii, cele mai multe cu bandă de variante.
 * Efectele le desenează GCS (lista albă `appearance`); aici doar efectul, culorile, viteza și stilul literei.
 */
const NAME_STYLES_V2: NameDef[] = [
  // Neon
  { key: "neon_tub", name: "Tub de neon", category: "Neon", effect: "neon", variants: singles(...ALL_KEYS) },
  { key: "lumini_oras", name: "Lumini de oraș", category: "Neon", effect: "citylights", variants: [v("pink", "#FF71CE", "#01CDFE", "#B967FF"), v("cyan", "#01CDFE", "#B967FF", "#FF71CE"), v("gold", "#FFD34D", "#FF71CE", "#01CDFE")] },
  { key: "respiratie", name: "Respirație", category: "Neon", effect: "pulse", variants: singles("red", "pink", "purple", "blue", "cyan", "green", "gold", "orange", "white") },
  { key: "electric_neon", name: "Electric", category: "Neon", effect: "electric", variants: singles(...ALL_KEYS) },
  { key: "aura_palida", name: "Aură", category: "Neon", effect: "aura", variants: [v("white", "#E0E7FF", "#818CF8"), v("gold", "#FFF1C2", "#F59E0B"), v("pink", "#FFE4F2", "#EC4899"), v("cyan", "#E0FFFF", "#22D3EE")] },
  { key: "turcoaz_neon", name: "Turcoaz neon", category: "Neon", effect: "neon", colors: ["#2DD4BF"] },
  { key: "stacojiu", name: "Stacojiu", category: "Neon", effect: "pulse", colors: ["#E11D48"] },
  // Foc
  { key: "flacara_vie", name: "Flacără vie", category: "Foc", effect: "fire", variants: [v("orange", "#FFE066", "#FF8C00", "#E63946"), v("blue", "#E0F2FE", "#38BDF8", "#1D4ED8"), v("green", "#ECFCCB", "#84CC16", "#166534"), v("purple", "#F5D0FE", "#C026D3", "#581C87")] },
  { key: "infern", name: "Infern", category: "Foc", effect: "inferno", variants: [v("orange", "#FFF3B0", "#FF6A00", "#B80000"), v("blue", "#E0F7FF", "#3B82F6", "#1E1B4B"), v("green", "#F7FEE7", "#65A30D", "#14532D"), v("purple", "#FAE8FF", "#A21CAF", "#3B0764")] },
  { key: "jar_curgator", name: "Jar curgător", category: "Foc", effect: "shimmer", colors: ["#FF4E00", "#EC9F05", "#FF0000"], speed: "slow" },
  // Metal
  { key: "aur_curat", name: "Aur curat", category: "Metal", effect: "gold", variants: [v("gold", "#FFE08A", "#D4A017", "#7A4B00"), v("white", "#F8FAFC", "#CBD5E1", "#475569"), v("orange", "#FBD5C5", "#D4877A", "#7A3B33")] },
  { key: "crom_lustruit", name: "Crom lustruit", category: "Metal", effect: "chrome", variants: [v("white", "#E5E7EB", "#9CA3AF", "#374151"), v("gold", "#FDE68A", "#F59E0B", "#78350F"), v("blue", "#DBEAFE", "#60A5FA", "#1E3A8A"), v("red", "#FECACA", "#EF4444", "#7F1D1D"), v("green", "#D1FAE5", "#10B981", "#065F46")] },
  { key: "relief_3d", name: "Relief 3D", category: "Metal", effect: "extrude", variants: [v("gold", "#FFD34D", "#FF3B4E"), v("cyan", "#A5F3FC", "#2563EB"), v("white", "#F8FAFC", "#6366F1"), v("green", "#BBF7D0", "#15803D")] },
  { key: "contur_viu", name: "Contur viu", category: "Metal", effect: "outline", variants: [v("red", "#FF3B4E", "#FFD34D", "#22D3EE"), v("cyan", "#22D3EE", "#A78BFA", "#F472B6"), v("gold", "#FFD34D", "#FF9F43", "#FF3B4E"), v("white", "#F8FAFC", "#94A3B8", "#F8FAFC")] },
  // Glitch
  { key: "glitch_rgb", name: "Glitch RGB", category: "Glitch", effect: "glitch", variants: [v("white", "#F2F2F2", "#FF2E63", "#08D9D6"), v("green", "#D9F99D", "#A3E635", "#22D3EE"), v("orange", "#FFE4B5", "#FF6B35", "#7B2FF7")] },
  { key: "digital", name: "Digital", category: "Glitch", effect: "caret", variants: [v("green", "#39FF14", "#B6FFB0"), v("cyan", "#22D3EE", "#A5F3FC"), v("gold", "#FFD34D", "#FFF3B0"), v("white", "#E5E7EB", "#FFFFFF"), v("red", "#FF3B4E", "#FFB4BC")] },
  { key: "masina_de_scris", name: "Mașina de scris", category: "Glitch", effect: "typewriter", variants: [v("white", "#F5F1E8", "#FF3B4E"), v("green", "#39FF14", "#B6FFB0"), v("gold", "#FFD34D", "#FFFFFF")] },
  { key: "scanare", name: "Scanare", category: "Glitch", effect: "scan", variants: [v("cyan", "#22D3EE", "#A5F3FC"), v("green", "#4ADE80", "#BBF7D0"), v("red", "#FF3B4E", "#FECACA"), v("purple", "#B57BFF", "#E9D5FF")] },
  { key: "ploaie_digitala", name: "Ploaie digitală", category: "Glitch", effect: "matrix", variants: [v("green", "#00FF41", "#00C832"), v("cyan", "#22D3EE", "#0891B2"), v("red", "#FF3B4E", "#B91C1C")] },
  { key: "oglinda_sparta", name: "Oglindă spartă", category: "Glitch", effect: "shatter", variants: [v("cyan", "#E0F2FE", "#7DD3FC"), v("white", "#F8FAFC", "#CBD5E1"), v("red", "#FECACA", "#F87171"), v("purple", "#F3E8FF", "#C084FC")] },
  { key: "taietura", name: "Tăietură", category: "Glitch", effect: "razor", variants: [v("red", "#F8FAFC", "#FF3B4E", "#FFFFFF"), v("cyan", "#F8FAFC", "#22D3EE", "#FFFFFF"), v("gold", "#FFF7D6", "#F59E0B", "#FFFFFF")] },
  { key: "tinta", name: "Țintă", category: "Glitch", effect: "crosshair", variants: [v("red", "#F8FAFC", "#FF3B4E", "#FFD34D"), v("green", "#ECFCCB", "#39FF14", "#FFFFFF"), v("cyan", "#E0F2FE", "#22D3EE", "#FF3B4E")] },
  // Holografic
  { key: "holografic", name: "Holografic", category: "Holografic", effect: "holo", variants: [v("rainbow", "#FF8A8A", "#FFD27F", "#8AFFC1", "#8AC6FF", "#D18AFF"), v("pink", "#FFC2E2", "#C4B5FD", "#A5F3FC", "#FDE68A", "#FBCFE8")] },
  { key: "curcubeu", name: "Curcubeu", category: "Holografic", effect: "shimmer", colors: VARIANTS.rainbow! },
  { key: "culori_in_miscare", name: "Culori în mișcare", category: "Holografic", effect: "shimmer", variants: ALL_VARIANTS },
  { key: "raza_verticala", name: "Rază verticală", category: "Holografic", effect: "vscan", variants: [v("purple", "#A78BFA", "#22D3EE"), v("gold", "#FFD34D", "#FF9F43"), v("green", "#4ADE80", "#22D3EE"), v("red", "#FF3B4E", "#FF9F43")] },
  { key: "licar", name: "Licăr", category: "Holografic", effect: "reveal", variants: [v("cyan", "#7DF9FF", "#00B3FF"), v("gold", "#FFE08A", "#F59E0B"), v("pink", "#FFC2E2", "#EC4899"), v("white", "#FFFFFF", "#A1A7B4")] },
  { key: "reflex", name: "Reflex", category: "Holografic", effect: "mirror", variants: [v("gold", "#FDE68A", "#F59E0B"), v("cyan", "#A5F3FC", "#0891B2"), v("pink", "#FBCFE8", "#DB2777"), v("white", "#F8FAFC", "#94A3B8")] },
  // Cosmic
  { key: "cosmic", name: "Cosmic", category: "Cosmic", effect: "cosmic", variants: [v("purple", "#C084FC", "#6366F1", "#F0ABFC"), v("blue", "#93C5FD", "#4F46E5", "#C7D2FE"), v("pink", "#F9A8D4", "#7C3AED", "#FBCFE8")] },
  { key: "galaxie_vie", name: "Galaxie", category: "Cosmic", effect: "shimmer", colors: ["#7C3AED", "#A044FF", "#E0C3FC", "#7DD3FC"], speed: "slow", italic: true },
  { key: "plasma_vie", name: "Plasmă", category: "Cosmic", effect: "plasma", variants: [v("pink", "#FF00CC", "#3333FF", "#00F5FF"), v("gold", "#FFD000", "#FF4E00", "#FF00A8"), v("green", "#00FF87", "#60EFFF", "#7B2FF7")] },
  { key: "fulger", name: "Fulger", category: "Cosmic", effect: "lightning", variants: singles("blue", "gold", "purple", "white", "cyan") },
  // Animat
  { key: "umbre_dansante", name: "Umbre dansante", category: "Animat", effect: "shadowdance", variants: [v("white", "#FFFFFF", "#FF2E63", "#08D9D6"), v("gold", "#FFD34D", "#FF3B4E", "#4F8BFF"), v("green", "#BBF7D0", "#A855F7", "#F97316")] },
  { key: "val_dragoste", name: "Val de dragoste", category: "Animat", effect: "love", variants: [v("pink", "#FF6FC8", "#FF2E63", "#FFC2E2"), v("red", "#FF4D6D", "#FF8FA3", "#FFD6DD"), v("purple", "#C084FC", "#F472B6", "#F5D0FE")] },
  { key: "bani", name: "Bani", category: "Animat", effect: "money", variants: [v("green", "#4ADE80", "#FFD34D"), v("gold", "#FFD34D", "#4ADE80")] },
  { key: "acid", name: "Acid", category: "Animat", effect: "toxic", variants: [v("green", "#B6FF3B", "#3BAF00"), v("purple", "#E879F9", "#7E22CE"), v("orange", "#FDBA74", "#C2410C")] },
  { key: "ger_cristal", name: "Ger", category: "Animat", effect: "frost", variants: [v("cyan", "#E0F7FF", "#5BC0EB"), v("purple", "#F3E8FF", "#A78BFA"), v("white", "#FFFFFF", "#94A3B8")] },
  // Clasic
  { key: "culoare_plina", name: "Culoare plină", category: "Clasic", variants: Object.entries(VARIANTS).filter(([k]) => k !== "rainbow").map(([key, c]) => ({ key, colors: [c[0]!] })) },
  { key: "gradient_duo", name: "Gradient", category: "Clasic", variants: ALL_VARIANTS },
  { key: "apus_cald", name: "Apus", category: "Clasic", colors: ["#FF5F6D", "#FFC371"] },
  { key: "ocean_adanc", name: "Ocean", category: "Clasic", colors: ["#2193B0", "#6DD5ED"] },
  { key: "aurora_boreala", name: "Auroră", category: "Clasic", effect: "shimmer", colors: ["#00F5A0", "#00D9F5", "#7B2FF7"], speed: "slow" },
];

/**
 * Variantele comune ale efectelor cu mai multe culori: culoarea principală, una deschisă și una închisă (efectele
 * folosesc a doua și a treia pentru straturi, umbre și accente). Curcubeul are cinci culori.
 */
const PAL: Record<string, string[]> = {
  red: ["#FF3B4E", "#FF9AA6", "#B3122B"],
  blue: ["#4F8BFF", "#A9C7FF", "#1E3A8A"],
  cyan: ["#22D3EE", "#A5F3FC", "#0E7490"],
  gold: ["#FFD34D", "#FFF1B8", "#B45309"],
  green: ["#4ADE80", "#BBF7D0", "#15803D"],
  orange: ["#FF9F43", "#FFD2A6", "#C2410C"],
  pink: ["#FF6FC8", "#FFC2E2", "#BE185D"],
  purple: ["#B57BFF", "#E3CCFF", "#5B21B6"],
  white: ["#F8FAFC", "#CBD5E1", "#64748B"],
  rainbow: ["#FF4D4D", "#FFB020", "#3DDC97", "#38BDF8", "#A78BFA"],
};
const pal = (...keys: string[]) => keys.map((key) => v(key, ...PAL[key]!));
/** Setul obișnuit al variantelor (banda de culori). */
const STD = ["pink", "cyan", "gold", "green", "purple", "red", "blue", "orange", "white", "rainbow"];
/** Varianta „clasic” a efectelor cu straturi colorate (alb, roșu-roz, cyan), ca un glitch RGB. */
const CLASSIC = v("classic", "#F8FAFC", "#FF2E63", "#08D9D6");
/** Paletele focului (flacără, jar), pe culori. */
const FIRE: Record<string, string[]> = {
  orange: ["#FFE066", "#FF8C00", "#E63946"],
  red: ["#FFD6A5", "#FF3B30", "#7F1D1D"],
  blue: ["#E0F2FE", "#38BDF8", "#1D4ED8"],
  green: ["#ECFCCB", "#84CC16", "#166534"],
  purple: ["#F5D0FE", "#C026D3", "#581C87"],
  pink: ["#FFE4F2", "#FF4FA3", "#9D174D"],
  cyan: ["#E0FFFF", "#22D3EE", "#155E75"],
  gold: ["#FFF7D6", "#FFC300", "#B45309"],
};
const fire = (...keys: string[]) => keys.map((key) => v(key, ...FIRE[key]!));

/**
 * Categoria „Efecte text” (catalogul 3): efecte noi ale GCS, cele mai multe adaptate dintr-o bibliotecă de efecte text
 * CSS cu licență MIT (creditul e în `THIRD-PARTY-NOTICES.md`, nu în interfață). Cheile au prefixul `tx_`.
 */
const TEXT = "Efecte text";
const tx = (effect: Effect, name: string, variants: { key: string; colors: string[] }[], extra: Partial<NameDef> = {}): NameDef => ({ key: `tx_${effect}`, name, category: TEXT, effect, variants, ...extra });
const TEXT_STYLES: NameDef[] = [
  tx("obsidian", "Oglindă neagră", singles("white", "red", "cyan", "gold", "purple", "green", "blue", "pink")),
  tx("cameleon", "Cameleon", singles("green", "cyan", "pink", "gold", "purple", "red")),
  tx("sclipire", "Sclipire în cruce", singles("gold", "white", "cyan", "pink", "purple", "blue", "green", "red")),
  tx("glitch_scan", "Glitch scanat", [CLASSIC, ...pal("cyan", "green", "red", "purple", "gold", "pink", "white")]),
  tx("magnetic", "Magnetic", pal(...STD)),
  tx("vid", "Vid", singles("purple", "red", "cyan", "green", "blue", "pink", "gold", "orange")),
  tx("unda", "Undă de lumină", pal(...STD)),
  tx("val_litere", "Val de litere", pal(...STD)),
  tx("boreal", "Boreal", [v("cyan", "#00F5A0", "#00D9F5", "#7B2FF7"), ...pal("pink", "gold", "green", "purple", "red", "blue", "orange", "white")]),
  tx("lichid", "Lichid", pal("cyan", "blue", "green", "pink", "purple", "gold", "red", "orange", "white")),
  tx("scaner", "Scaner", pal("red", "cyan", "green", "gold", "purple", "pink", "blue", "white")),
  tx("jar", "Jar mocnit", fire("orange", "red", "blue", "green", "purple", "pink", "cyan", "gold")),
  tx("ecou", "Ecou", [v("pink", "#F8FAFC", "#FF4FD8", "#4FF8FF"), ...pal("cyan", "gold", "green", "purple", "red", "blue", "orange", "white")]),
  tx("feliat", "Feliat", [CLASSIC, ...pal(...STD.filter((k) => k !== "rainbow"))]),
  tx("tremur", "Tremur", pal(...STD)),
  tx("anaglif", "Anaglif 3D", [v("classic", "#F8FAFC", "#FF3355", "#33DDFF"), ...pal("pink", "gold", "green", "purple", "blue", "orange")]),
  tx("fosfor", "Fosfor", pal("green", "cyan", "gold", "orange", "red", "pink", "purple", "white")),
  tx("reflector", "Reflector", pal(...STD)),
  tx("elastic", "Elastic", pal(...STD)),
  tx("puls_cardiac", "Puls cardiac", pal("red", "pink", "purple", "cyan", "gold", "green", "blue", "orange", "white")),
  tx("marker", "Marker", pal("gold", "pink", "cyan", "green", "purple", "orange", "red", "blue")),
  tx("cadran", "Cadran solar", pal("orange", "gold", "red", "pink", "purple", "blue", "cyan", "green", "white")),
  tx("negativ", "Negativ", pal("white", "cyan", "pink", "gold", "green", "purple", "red")),
  tx("holograma", "Hologramă", [v("cyan", "#E0FFFF", "#FF4FD8", "#4FF8FF"), ...pal("pink", "gold", "green", "purple", "blue", "red", "white")]),
  tx("folie", "Folie aurie", [v("gold", "#F2C15D", "#FFF4B8", "#7A4A08"), v("white", "#E2E8F0", "#F8FAFC", "#475569"), v("pink", "#F4C4B4", "#FFE4E6", "#9F4F5B"), v("orange", "#E7A86B", "#FFE2C2", "#8C4A1E"), ...pal("green", "blue", "purple", "red")]),
  tx("pixeli", "Pixeli", [CLASSIC, ...pal("cyan", "pink", "gold", "green", "purple", "red", "white")]),
  tx("praf_stele", "Praf de stele", pal("purple", "blue", "cyan", "pink", "gold", "green", "red", "white", "rainbow")),
  tx("vapori", "Vapori", [v("pink", "#F8FAFC", "#FF71CE", "#01CDFE"), ...pal("cyan", "gold", "green", "purple", "red", "blue", "orange", "white")]),
  tx("plasa", "Plasă de lumină", pal("pink", "cyan", "purple", "gold", "green", "blue", "red", "orange", "rainbow")),
  tx("irizat", "Irizat", pal("pink", "cyan", "purple", "gold", "green", "blue", "white", "rainbow")),
  tx("sticla", "Sticlă", pal("white", "cyan", "blue", "pink", "purple", "green", "gold", "red")),
  tx("flux_date", "Flux de date", pal("green", "cyan", "blue", "purple", "pink", "gold", "red", "orange", "rainbow")),
  tx("prisma", "Prismă", [CLASSIC, ...pal("cyan", "pink", "gold", "green", "purple", "red", "blue")]),
  tx("laser", "Laser", pal("red", "cyan", "green", "pink", "purple", "gold", "blue", "orange", "white")),
  tx("microcip", "Microcip", pal("green", "cyan", "gold", "blue", "purple", "pink", "red", "orange")),
  tx("termic", "Termic", pal("gold", "pink", "cyan", "purple", "green", "red")),
  tx("semnal", "Semnal", [CLASSIC, ...pal("cyan", "green", "red", "purple", "gold", "pink", "white")]),
  tx("portal", "Portal", pal("purple", "pink", "cyan", "gold", "green", "blue", "red", "orange", "rainbow")),
  tx("duoton", "Duoton", [CLASSIC, ...pal("pink", "cyan", "gold", "green", "purple", "blue", "orange")]),
  tx("eclipsa", "Eclipsă", pal("gold", "orange", "red", "purple", "cyan", "pink", "green", "blue", "white")),
  tx("voal", "Voal de lumină", pal("orange", "pink", "gold", "cyan", "purple", "green", "red", "blue")),
  tx("marmura", "Marmură", [v("white", "#64748B", "#94A3B8", "#475569"), ...pal("gold", "pink", "cyan", "green", "purple", "blue", "red")]),
  tx("unde", "Unde", pal("cyan", "blue", "green", "purple", "pink", "gold", "red", "white")),
  tx("fantoma", "Scriere fantomă", pal("white", "cyan", "purple", "pink", "gold", "green", "blue", "red")),
  tx("lenticular", "Lenticular", pal("pink", "cyan", "purple", "gold", "green", "blue", "red", "rainbow")),
  tx("caustic", "Lumini subacvatice", pal("cyan", "blue", "green", "purple", "pink", "gold", "white")),
  tx("focus", "Focalizare", pal(...STD)),
  tx("spectru", "Spectru", pal("rainbow", "pink", "cyan", "gold", "green", "purple", "red", "blue", "orange", "white")),
  tx("pop", "Pop", pal(...STD)),
  tx("topire", "Topire", pal("orange", "red", "pink", "purple", "cyan", "gold", "green", "blue", "white")),
  tx("cinetic", "Cinetic", pal(...STD)),
  tx("orbite", "Orbite", pal(...STD)),
  tx("paralaxa", "Paralaxă", [CLASSIC, ...pal("pink", "cyan", "gold", "green", "purple", "red", "blue", "orange")]),
  tx("ploaie_litere", "Ploaie de litere", pal("green", "cyan", "purple", "pink", "gold", "red", "blue", "white")),
  tx("zootrop", "Zootrop", pal(...STD)),
  tx("pendul", "Pendul", pal(...STD)),
  tx("fum", "Fum", pal("white", "purple", "cyan", "pink", "gold", "green", "red", "blue")),
  tx("kilovolt", "Kilovolt", pal("cyan", "blue", "purple", "gold", "green", "pink", "red", "white")),
  tx("spargere", "Spargere", pal(...STD)),
  tx("karaoke", "Karaoke", pal("pink", "cyan", "gold", "green", "purple", "red", "blue", "orange", "rainbow")),
  tx("retro", "Retro 70", [v("orange", "#FFE6BD", "#F6B33D", "#B23A28"), ...pal("pink", "cyan", "gold", "green", "purple", "red", "blue")]),
  tx("mercur", "Mercur", [v("white", "#F4F7FF", "#94A3B8", "#475569"), ...pal("gold", "cyan", "pink", "purple", "green", "blue", "red")]),
];

/**
 * Catalogul 3: variantele care lipseau din stilurile cu bandă de culori, ca fiecare să ofere setul obișnuit acolo unde
 * are sens (albastru, cyan, auriu, verde, portocaliu, roz, mov, roșu, alb, curcubeu). Variantele existente rămân la
 * fel (alegerile membrilor rămân valabile); cele noi se adaugă la final.
 */
const MORE_VARIANTS: Record<string, string[]> = {
  respiratie: ["rainbow"],
  lumini_oras: ["purple", "green", "red"],
  aura_palida: ["purple", "green", "red", "blue", "orange"],
  flacara_vie: ["red", "pink", "cyan", "gold"],
  infern: ["red", "pink", "cyan", "gold"],
  aur_curat: ["red", "blue", "purple", "green"],
  crom_lustruit: ["cyan", "purple", "pink", "orange"],
  relief_3d: ["red", "purple", "pink", "orange", "blue"],
  contur_viu: ["green", "purple", "pink", "rainbow"],
  glitch_rgb: ["red", "blue", "purple", "pink", "cyan"],
  digital: ["blue", "purple", "orange", "pink"],
  masina_de_scris: ["cyan", "red", "pink", "purple", "orange", "blue"],
  scanare: ["gold", "white", "pink", "orange", "blue", "rainbow"],
  ploaie_digitala: ["purple", "gold", "blue", "pink", "white"],
  oglinda_sparta: ["gold", "green", "pink", "orange", "blue"],
  taietura: ["green", "purple", "pink", "white", "blue", "orange"],
  tinta: ["gold", "purple", "blue", "white", "pink", "orange"],
  holografic: ["cyan", "gold"],
  raza_verticala: ["cyan", "blue", "pink", "white", "orange", "rainbow"],
  licar: ["red", "green", "purple", "blue", "orange"],
  reflex: ["red", "green", "purple", "blue", "orange"],
  cosmic: ["cyan", "gold", "green", "red"],
  plasma_vie: ["blue", "purple", "red", "cyan", "rainbow"],
  fulger: ["red", "green", "pink", "orange", "rainbow"],
  umbre_dansante: ["red", "blue", "purple", "pink", "cyan"],
  val_dragoste: ["gold", "orange"],
  acid: ["cyan", "pink", "red", "gold"],
  ger_cristal: ["blue", "pink", "green", "gold"],
};

/** Un stil cu variantele care îi lipseau (o culoare pentru efectele cu o culoare, paleta pentru celelalte). */
function withMoreVariants(def: NameDef): NameDef {
  const more = MORE_VARIANTS[def.key];
  if (!more || !def.variants) return def;
  const have = new Set(def.variants.map((x) => x.key));
  const single = def.variants.every((x) => x.colors.length === 1);
  const fiery = def.effect === "fire" || def.effect === "inferno";
  const add = more.filter((k) => !have.has(k)).map((k) => (single ? singles(k)[0]! : fiery && FIRE[k] ? fire(k)[0]! : pal(k)[0]!));
  return { ...def, variants: [...def.variants, ...add] };
}

/** Stilurile catalogului 2 (înainte de variantele adăugate): ce se compară la actualizare. */
export const V2_NAME_STYLES: ReadonlyMap<string, NameDef> = new Map<string, NameDef>();

/** Catalogul 3: stilurile de dinainte, cu variantele adăugate, apoi „Efecte text”. */
for (const def of NAME_STYLES_V2) if (MORE_VARIANTS[def.key]) (V2_NAME_STYLES as Map<string, NameDef>).set(def.key, def);
const NAME_STYLES: NameDef[] = [...NAME_STYLES_V2.map(withMoreVariants), ...TEXT_STYLES];

/**
 * Unde merg alegerile membrilor de pe stilurile versiunii 1: stilul nou cel mai apropiat și, opțional, varianta (altfel
 * aceeași cheie de variantă, dacă există, sau prima).
 */
export const LEGACY_NAME_MAP: Record<string, { to: string; variant?: string; variants?: Record<string, string> }> = {
  neon: { to: "neon_tub" },
  pulse: { to: "respiratie" },
  duo: { to: "gradient_duo" },
  wave: { to: "culori_in_miscare" },
  chrome: { to: "crom_lustruit", variants: { cyan: "blue", purple: "blue" } },
  scanline: { to: "scanare", variants: { gold: "cyan", white: "cyan" } },
  glitch: { to: "glitch_rgb", variants: { classic: "white", toxic: "green", sunset: "orange" } },
  flame: { to: "flacara_vie" },
  terminal: { to: "digital" },
  solid: { to: "culoare_plina" },
  ember: { to: "culoare_plina", variant: "orange" },
  frost: { to: "ger_cristal", variant: "cyan" },
  venom: { to: "culoare_plina", variant: "green" },
  royal: { to: "culoare_plina", variant: "purple" },
  blossom: { to: "culoare_plina", variant: "pink" },
  ivory: { to: "culoare_plina", variant: "white" },
  amber: { to: "culoare_plina", variant: "gold" },
  abyss: { to: "turcoaz_neon" },
  sunset: { to: "apus_cald" },
  ocean: { to: "ocean_adanc" },
  mint: { to: "gradient_duo", variant: "green" },
  peach: { to: "gradient_duo", variant: "orange" },
  dusk: { to: "gradient_duo", variant: "blue" },
  berry: { to: "gradient_duo", variant: "purple" },
  citrus: { to: "gradient_duo", variant: "gold" },
  lagoon: { to: "ocean_adanc" },
  rose_gold: { to: "aur_curat", variant: "orange" },
  steel: { to: "crom_lustruit", variant: "white" },
  candy: { to: "gradient_duo", variant: "pink" },
  jungle: { to: "gradient_duo", variant: "green" },
  aurora: { to: "aurora_boreala" },
  plasma: { to: "plasma_vie" },
  lava: { to: "jar_curgator" },
  nebula: { to: "cosmic" },
  holo: { to: "holografic" },
  gold_rush: { to: "aur_curat", variant: "gold" },
  silver: { to: "crom_lustruit", variant: "white" },
  cyber: { to: "glitch_rgb" },
  matrix: { to: "ploaie_digitala", variant: "green" },
  ghost: { to: "aura_palida", variant: "white" },
  inferno: { to: "infern", variant: "orange" },
  toxic_glow: { to: "acid", variant: "green" },
  ice_neon: { to: "neon_tub", variant: "cyan" },
  vapor: { to: "lumini_oras" },
  galaxy: { to: "galaxie_vie" },
  sunrise: { to: "jar_curgator" },
  royal_flow: { to: "culori_in_miscare", variant: "purple" },
  emerald: { to: "crom_lustruit", variant: "green" },
  ruby: { to: "stacojiu" },
  storm: { to: "glitch_rgb" },
};

/** Datele unei definiții de stil de nume (aceeași formă pentru catalogul nou și pentru cel vechi). */
export function nameStyleData(s: NameDef): Record<string, unknown> {
  return {
    effect: s.effect ?? "none",
    variants: s.variants ?? [{ key: "default", colors: s.colors! }],
    angle: s.angle ?? 90,
    animation: "none",
    speed: s.speed ?? "normal",
    bold: true,
    italic: s.italic === true,
  };
}

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
    out.push({ kind: "name_style", key: s.key, name: s.name, ...(s.category ? { category: s.category } : {}), data: nameStyleData(s), ...(s.plans ? { plans: s.plans } : {}) });
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
