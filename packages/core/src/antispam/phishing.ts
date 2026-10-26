/**
 * Anti-phishing (Steam și conturile de joc): domeniile oficiale, lista livrată cu platforma și potrivirea după
 * aspect (`steamcornmunity`, `stearncommunity`, `steamcommunity-gift` …). Fără module Node: rulează și în browser,
 * unde paza linkurilor trimite un click spre un domeniu suspect pe pagina de avertizare.
 */

/** Domeniile oficiale (și subdomeniile lor) nu sunt niciodată blocate. */
export const OFFICIAL_DOMAINS = [
  "steamcommunity.com",
  "steampowered.com",
  "steamstatic.com",
  "steamgames.com",
  "steamusercontent.com",
  "steamcontent.com",
  "steamserver.net",
  "steam-chat.com",
  "steamchina.com",
  "s.team",
  "valvesoftware.com",
  "counter-strike.net",
  "dota2.com",
  "discord.com",
  "discord.gg",
  "discordapp.com",
  "discordapp.net",
  "discord.media",
  "discord.gift",
  "faceit.com",
  "faceit-cdn.net",
];

/** Site-uri legitime ale comunității care conțin o marcă în nume (nu se potrivesc după aspect). */
export const KNOWN_SAFE_DOMAINS = ["steamgifts.com", "steamtrades.com", "steamdb.info", "steamcharts.com", "steamladder.com", "steamid.io", "steamid.xyz", "steamrep.com", "steamspy.com"];

/** Domenii de phishing cunoscute, livrate cu platforma (se completează din ACP; mai târziu și din platforma-mamă). */
export const SHIPPED_PHISHING_DOMAINS = [
  "steamcommunlty.com",
  "steamcommunity.ru",
  "steamcommunity.co",
  "steamcommunity-com.ru",
  "steamcomrnunity.com",
  "steamconmunity.com",
  "steamcommnuity.com",
  "steamcommunitiy.com",
  "stearncommunity.com",
  "steancommunity.com",
  "sleamcommunity.com",
  "steampowered.ru",
  "steampowerd.com",
  "store-steampowered.com",
  "steam-trade.ru",
  "steamtrade-offer.com",
  "steamgift-card.com",
  "discord-nitro.gift",
  "discordnitro.gift",
  "discord-gifts.com",
  "dlscord.com",
  "discrod.com",
];

/** Mărcile imitate și cât de departe (litere) poate fi o imitație; numele se compară „pliate” (vezi `fold`). */
const RAW_BRANDS: { name: string; distance: number }[] = [
  { name: "steamcommunity", distance: 2 },
  { name: "steampowered", distance: 2 },
  { name: "discordapp", distance: 1 },
];
/** Cuvintele care, lângă „steam” / „discord”, trădează o capcană (`steam-gift`, `discord-nitro`). */
const BAIT = ["gift", "trade", "offer", "giveaway", "drop", "free", "skin", "case", "nitro", "login", "auth", "verify", "bonus", "promo"];
const RAW_BAIT_BRANDS = ["steam", "discord", "faceit"];

/** Pliază caracterele care seamănă (`rn`→`m`, `0`→`o`, `1`/`i`→`l` …) și scoate cratimele. */
export function fold(label: string): string {
  return label
    .toLowerCase()
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/[1i|]/g, "l")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/-/g, "");
}

const BRANDS = RAW_BRANDS.map((b) => ({ ...b, name: fold(b.name) }));
const BAIT_BRANDS = RAW_BAIT_BRANDS.map(fold);
const BAIT_WORDS = BAIT.map(fold);

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** O bucată din etichetă e la cel mult `max` litere de marcă (`store-steampovered` conține „steampovered”). */
function nearIn(label: string, brand: string, max: number): boolean {
  if (label.length < brand.length - max) return false;
  for (let len = brand.length - 1; len <= brand.length + 1; len++) {
    for (let i = 0; i + len <= label.length; i++) if (distance(label.slice(i, i + len), brand) <= max) return true;
  }
  return false;
}

/** Domeniul fără `www.`, punct final și port, cu litere mici; `null` dacă nu arată a domeniu. */
export function normalizeHost(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "").replace(/^www\./, "");
  return /^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(h) && !h.includes("..") ? h : null;
}

const matchesSuffix = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Lista din ACP (un domeniu pe rând; `*.` și `@` în față sunt acceptate). */
export function parseDomainList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((d) => normalizeHost(d.replace(/^\*\./, "").replace(/^@/, "").replace(/^https?:\/\//, "").split("/")[0] ?? ""))
        .filter((d): d is string => d !== null),
    ),
  ];
}

export type GcsPhishingLists = { blocked?: string[]; allowed?: string[] };

/** De ce e suspect un domeniu: în listă (livrată / ACP) sau după aspect; `null` = curat. */
export function phishingVerdict(rawHost: string, lists: GcsPhishingLists = {}): "listed" | "lookalike" | null {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  if ([...OFFICIAL_DOMAINS, ...KNOWN_SAFE_DOMAINS].some((d) => matchesSuffix(host, d))) return null;
  if ((lists.allowed ?? []).some((d) => matchesSuffix(host, d))) return null;
  if ([...SHIPPED_PHISHING_DOMAINS, ...(lists.blocked ?? [])].some((d) => matchesSuffix(host, d))) return "listed";
  // O marcă pe orice etichetă (și `steamcommunity.com.altceva.ru`); punycode: litere din alte alfabete + partea ASCII.
  const labels = host.split(".").slice(0, -1).map((l) => fold(l.replace(/^xn--/, "")));
  if (labels.some((l) => BRANDS.some((b) => l.includes(b.name)))) return "lookalike";
  if (labels.some((l) => BRANDS.some((b) => nearIn(l, b.name, b.distance)))) return "lookalike";
  // `steam-gift`, `discord-nitro`: o marcă lângă o momeală, pe oricare etichetă a domeniului.
  const all = labels.join("");
  if (BAIT_BRANDS.some((b) => all.includes(b)) && BAIT_WORDS.some((w) => all.includes(w))) return "lookalike";
  return null;
}

export const isPhishingHost = (host: string, lists?: GcsPhishingLists) => phishingVerdict(host, lists) !== null;

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const WWW_RE = /(?:^|[^\w.@/-])(www\.[a-z0-9.-]+\.[a-z]{2,24})/gi;
const BARE_RE = /(?:^|[^\w.@/-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?=$|[\s/:?#)\]}>,;!"'])/gi;
const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

const hostOf = (url: string): string | null => {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
};

/** Linkurile reale (http/https și `www.`) dintr-un text sau HTML — cele numărate pentru membrii noi. */
export function extractUrls(textOrHtml: string): string[] {
  const out = new Set<string>();
  for (const m of textOrHtml.matchAll(HREF_RE)) {
    const href = (m[1] ?? m[2] ?? "").replace(/&amp;/g, "&");
    if (/^https?:\/\//i.test(href)) out.add(href);
  }
  for (const m of textOrHtml.matchAll(URL_RE)) out.add(m[0].replace(/[.,;:!?)\]]+$/, ""));
  for (const m of textOrHtml.matchAll(WWW_RE)) out.add(`http://${m[1]}`);
  return [...out];
}

/**
 * Toate domeniile pomenite (și cele scrise fără `http`, ca „steamcornmunity.com/gift”), pentru verificarea de phishing.
 * Adresele de email nu contează.
 */
export function extractHosts(textOrHtml: string): string[] {
  const out = new Set<string>();
  for (const url of extractUrls(textOrHtml)) {
    const h = hostOf(url);
    if (h) out.add(h);
  }
  const plain = textOrHtml.replace(/<[^>]*>/g, " ");
  for (const m of plain.matchAll(BARE_RE)) {
    const h = normalizeHost(m[1]!);
    if (h) out.add(h);
  }
  return [...out];
}

/** Primul domeniu suspect dintr-un conținut (sau `null`). */
export function findPhishing(textOrHtml: string, lists?: GcsPhishingLists): string | null {
  return extractHosts(textOrHtml).find((h) => isPhishingHost(h, lists)) ?? null;
}
