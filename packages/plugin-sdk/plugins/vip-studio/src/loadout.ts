/**
 * Echipamentul unui membru: alegerile din studio (citite din formular), validarea lor față de catalog și plan și aspectul
 * publicat în GCS (`ctx.members.appearance.set`).
 */
import type { GcsMemberAppearance } from "../../../src/index";
import {
  isAvailable,
  mediaUrl,
  numberIn,
  planAllows,
  plainText,
  youtubeId,
  type Access,
  type BackgroundData,
  type BannerData,
  type CardData,
  type FrameData,
  type Item,
  type Kind,
  type NameStyleData,
  type SongData,
  type ThemeData,
  type WeaponData,
} from "./model";

export const QUOTE_MAX = 200;
export const LABEL_MAX = 24;

/** Melodia proprie (link YouTube sau fișier încărcat), când nu e aleasă din catalog. */
export type CustomSong = { title: string; youtube?: string; audio?: string; audioId?: string };

export type Loadout = {
  nameStyle?: string;
  nameVariant?: string;
  frame?: string;
  banner?: string;
  bannerLabel?: string;
  card?: string;
  cardX?: number;
  cardY?: number;
  weapon?: string;
  background?: string;
  quote?: string;
  theme?: string;
  /** Cheia din catalog sau `custom`. */
  song?: string;
  customSong?: CustomSong;
  songAutoplay?: boolean;
};

/** Grupurile de alegeri (numărătoarea „N modificări nesalvate” și erorile pe tab-uri). */
export const GROUPS = ["name", "frame", "banner", "card", "weapon", "background", "quote", "theme", "song"] as const;
export type Group = (typeof GROUPS)[number];

/** Catalogul pe tipuri, după cheie. */
export type Catalog = { [K in Kind]: Map<string, Item<K>> };

export function catalogOf(items: Item[]): Catalog {
  const out = { name_style: new Map(), banner: new Map(), frame: new Map(), card: new Map(), weapon: new Map(), background: new Map(), theme: new Map(), song: new Map() } as Catalog;
  for (const item of items) (out[item.kind] as Map<string, Item>).set(item.key, item);
  return out;
}

const key = (v: unknown) => (typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v) ? v : undefined);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/**
 * Alegerile din corpul formularului (sau JSON). Câmpurile goale înseamnă „implicit”. Fișierul melodiei proprii vine
 * deja verificat de GCS (`{ id, kind, url }`) sau ca eroare (`{ error }`).
 */
export function readLoadoutForm(body: Record<string, unknown>, previous: Loadout): { loadout: Loadout; uploadError: string | null } {
  const l: Loadout = {};
  const nameStyle = key(first(body.nameStyle));
  if (nameStyle) {
    l.nameStyle = nameStyle;
    // Varianta vine ca `<stil>:<variantă>`; doar cea a stilului ales contează.
    const variants = (Array.isArray(body.nameVariant) ? body.nameVariant : [body.nameVariant]).filter((v): v is string => typeof v === "string");
    const match = variants.map((v) => v.split(":")).find(([s, v]) => s === nameStyle && v && /^[a-z0-9_]{1,20}$/.test(v));
    if (match) l.nameVariant = match[1];
  }
  for (const field of ["frame", "banner", "card", "weapon", "background", "theme", "song"] as const) {
    const v = key(first(body[field]));
    if (v) l[field] = v;
  }
  const label = plainText(first(body.bannerLabel), LABEL_MAX);
  if (label) l.bannerLabel = label;
  if (l.card) {
    l.cardX = numberIn(first(body.cardX), 0, 100, 50);
    l.cardY = numberIn(first(body.cardY), 0, 100, 50);
  }
  const quote = typeof first(body.quote) === "string" ? (first(body.quote) as string).replace(/\r\n?/g, "\n") : "";
  const quoteText = plainText(quote, QUOTE_MAX);
  if (quoteText) l.quote = quoteText;
  l.songAutoplay = ["1", "on", "true"].includes(String(first(body.songAutoplay) ?? ""));
  let uploadError: string | null = null;
  if (l.song === "custom") {
    const title = plainText(first(body.songTitle), 80) ?? "";
    const yt = typeof first(body.songYoutube) === "string" && (first(body.songYoutube) as string).trim() !== "" ? youtubeId(first(body.songYoutube)) : null;
    const file = first(body.songFile);
    let audio: string | undefined;
    let audioId: string | undefined;
    if (file && typeof file === "object") {
      const f = file as { id?: unknown; kind?: unknown; url?: unknown; error?: unknown };
      if (typeof f.error === "string") uploadError = f.error;
      else if (f.kind === "audio" && typeof f.id === "string" && mediaUrl(f.url, "audio")) {
        audio = f.url as string;
        audioId = f.id;
      } else uploadError = "unsupported_type";
    } else if (previous.customSong?.audio && first(body.songKeepAudio) === "1") {
      audio = previous.customSong.audio;
      audioId = previous.customSong.audioId;
    }
    if (typeof first(body.songYoutube) === "string" && (first(body.songYoutube) as string).trim() !== "" && !yt) uploadError ??= "youtube_invalid";
    l.customSong = { title: title || "", ...(yt ? { youtube: yt } : {}), ...(audio ? { audio, audioId } : {}) };
  }
  return { loadout: l, uploadError };
}

export type Problem = { group: Group; code: "locked" | "unavailable" | "invalid"; plans?: string[] };

const GROUP_OF: Record<Kind, Group> = { name_style: "name", frame: "frame", banner: "banner", card: "card", weapon: "weapon", background: "background", theme: "theme", song: "song" };

/**
 * Verifică alegerile față de catalog și de accesul membrului: fiecare element trebuie să existe, să fie disponibil și
 * permis planului. Întoarce echipamentul curățat (fără alegerile invalide) și problemele, pe grupuri.
 */
export function checkLoadout(l: Loadout, catalog: Catalog, access: Access, opts: { allowCustomSong: { youtube: boolean; upload: boolean } }): { loadout: Loadout; problems: Problem[] } {
  const problems: Problem[] = [];
  const out: Loadout = { ...l };
  const check = (kind: Kind, field: "nameStyle" | "frame" | "banner" | "card" | "weapon" | "background" | "theme" | "song") => {
    const k = out[field];
    if (!k || (field === "song" && k === "custom")) return;
    const item = catalog[kind].get(k) as Item | undefined;
    if (!item || !isAvailable(item)) {
      problems.push({ group: GROUP_OF[kind], code: "unavailable" });
      delete out[field];
    } else if (!planAllows(item, access)) {
      problems.push({ group: GROUP_OF[kind], code: "locked", plans: item.plans });
    }
  };
  check("name_style", "nameStyle");
  check("frame", "frame");
  check("banner", "banner");
  check("card", "card");
  check("weapon", "weapon");
  check("background", "background");
  check("theme", "theme");
  check("song", "song");
  if (out.nameStyle) {
    const style = catalog.name_style.get(out.nameStyle);
    if (style && !style.data.variants.some((v) => v.key === out.nameVariant)) out.nameVariant = style.data.variants[0]!.key;
  } else delete out.nameVariant;
  if (!out.card) {
    delete out.cardX;
    delete out.cardY;
  }
  if (out.song === "custom") {
    const c = out.customSong;
    const youtube = opts.allowCustomSong.youtube ? c?.youtube : undefined;
    const audio = opts.allowCustomSong.upload ? c?.audio : undefined;
    if (!c || (!youtube && !audio)) {
      problems.push({ group: "song", code: "invalid" });
      delete out.song;
      delete out.customSong;
    } else {
      out.customSong = { title: c.title, ...(youtube ? { youtube } : {}), ...(audio ? { audio, audioId: c.audioId! } : {}) };
      // O melodie proprie e un element VIP ca oricare altul.
      if (!access.testAll && !access.vip) problems.push({ group: "song", code: "locked", plans: [] });
    }
  } else delete out.customSong;
  if (!out.song) delete out.songAutoplay;
  if (out.quote && !access.testAll && !access.vip) problems.push({ group: "quote", code: "locked", plans: [] });
  if (out.bannerLabel && !access.testAll && !access.vip) problems.push({ group: "banner", code: "locked", plans: [] });
  return { loadout: out, problems };
}

/** Câte grupuri diferă între două echipamente (numărătoarea modificărilor). */
export function changedGroups(a: Loadout, b: Loadout): Group[] {
  const pick: Record<Group, (l: Loadout) => unknown> = {
    name: (l) => [l.nameStyle, l.nameVariant],
    frame: (l) => l.frame,
    banner: (l) => [l.banner, l.bannerLabel],
    card: (l) => [l.card, l.cardX, l.cardY],
    weapon: (l) => l.weapon,
    background: (l) => l.background,
    quote: (l) => l.quote ?? "",
    theme: (l) => l.theme,
    song: (l) => [l.song, l.customSong?.youtube, l.customSong?.audio, l.customSong?.title, l.song ? l.songAutoplay === true : false],
  };
  return GROUPS.filter((g) => JSON.stringify(pick[g](a) ?? null) !== JSON.stringify(pick[g](b) ?? null));
}

/** Eticheta implicită a banner-ului: numele planului (sau „VIP”). */
export const bannerLabelFor = (l: Loadout, access: Access) => l.bannerLabel ?? access.planName ?? "VIP";

/**
 * Aspectul publicat pentru un echipament. Elementele nepermise planului sau indisponibile lipsesc (GCS arată atunci
 * valorile implicite). `null` = nimic de publicat.
 */
export function toAppearance(l: Loadout, catalog: Catalog, access: Access): GcsMemberAppearance | null {
  if (!access.vip && !access.testAll) return null;
  const allowed = <K extends Kind>(kind: K, k: string | undefined): Item<K> | null => {
    if (!k) return null;
    const item = catalog[kind].get(k) as Item<K> | undefined;
    return item && isAvailable(item) && planAllows(item, access) ? item : null;
  };
  const a: GcsMemberAppearance = {};
  const style = allowed("name_style", l.nameStyle);
  if (style) {
    const d = style.data as NameStyleData;
    const variant = d.variants.find((v) => v.key === l.nameVariant) ?? d.variants[0]!;
    a.name = {
      fill: { colors: variant.colors, angle: d.angle, ...(d.animation !== "none" ? { animation: d.animation } : {}), ...(d.speed !== "normal" ? { speed: d.speed } : {}) },
      ...(d.effect !== "none" && !d.custom ? { effect: d.effect } : {}),
      ...(variant.glow ? { glow: variant.glow } : {}),
      bold: d.bold,
      ...(d.italic ? { italic: true } : {}),
      // Un stil CSS scris de admin: GCS pune clasa lui peste culoarea de bază.
      ...(d.custom ? { style: style.key } : {}),
    };
  }
  const banner = allowed("banner", l.banner);
  if (banner || l.bannerLabel) {
    // Doar eticheta proprie, fără preset: banner-ul cu culoarea accentului site-ului.
    const d = (banner?.data as BannerData | undefined) ?? { fill: { colors: ["#D62839"], angle: 90, animation: "none", speed: "normal" }, text: "#FFFFFF" };
    a.banner = {
      fill: { colors: d.fill.colors, angle: d.fill.angle, ...(d.fill.animation !== "none" ? { animation: d.fill.animation } : {}), ...(d.fill.speed !== "normal" ? { speed: d.fill.speed } : {}) },
      text: d.text,
      label: bannerLabelFor(l, access),
      ...(banner && d.custom ? { style: banner.key } : {}),
    };
  }
  const frame = allowed("frame", l.frame);
  if (frame) {
    const d = frame.data as FrameData;
    a.frame = { image: d.image, scale: d.scale, x: d.x, y: d.y };
  }
  const card = allowed("card", l.card);
  if (card) a.card = { image: (card.data as CardData).image, x: l.cardX ?? 50, y: l.cardY ?? 50, dim: 35 };
  const weapon = allowed("weapon", l.weapon);
  if (weapon) a.flair = { icon: (weapon.data as WeaponData).icon, label: weapon.name };
  const profile: NonNullable<GcsMemberAppearance["profile"]> = {};
  const bg = allowed("background", l.background);
  if (bg) {
    const d = bg.data as BackgroundData;
    profile.background = { image: d.image, ...(d.video ? { video: d.video } : {}), dim: 45 };
  }
  if (l.quote) profile.quote = { text: l.quote };
  const theme = allowed("theme", l.theme);
  if (theme) {
    const d = theme.data as ThemeData;
    profile.theme = { key: theme.key, accent: d.accent, ...(d.accent2 ? { accent2: d.accent2 } : {}), ...(d.surface ? { surface: d.surface } : {}), glow: d.glow };
  }
  if (l.song === "custom" && l.customSong && (l.customSong.youtube || l.customSong.audio)) {
    profile.song = {
      title: l.customSong.title || "♪",
      ...(l.customSong.audio ? { audio: l.customSong.audio } : {}),
      ...(l.customSong.youtube ? { youtube: l.customSong.youtube } : {}),
      autoplayMuted: l.songAutoplay === true,
    };
  } else {
    const song = allowed("song", l.song);
    if (song) {
      const d = song.data as SongData;
      profile.song = { title: d.title, ...(d.artist ? { artist: d.artist } : {}), ...(d.audio ? { audio: d.audio } : {}), ...(d.youtube ? { youtube: d.youtube } : {}), autoplayMuted: l.songAutoplay === true };
    }
  }
  if (Object.keys(profile).length > 0) a.profile = profile;
  return Object.keys(a).length > 0 ? a : null;
}
