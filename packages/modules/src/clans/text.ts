/**
 * Partea pură a clanurilor (fără Node, folosită și de paginile client): tagul, numele, linkurile, culorile și adresele
 * paginilor (specul 2026-10-08-clanuri §2, §9).
 */
import { slugify } from "../forums/slug";

export const GCS_TAG_CHARSETS = ["alnum", "alnum_symbols", "unicode"] as const;
export type GcsTagCharset = (typeof GCS_TAG_CHARSETS)[number];

/** Simbolurile permise în tag cu `alnum_symbols` (pe lângă literele latine și cifre). */
export const TAG_SYMBOLS = "-_.!?#*~^'";
const CHARSET_RE: Record<GcsTagCharset, RegExp> = {
  alnum: /^[A-Za-z0-9]+$/,
  alnum_symbols: /^[A-Za-z0-9\-_.!?#*~^']+$/,
  unicode: /^[\p{L}\p{N}]+$/u,
};

export const CLAN_NAME_MIN = 3;
export const CLAN_NAME_MAX = 40;
export const CLAN_MESSAGE_MAX = 500;
export const CLAN_LINK_MAX = 300;

/** Caracterele de control, de direcție (bidi) și invizibile: nu au ce căuta într-un tag sau într-un nume. */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;

/** Un rând de text curat: fără caractere invizibile sau de control, spațiile comprimate, fără spații la capete. */
export function cleanLine(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim() : "";
}

/** Un text pe mai multe rânduri (mesajul unei cereri): rândurile noi rămân, restul ca la `cleanLine`. */
export function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(INVISIBLE, "").replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const stripMarks = (s: string) => s.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");

/** Forma unică a tagului: fără diacritice, cu litere mari (`rlx` și `RLX` sunt același tag). */
export function normalizeTag(tag: string): string {
  return stripMarks(cleanLine(tag)).toUpperCase();
}

/** Forma unică a numelui: fără diacritice, cu litere mici, spațiile comprimate. */
export function normalizeClanName(name: string): string {
  return stripMarks(cleanLine(name)).toLowerCase();
}

/** Codul erorii tagului (cheie de traducere) sau `null`. Lungimea se numără în caractere, nu în octeți. */
export function tagError(tag: string, opts: { min: number; max: number; charset: GcsTagCharset }): string | null {
  if (!tag) return "required";
  const length = [...tag].length;
  if (length < opts.min) return "too_short";
  if (length > opts.max) return "too_long";
  return CHARSET_RE[opts.charset].test(tag) ? null : "invalid_chars";
}

export function nameError(name: string): string | null {
  if (!name) return "required";
  const length = [...name].length;
  if (length < CLAN_NAME_MIN) return "too_short";
  return length > CLAN_NAME_MAX ? "too_long" : null;
}

/** Slug-ul numelui (un nume fără litere latine primește „clan”). */
export function clanSlug(name: string): string {
  const slug = slugify(name);
  return slug === "topic" && !/topic/i.test(name) ? "clan" : slug;
}

export const clanHref = (c: { id: number; slug: string }) => `/clans/${c.id}-${c.slug}`;

export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v);

/** Luminanța relativă (WCAG) a unei culori `#RRGGBB`. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Textul plăcuței tagului pe culoarea clanului: albul sau aproape-negrul, cel cu contrastul mai mare. */
export function tagInk(color: string): "#FFFFFF" | "#0B0C10" {
  if (!isHexColor(color)) return "#FFFFFF";
  const l = luminance(color);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (luminance("#0B0C10") + 0.05);
  return onWhite >= onDark ? "#FFFFFF" : "#0B0C10";
}

export const CLAN_LINK_KINDS = ["discord", "steam", "website", "youtube", "twitch"] as const;
export type GcsClanLinkKind = (typeof CLAN_LINK_KINDS)[number];
export type GcsClanLinks = Partial<Record<GcsClanLinkKind, string>>;

/** Host-urile permise pe fiecare tip de link (fără `website`, care acceptă orice adresă https). */
const LINK_RULES: Record<Exclude<GcsClanLinkKind, "website">, (u: URL) => boolean> = {
  discord: (u) =>
    (u.hostname === "discord.gg" && /^\/[A-Za-z0-9-]{2,64}\/?$/.test(u.pathname)) ||
    (["discord.com", "www.discord.com", "discordapp.com", "www.discordapp.com"].includes(u.hostname) && /^\/invite\/[A-Za-z0-9-]{2,64}\/?$/.test(u.pathname)),
  steam: (u) => u.hostname === "steamcommunity.com" && /^\/groups\/[A-Za-z0-9_-]{2,64}\/?$/.test(u.pathname),
  youtube: (u) => ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(u.hostname),
  twitch: (u) => ["twitch.tv", "www.twitch.tv"].includes(u.hostname) && /^\/[A-Za-z0-9_]{3,40}\/?$/.test(u.pathname),
};

/**
 * Linkurile clanului, validate: doar `https://`, fără date de autentificare în adresă, max 300 de caractere, iar
 * Discord / Steam / YouTube / Twitch doar pe domeniile lor. Un câmp gol scoate linkul. Erorile vin pe `links.<tip>`.
 */
export function normalizeLinks(raw: unknown): { links: GcsClanLinks; errors: Record<string, string> } {
  const links: GcsClanLinks = {};
  const errors: Record<string, string> = {};
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const kind of CLAN_LINK_KINDS) {
    const value = cleanLine(input[kind]);
    if (!value) continue;
    const url = value.length <= CLAN_LINK_MAX && URL.canParse(value) ? new URL(value) : null;
    const ok = url !== null && url.protocol === "https:" && !url.username && !url.password && (kind === "website" || LINK_RULES[kind](url));
    if (ok) links[kind] = url.toString();
    else errors[`links.${kind}`] = "invalid_url";
  }
  return { links, errors };
}

/** Linkurile salvate (json), doar tipurile cunoscute și valorile text. */
export function readLinks(raw: unknown): GcsClanLinks {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: GcsClanLinks = {};
  for (const kind of CLAN_LINK_KINDS) if (typeof input[kind] === "string" && input[kind]) out[kind] = input[kind] as string;
  return out;
}
