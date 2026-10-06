import { GCS_FONT_SIZES, parseEmbedUrl } from "@gcs/core";

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  darkred: "#8B0000",
  green: "#008000",
  lime: "#00FF00",
  blue: "#0000FF",
  navy: "#000080",
  yellow: "#FFFF00",
  orange: "#FFA500",
  purple: "#800080",
  pink: "#FFC0CB",
  gray: "#808080",
  grey: "#808080",
  silver: "#C0C0C0",
  brown: "#A52A2A",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  gold: "#FFD700",
  teal: "#008080",
  olive: "#808000",
  maroon: "#800000",
};

/** O culoare CSS (`#f00`, `#ff0000`, `red`, `rgb(255, 0, 0)`) → `#RRGGBB`; altceva → `null`. */
export function normalizeColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return `#${m[1]!.toUpperCase()}`;
  m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return `#${[...m[1]!].map((c) => c + c).join("").toUpperCase()}`;
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(v);
  if (m) {
    const parts = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)));
    return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }
  return NAMED_COLORS[v] ?? null;
}

const SIZES = GCS_FONT_SIZES.map((s) => Number.parseInt(s, 10));

/** Cea mai apropiată mărime permisă de editorul GCS; 14px (textul normal) → fără mărime. */
export function nearestFontSize(px: number): string | null {
  if (!Number.isFinite(px) || px <= 0) return null;
  let best = SIZES[0]!;
  for (const s of SIZES) if (Math.abs(s - px) < Math.abs(best - px)) best = s;
  return best === 14 ? null : `${best}px`;
}

/** Mărimile BBCode 1–7 (în px, ca la platforma veche). */
const BBCODE_SIZES = [9, 10, 12, 15, 18, 22, 26];

/** `[SIZE=5]`, `[SIZE=18px]`, `font-size: 1.5em` → o mărime permisă sau `null`. */
export function parseFontSize(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (/^[1-7]$/.test(v)) return nearestFontSize(BBCODE_SIZES[Number(v) - 1]!);
  let m = /^(\d{1,3}(?:\.\d+)?)px$/.exec(v);
  if (m) return nearestFontSize(Number(m[1]));
  m = /^(\d{1,2}(?:\.\d+)?)pt$/.exec(v);
  if (m) return nearestFontSize(Number(m[1]) * (4 / 3));
  m = /^(\d(?:\.\d+)?)(em|rem)$/.exec(v);
  if (m) return nearestFontSize(Number(m[1]) * 14);
  const named: Record<string, number> = { "x-small": 10, small: 12, medium: 14, large: 18, "x-large": 24, "xx-large": 32 };
  return named[v] ? nearestFontSize(named[v]!) : null;
}

/** Emoticoanele vechi (codul sau numele imaginii) → emoji Unicode. */
const EMOJI: Record<string, string> = {
  ":)": "🙂",
  ":-)": "🙂",
  ":(": "🙁",
  ":-(": "🙁",
  ":d": "😀",
  ":-d": "😀",
  ";)": "😉",
  ";-)": "😉",
  ":p": "😛",
  ":-p": "😛",
  ":o": "😮",
  ":-o": "😮",
  "<3": "❤️",
  ":'(": "😢",
  "b)": "😎",
  "8)": "😎",
  ":|": "😐",
  ":@": "😠",
  "(y)": "👍",
  ":/": "😕",
  smile: "🙂",
  happy: "😊",
  sad: "🙁",
  biggrin: "😀",
  grin: "😁",
  laugh: "😆",
  lol: "😆",
  wink: "😉",
  tongue: "😛",
  ohmy: "😮",
  wow: "😮",
  cool: "😎",
  cry: "😢",
  mad: "😠",
  angry: "😠",
  unsure: "😕",
  confused: "😕",
  wub: "😍",
  love: "😍",
  thumbsup: "👍",
  like: "👍",
  heart: "❤️",
  rolleyes: "🙄",
  sleep: "😴",
  blush: "😊",
};

/** Emoji-ul unui emoticon după cod (`:)`), nume (`:smile:`) sau imagine (`.../smile.png`); altfel `null`. */
export function emojiFor(code: string, src = ""): string | null {
  const c = code.trim().toLowerCase();
  if (EMOJI[c]) return EMOJI[c]!;
  const named = /^:([a-z_]+):$/.exec(c)?.[1];
  if (named && EMOJI[named]) return EMOJI[named]!;
  const file = /([a-z_]+)(?:@\dx)?\.(?:png|gif|jpe?g|svg|webp)$/i.exec(src)?.[1]?.toLowerCase();
  return file && EMOJI[file] ? EMOJI[file]! : null;
}

/**
 * Adresa de embed a unui iframe vechi: YouTube (`/embed/ID`), Twitch (player, clipuri) sau un embed intern al
 * platformei vechi (`…&url=<adresa>`). Întoarce adresa publică, dacă GCS o recunoaște ca embed video.
 */
export function embedUrlFromIframe(src: string): string | null {
  if (!URL.canParse(src)) return null;
  const url = new URL(src);
  const host = url.hostname.toLowerCase();
  let candidate: string | null = null;
  const yt = /^\/embed\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
  if (yt && /(^|\.)youtube(-nocookie)?\.com$/.test(host)) candidate = `https://www.youtube.com/watch?v=${yt[1]}`;
  else if (host === "player.twitch.tv") {
    const video = url.searchParams.get("video");
    const channel = url.searchParams.get("channel");
    if (video) candidate = `https://www.twitch.tv/videos/${video.replace(/^v/, "")}`;
    else if (channel) candidate = `https://www.twitch.tv/${channel}`;
  } else if (host === "clips.twitch.tv" && url.searchParams.get("clip")) candidate = `https://clips.twitch.tv/${url.searchParams.get("clip")}`;
  else if (url.searchParams.get("url")) candidate = url.searchParams.get("url");
  if (!candidate) return null;
  const embed = parseEmbedUrl(candidate);
  return embed && embed.provider !== "image" ? candidate : null;
}

/** O adresă video ca embed GCS (YouTube, Twitch, Medal), nu ca imagine. */
export function videoEmbed(url: string): string | null {
  const embed = parseEmbedUrl(url);
  return embed && embed.provider !== "image" ? url : null;
}
