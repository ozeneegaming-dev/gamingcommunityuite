/**
 * Logica pură a botului de știri (fără apeluri spre platformă): lista fluxurilor din setări, citirea RSS / Atom, știrile
 * oficiale Steam, extrasul și orele de publicare. Testată separat (`test/feeds.test.ts`).
 */

export type GcsFeedOptions = { translate: boolean; full: boolean; pin: boolean; lock: boolean };
export type GcsFeedSource = { kind: "rss"; url: string } | { kind: "steam"; appId: number };
export type GcsFeedConfig = {
  /** Stabil cât timp sursa rămâne aceeași (redenumirea fluxului nu republică știrile). */
  id: string;
  name: string;
  source: GcsFeedSource;
  /** Numele sau id-ul forumului, cum l-a scris adminul. */
  forum: string;
  minutes: number;
  label: string;
  options: GcsFeedOptions;
  line: number;
};
export type GcsFeedLineError = { line: number; reason: "columns" | "source" | "forum" };
export type GcsFeedItem = { guid: string; title: string; link: string | null; html: string; image: string | null; date: number | null };

export const MIN_MINUTES = 5;
export const MAX_MINUTES = 1440;
const DEFAULT_MINUTES = 30;
const URL_MAX = 2000;

/** Un hash scurt și stabil (djb2, baza 36). */
export function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const OPTION_WORDS: Record<string, keyof GcsFeedOptions> = {
  traduce: "translate",
  translate: "translate",
  complet: "full",
  full: "full",
  fixat: "pin",
  pin: "pin",
  inchis: "lock",
  închis: "lock",
  lock: "lock",
};

/**
 * Fluxurile din setarea `feeds`: un flux pe rând, `Nume | Sursă | Forum | Minute | Eticheta | Opțiuni`; rândurile goale
 * și cele care încep cu `#` se ignoră. Sursa e o adresă RSS / Atom (`https://…`) sau `steam:<id joc>`.
 */
export function parseFeedLines(text: string): { feeds: GcsFeedConfig[]; errors: GcsFeedLineError[] } {
  const feeds: GcsFeedConfig[] = [];
  const errors: GcsFeedLineError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const cols = trimmed.split("|").map((c) => c.trim());
    if (cols.length < 3) return void errors.push({ line, reason: "columns" });
    const [name, sourceText, forum, minutesText, label, optionsText] = cols as [string, string, string, string?, string?, string?];
    const steam = /^steam:(\d{1,10})$/i.exec(sourceText);
    let source: GcsFeedSource;
    if (steam) source = { kind: "steam", appId: Number(steam[1]) };
    else if (/^https?:\/\/\S+$/i.test(sourceText) && sourceText.length <= URL_MAX) source = { kind: "rss", url: sourceText };
    else return void errors.push({ line, reason: "source" });
    if (!forum) return void errors.push({ line, reason: "forum" });
    const minutes = Number.parseInt(minutesText ?? "", 10);
    const options: GcsFeedOptions = { translate: false, full: false, pin: false, lock: false };
    for (const word of (optionsText ?? "").toLowerCase().split(/[\s,;]+/)) {
      const key = OPTION_WORDS[word];
      if (key) options[key] = true;
    }
    feeds.push({
      id: shortHash(source.kind === "steam" ? `steam:${source.appId}` : source.url),
      name: (name || sourceText).slice(0, 80),
      source,
      forum,
      minutes: Number.isFinite(minutes) ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes)) : DEFAULT_MINUTES,
      label: (label ?? "").slice(0, 40),
      options,
      line,
    });
  });
  return { feeds, errors };
}

// ─── RSS / Atom ────────────────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Textul unui element XML (CDATA desfăcut, entitățile decodate o dată). */
function elementText(raw: string | undefined): string {
  if (raw === undefined) return "";
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  return cdata ? cdata[1]! : decodeEntities(raw);
}

function child(block: string, names: string[]): string | undefined {
  for (const name of names) {
    const re = new RegExp(`<${name.replace(":", "\\:")}(?:\\s[^>]*)?>([\\s\\S]*?)</${name.replace(":", "\\:")}>`, "i");
    const m = re.exec(block);
    if (m) return m[1];
  }
  return undefined;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : null;
}

function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  return /^https?:\/\//i.test(u) && u.length <= URL_MAX && !/\s/.test(u) ? u : null;
}

function firstImage(html: string): string | null {
  const img = /<img\b[^>]*>/i.exec(html);
  return img ? safeUrl(attr(img[0], "src")) : null;
}

/** Elementele unui flux RSS 2.0 sau Atom, cele mai noi întâi. Un document necunoscut → nicio știre. */
export function parseFeed(xml: string): GcsFeedItem[] {
  const atom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const items: GcsFeedItem[] = [];
  for (const block of blocks) {
    const title = elementText(child(block, ["title"])).replace(/<[^>]+>/g, "").trim();
    let link: string | null;
    if (atom) {
      const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
      const alternate = links.find((l) => (attr(l, "rel") ?? "alternate") === "alternate") ?? links[0];
      link = safeUrl(alternate ? attr(alternate, "href") : null);
    } else {
      link = safeUrl(elementText(child(block, ["link"])).trim());
    }
    const guid = elementText(child(block, atom ? ["id"] : ["guid"])).trim() || link || title;
    const html = elementText(child(block, atom ? ["content", "summary"] : ["content:encoded", "description"])).trim();
    const enclosure = [...block.matchAll(/<(?:enclosure|media:content|media:thumbnail)\b[^>]*>/gi)]
      .map((m) => m[0])
      .find((t) => {
        const type = attr(t, "type");
        return !type || type.startsWith("image/");
      });
    const image = safeUrl(enclosure ? attr(enclosure, "url") : null) ?? firstImage(html);
    const dateText = elementText(child(block, ["pubDate", "published", "updated", "dc:date"])).trim();
    const date = dateText ? Date.parse(dateText) : Number.NaN;
    if (!title || !guid) continue;
    items.push({ guid: guid.slice(0, 300), title: title.slice(0, 150), link, html, image, date: Number.isFinite(date) ? date : null });
  }
  return items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

// ─── Steam ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Adresa API-ului oficial (gratuit, fără cheie) pentru știrile unui joc. */
export function steamNewsUrl(appId: number, count = 10): string {
  return `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=${count}&maxlength=0&format=json`;
}

const STEAM_IMAGES = "https://clan.cloudflare.steamstatic.com/images";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Marcajul anunțurilor Steam (`[list][*]…`, `[b]`, `[url=…]`, `[img]`) → HTML (curățat apoi de nucleu). */
export function steamMarkupToHtml(contents: string): string {
  const text = contents.replace(/\{STEAM_CLAN_IMAGE\}/g, STEAM_IMAGES);
  if (!/\[(?:list|olist|\*|b|i|u|h[1-6]|url|img|p)\b/i.test(text)) return text;
  let html = escapeHtml(text);
  html = html.replace(/\[\*\]([\s\S]*?)(?=\[\*\]|\[\/list\]|\[\/olist\]|$)/gi, (_m, item: string) => `<li>${item.trim()}</li>`);
  html = html
    .replace(/\[list\]/gi, "<ul>")
    .replace(/\[\/list\]/gi, "</ul>")
    .replace(/\[olist\]/gi, "<ol>")
    .replace(/\[\/olist\]/gi, "</ol>")
    .replace(/\[(\/?)(b|i|u)\]/gi, "<$1$2>")
    .replace(/\[(\/?)h[1-6]\]/gi, (_m, close: string) => (close ? "</strong></p>" : "<p><strong>"))
    .replace(/\[(\/?)p\]/gi, "<$1p>")
    .replace(/\[url=(?:&quot;)?(https?:\/\/[^\]\s]+?)(?:&quot;)?\]([\s\S]*?)\[\/url\]/gi, '<a href="$1">$2</a>')
    .replace(/\[img\](https?:\/\/[^[\s]+)\[\/img\]/gi, '<img src="$1">')
    .replace(/\[\/?[a-z0-9]+(?:=[^\]]*)?\]/gi, "")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<p>${html}</p>`.replace(/<p>\s*<\/p>/g, "");
}

type SteamNewsItem = { gid?: unknown; title?: unknown; url?: unknown; contents?: unknown; date?: unknown; feedname?: unknown };

/** Știrile unui joc, doar anunțurile oficiale ale dezvoltatorului (nu articolele altor site-uri preluate de Steam). */
export function steamItems(json: unknown): GcsFeedItem[] {
  const list = (json as { appnews?: { newsitems?: unknown } } | null)?.appnews?.newsitems;
  if (!Array.isArray(list)) return [];
  const items: GcsFeedItem[] = [];
  for (const raw of list as SteamNewsItem[]) {
    if (raw.feedname !== "steam_community_announcements") continue;
    if (typeof raw.gid !== "string" || typeof raw.title !== "string" || typeof raw.contents !== "string") continue;
    const html = steamMarkupToHtml(raw.contents);
    items.push({
      guid: raw.gid,
      title: raw.title.slice(0, 150),
      link: safeUrl(typeof raw.url === "string" ? raw.url : null),
      html,
      image: firstImage(html),
      date: typeof raw.date === "number" ? raw.date * 1000 : null,
    });
  }
  return items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

// ─── Conținutul postării ───────────────────────────────────────────────────────────────────────────────────

/** Textul simplu al unui HTML (fără scripturi / stiluri, spațiile strânse). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** Extrasul: primele `max` caractere, tăiate la un cuvânt, cu „…”. */
export function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * HTML-ul postării. Implicit (drepturile de autor): titlul vine separat, aici extrasul și imaginea; „Citește pe sursă”
 * apare sub postare. Textul complet doar dacă adminul a bifat „complet” (sursa permite republicarea) sau pentru
 * anunțurile oficiale Steam (notele de patch).
 */
export function postHtml(item: GcsFeedItem, opts: { full: boolean; excerptChars: number }): string {
  if (opts.full && item.html) return item.html;
  const parts = [`<p>${escapeHtml(excerpt(htmlToText(item.html), opts.excerptChars))}</p>`];
  if (item.image) parts.push(`<p><img src="${escapeHtml(item.image)}" alt=""></p>`);
  return parts.join("");
}

// ─── Orele de publicare ────────────────────────────────────────────────────────────────────────────────────

/** `08-23` → de la 8:00 până la 23:00 (fără sfârșit inclus); gol sau invalid → oricând (`null`). Peste miezul nopții: `22-06`. */
export function parseWindow(text: string): { from: number; to: number } | null {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from > 23 || to > 24 || from === to) return null;
  return { from, to };
}

export function inWindow(hour: number, window: { from: number; to: number } | null): boolean {
  if (!window) return true;
  return window.from < window.to ? hour >= window.from && hour < window.to : hour >= window.from || hour < window.to;
}
