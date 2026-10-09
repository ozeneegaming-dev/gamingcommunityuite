/**
 * Modelul Studioului VIP: cataloagele (tipurile de elemente și datele lor validate), alegerile membrului și regulile de
 * acces. Tot ce ajunge în HTML sau în aspectul publicat trece pe aici: culori `#RRGGBB`, chei din liste albe, numere în
 * intervale, texte simple și fișiere doar ale pluginului. Fără CSS sau HTML scris de admin.
 */
export const PLUGIN_KEY = "gcs.vip_studio";
export const ASSET_BASE = `/plugins/${PLUGIN_KEY}/assets`;

export const KINDS = ["name_style", "banner", "frame", "card", "weapon", "background", "theme", "song"] as const;
export type Kind = (typeof KINDS)[number];
/** Cataloagele cu categorii (filtrele din studio). */
export const CATEGORY_KINDS = ["name_style", "frame", "card", "weapon", "background"] as const satisfies readonly Kind[];
/** Cataloagele cu încărcare în bloc din ACP („Încarcă de pe calculator”, mai multe fișiere odată). */
export const BULK_KINDS = ["frame", "weapon", "card"] as const satisfies readonly Kind[];
export type BulkKind = (typeof BULK_KINDS)[number];
/** Cataloagele cu stiluri CSS scrise de admin (verificate și închise de GCS). */
export const CSS_KINDS = ["name_style", "banner"] as const satisfies readonly Kind[];
/** Cataloagele cu fișiere (o lipsă le face „retrase”). */
export const MEDIA_KINDS = ["frame", "card", "weapon", "background", "song"] as const satisfies readonly Kind[];

/**
 * Efectele numelui (lista albă a GCS ≥ 0.8.0, inclusiv categoria „Efecte text”; CSS-ul lor e în GCS, aici doar
 * cheile). Efectele pe litere (`TEXT_LETTER_EFFECTS`) le desenează GCS pe literele numelui.
 */
export const EFFECTS = [
  "none",
  "gradient",
  "shimmer",
  "pulse",
  "neon",
  "glitch",
  "scan",
  "chrome",
  "fire",
  "holo",
  "caret",
  "inferno",
  "typewriter",
  "reveal",
  "shatter",
  "citylights",
  "cosmic",
  "crosshair",
  "love",
  "electric",
  "mirror",
  "lightning",
  "money",
  "razor",
  "shadowdance",
  "toxic",
  "vscan",
  "gold",
  "aura",
  "matrix",
  "frost",
  "plasma",
  "outline",
  "extrude",
  // Efecte text (GCS 0.8.0).
  "boreal",
  "cameleon",
  "lichid",
  "obsidian",
  "sclipire",
  "glitch_scan",
  "vid",
  "scaner",
  "jar",
  "ecou",
  "feliat",
  "tremur",
  "anaglif",
  "fosfor",
  "reflector",
  "elastic",
  "puls_cardiac",
  "marker",
  "cadran",
  "negativ",
  "holograma",
  "folie",
  "pixeli",
  "praf_stele",
  "vapori",
  "plasa",
  "irizat",
  "sticla",
  "flux_date",
  "prisma",
  "laser",
  "microcip",
  "termic",
  "semnal",
  "portal",
  "duoton",
  "eclipsa",
  "voal",
  "marmura",
  "unde",
  "fantoma",
  "lenticular",
  "caustic",
  "magnetic",
  "val_litere",
  "unda",
  "focus",
  "spectru",
  "pop",
  "topire",
  "cinetic",
  "orbite",
  "paralaxa",
  "ploaie_litere",
  "zootrop",
  "pendul",
  "fum",
  "kilovolt",
  "spargere",
  "karaoke",
  "retro",
  "mercur",
] as const;
export type Effect = (typeof EFFECTS)[number];
export const ANIMATIONS = ["none", "flow", "pulse", "shine", "aurora"] as const;
export type Animation = (typeof ANIMATIONS)[number];
export const SPEEDS = ["slow", "normal", "fast"] as const;
export type Speed = (typeof SPEEDS)[number];

/** Variantele de culoare comune (banda de culori a unui stil de nume). */
export const VARIANTS: Record<string, string[]> = {
  red: ["#FF3B4E", "#B3122B"],
  blue: ["#4F8BFF", "#1E3A8A"],
  purple: ["#B57BFF", "#5B21B6"],
  cyan: ["#22D3EE", "#0E7490"],
  pink: ["#FF6FC8", "#BE185D"],
  gold: ["#FFD34D", "#B45309"],
  rainbow: ["#FF4D4D", "#FFB020", "#3DDC97", "#38BDF8", "#A78BFA"],
  green: ["#4ADE80", "#15803D"],
  orange: ["#FF9F43", "#C2410C"],
  white: ["#FFFFFF", "#A1A7B4"],
};
export const VARIANT_KEYS = Object.keys(VARIANTS);

export type Fill = { colors: string[]; angle: number; animation: Animation; speed: Speed };
export type Variant = { key: string; colors: string[]; glow?: string };
/** `custom`: stilul e CSS scris de admin (păstrat de GCS sub cheia elementului); variantele dau culoarea de bază. */
export type NameStyleData = { effect: Effect; variants: Variant[]; angle: number; animation: Animation; speed: Speed; bold: boolean; italic: boolean; custom?: true };
export type BannerData = { fill: Fill; text: string; custom?: true };
/** `hash`: SHA-256 al fișierului încărcat (duplicatele la încărcarea în bloc). */
export type FrameData = { image: string; scale: number; x: number; y: number; hash?: string };
export type CardData = { image: string; hash?: string };
export type WeaponData = { icon: string; hash?: string };
export type BackgroundData = { image: string; thumb?: string; video?: string };
export type ThemeData = { accent: string; accent2?: string; surface?: string; glow: boolean };
export type SongData = { title: string; artist: string; audio?: string; youtube?: string };

export type ItemData = {
  name_style: NameStyleData;
  banner: BannerData;
  frame: FrameData;
  card: CardData;
  weapon: WeaponData;
  background: BackgroundData;
  theme: ThemeData;
  song: SongData;
};

export type Item<K extends Kind = Kind> = {
  id: number;
  kind: K;
  key: string;
  name: string;
  categoryId: number | null;
  data: ItemData[K];
  /** Planurile (cheile grupurilor VIP) care au elementul; gol = toți VIP-ii. */
  plans: string[];
  enabled: boolean;
  /** Retras de admin sau cu fișierul lipsă: apare, dar nu se poate alege. */
  retired: boolean;
  position: number;
  mediaIds: string[];
  createdAt: string;
};

export type Category = { id: number; kind: Kind; name: string; position: number };

// ─── Validarea valorilor simple ──────────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
export const hex = (v: unknown): string | null => (isHex(v) ? v.toUpperCase() : null);

/** Text simplu: fără caractere de control sau de direcție, spațiile strânse; `null` dacă e gol sau prea lung. */
export function plainText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return t.length > 0 && [...t].length <= max ? t : null;
}

/** Un număr din formular sau JSON, în interval; altfel valoarea implicită. */
export function numberIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);

export const ITEM_KEY = /^[a-z0-9_]{2,40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const hashOf = (v: unknown): { hash?: string } => (typeof v === "string" && SHA256.test(v) ? { hash: v } : {});
export const PLAN_KEY = /^[a-z][a-z0-9_]{0,39}$/;

const MEDIA_URL = new RegExp(`^/plugins/${PLUGIN_KEY.replace(".", "\\.")}/media/([a-z0-9]{10,40})\\.(webp|png|jpg|gif|mp4|webm|mp3|ogg)$`);
const ASSET_URL = new RegExp(`^/plugins/${PLUGIN_KEY.replace(".", "\\.")}/assets/[a-z0-9_-]+(?:/[a-z0-9_-]+)*\\.(png|webp|jpg)$`);

/** Un fișier al pluginului: din pachet (`assets`) sau încărcat (`media`), de tipul cerut. */
export function mediaUrl(v: unknown, kind: "image" | "video" | "audio"): string | null {
  if (typeof v !== "string" || v.length > 200) return null;
  if (kind === "image") {
    if (ASSET_URL.test(v)) return v;
    const m = MEDIA_URL.exec(v);
    return m && ["webp", "png", "jpg", "gif"].includes(m[2]!) ? v : null;
  }
  const m = MEDIA_URL.exec(v);
  if (!m) return null;
  return (kind === "video" ? ["mp4", "webm"] : ["mp3", "ogg"]).includes(m[2]!) ? v : null;
}

/** Id-ul unui fișier încărcat, din adresa lui. */
export function mediaIdOf(url: string | undefined): string | null {
  return url ? (MEDIA_URL.exec(url)?.[1] ?? null) : null;
}

/** Id-ul unui video YouTube: id-ul simplu (11 caractere) sau un link youtube.com / youtu.be. */
export function youtubeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined = null;
  if (host === "youtu.be") id = parts[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) id = parts[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** Culoarea textului lizibilă peste o culoare de fundal (luminanța relativă). */
export function inkFor(bg: string): string {
  const n = Number.parseInt(bg.slice(1), 16);
  const ch = (s: number) => {
    const c = ((n >> s) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
  return lum > 0.45 ? "#0B0C10" : "#FFFFFF";
}

// ─── Datele elementelor ──────────────────────────────────────────────────────

export type DataResult<K extends Kind> = { ok: true; data: ItemData[K] } | { ok: false; field: string };

function colorList(raw: unknown, min: number, max: number): string[] | null {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/).filter(Boolean) : [];
  const colors = list.map(hex);
  if (colors.length < min || colors.length > max || colors.some((c) => c === null)) return null;
  return colors as string[];
}

function fillOf(raw: unknown): Fill | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const colors = colorList(r.colors, 1, 5);
  if (!colors) return null;
  return { colors, angle: numberIn(r.angle, 0, 360, 90), animation: oneOf(r.animation, ANIMATIONS, "none"), speed: oneOf(r.speed, SPEEDS, "normal") };
}

/**
 * Validează datele unui element după tipul lui. Întoarce forma normalizată sau câmpul greșit. Fișierele trebuie să fie
 * ale pluginului (din pachet sau încărcate).
 */
export function parseItemData<K extends Kind>(kind: K, raw: unknown): DataResult<K> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ok = <T extends ItemData[K]>(data: T): DataResult<K> => ({ ok: true, data });
  switch (kind) {
    case "name_style": {
      const variantsRaw = Array.isArray(r.variants) ? r.variants : [];
      const variants: Variant[] = [];
      for (const v of variantsRaw.slice(0, 12)) {
        const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
        const key = typeof o.key === "string" && /^[a-z0-9_]{1,20}$/.test(o.key) ? o.key : null;
        const colors = colorList(o.colors, 1, 5);
        if (!key || !colors || variants.some((x) => x.key === key)) return { ok: false, field: "variants" };
        const glow = hex(o.glow);
        variants.push({ key, colors, ...(glow ? { glow } : {}) });
      }
      if (variants.length === 0) return { ok: false, field: "variants" };
      return ok({
        effect: oneOf(r.effect, EFFECTS, "none"),
        variants,
        angle: numberIn(r.angle, 0, 360, 90),
        animation: oneOf(r.animation, ANIMATIONS, "none"),
        speed: oneOf(r.speed, SPEEDS, "normal"),
        bold: r.bold !== false,
        italic: r.italic === true,
        ...(r.custom === true ? { custom: true } : {}),
      } as NameStyleData as ItemData[K]);
    }
    case "banner": {
      const fill = fillOf(r.fill);
      if (!fill) return { ok: false, field: "colors" };
      return ok({ fill, text: hex(r.text) ?? inkFor(fill.colors[0]!), ...(r.custom === true ? { custom: true } : {}) } as BannerData as ItemData[K]);
    }
    case "frame": {
      const image = mediaUrl(r.image, "image");
      if (!image) return { ok: false, field: "image" };
      return ok({ image, scale: numberIn(r.scale, 100, 160, 130), x: numberIn(r.x, -20, 20, 0), y: numberIn(r.y, -20, 20, 0), ...hashOf(r.hash) } as FrameData as ItemData[K]);
    }
    case "card": {
      const image = mediaUrl(r.image, "image");
      return image ? ok({ image, ...hashOf(r.hash) } as CardData as ItemData[K]) : { ok: false, field: "image" };
    }
    case "weapon": {
      const icon = mediaUrl(r.icon, "image");
      return icon ? ok({ icon, ...hashOf(r.hash) } as WeaponData as ItemData[K]) : { ok: false, field: "image" };
    }
    case "background": {
      const image = mediaUrl(r.image, "image");
      if (!image) return { ok: false, field: "image" };
      const thumb = r.thumb === undefined ? null : mediaUrl(r.thumb, "image");
      const video = r.video === undefined || r.video === "" ? null : mediaUrl(r.video, "video");
      if (r.video !== undefined && r.video !== "" && !video) return { ok: false, field: "video" };
      return ok({ image, ...(thumb ? { thumb } : {}), ...(video ? { video } : {}) } as BackgroundData as ItemData[K]);
    }
    case "theme": {
      const accent = hex(r.accent);
      if (!accent) return { ok: false, field: "accent" };
      const accent2 = hex(r.accent2);
      const surface = hex(r.surface);
      return ok({ accent, ...(accent2 ? { accent2 } : {}), ...(surface ? { surface } : {}), glow: r.glow === true } as ThemeData as ItemData[K]);
    }
    case "song": {
      const title = plainText(r.title, 80);
      if (!title) return { ok: false, field: "title" };
      const audio = r.audio === undefined || r.audio === "" ? null : mediaUrl(r.audio, "audio");
      if (r.audio !== undefined && r.audio !== "" && !audio) return { ok: false, field: "audio" };
      const yt = r.youtube === undefined || r.youtube === "" ? null : youtubeId(r.youtube);
      if (r.youtube !== undefined && r.youtube !== "" && !yt) return { ok: false, field: "youtube" };
      if (!audio && !yt) return { ok: false, field: "audio" };
      return ok({ title, artist: plainText(r.artist, 80) ?? "", ...(audio ? { audio } : {}), ...(yt ? { youtube: yt } : {}) } as SongData as ItemData[K]);
    }
    default:
      return { ok: false, field: "kind" };
  }
}

/** Fișierele încărcate de care depinde un element (pentru „retras” când lipsesc și pentru ștergere). */
export function mediaIdsOf(kind: Kind, data: ItemData[Kind]): string[] {
  const urls: (string | undefined)[] = [];
  if (kind === "frame") urls.push((data as FrameData).image);
  if (kind === "card") urls.push((data as CardData).image);
  if (kind === "weapon") urls.push((data as WeaponData).icon);
  if (kind === "background") urls.push((data as BackgroundData).image, (data as BackgroundData).thumb, (data as BackgroundData).video);
  if (kind === "song") urls.push((data as SongData).audio);
  return [...new Set(urls.map(mediaIdOf).filter((id): id is string => id !== null))];
}

/**
 * Numele unui element din numele fișierului încărcat: fără extensie și fără sufixele de copie („ - Copie”, „(2)”),
 * cu spații în loc de `_` / `-`. Un cuvânt scurt cu cifre sau de cel mult 3 litere devine majuscule („ak47” → „AK47”,
 * „awp” → „AWP”), altfel prima literă mare („deagle” → „Deagle”). Numele care arată ca un hash (hex lung) devin
 * `fallback` (ex. „Ramă 12”). Cel mult 40 de caractere; adminul îl poate schimba oricând.
 */
export function nameFromFile(file: string | undefined, fallback: string): string {
  const base = (file ?? "")
    .replace(/\.[A-Za-z0-9]{2,5}$/, "")
    .replace(/\s*(?:-\s*(?:copie|copy|kopie)(?:\s*\(\d+\))?|\(\d+\))\s*$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base || /^[0-9a-f]{16,}$/i.test(base.replace(/\s/g, ""))) return fallback;
  // Doar codurile scrise cu litere mici („ak47”, „awp”); un nume cu majuscule proprii rămâne cum e.
  const pretty = /^[a-z0-9]+$/.test(base) && (/\d/.test(base) || base.length <= 3) ? base.toUpperCase() : base.charAt(0).toUpperCase() + base.slice(1);
  return plainText([...pretty].slice(0, 40).join(""), 40) ?? fallback;
}

/** O cheie nouă pentru un element creat din ACP: din nume, plus un sufix scurt. */
export function itemKeyFrom(name: string, suffix: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return `${slug || "item"}_${suffix}`.slice(0, 40);
}

// ─── Accesul ─────────────────────────────────────────────────────────────────

/** Ce poate folosi membrul acum: VIP (cu planul), modul de test (Root/Admin) sau nimic. */
export type Access = { vip: boolean; plan: string | null; planName: string | null; testAll: boolean };

/** Elementul se poate alege (activ, nu e retras, cu fișierul la locul lui). */
export const isAvailable = (item: Item) => item.enabled && !item.retired;

/** Planul membrului îl are (lista goală = toți VIP-ii); modul de test le are pe toate. */
export function planAllows(item: Item, access: Access): boolean {
  if (access.testAll) return true;
  if (!access.vip) return false;
  return item.plans.length === 0 || (access.plan !== null && item.plans.includes(access.plan));
}

/** Nou: adăugat în ultimele `days` zile. */
export function isNew(item: Item, days: number, now = Date.now()): boolean {
  return days > 0 && now - Date.parse(item.createdAt) < days * 86_400_000;
}
