/**
 * Textul mesajelor de chat (specul etapei 4 §3): text simplu, cu linkurile `http(s)` clicabile și mențiunile hotărâte
 * de server (`meta.mentions`) ca pastile. Limita configurabilă (`chat.max_length`) o verifică serviciul; aici e doar
 * plafonul tehnic. Doar importuri pure (`@gcs/core/text-mentions`): fișierul e folosit și de clientul web.
 */
import { splitMentions, type GcsTextMention } from "@gcs/core/text-mentions";

export const CHAT_MAX_CHARS = 2000;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Un mesaj curat: fără caractere de control, pe un singur rând, tăiat la plafonul tehnic. */
export function cleanChatText(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, CHAT_MAX_CHARS);
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,!?;:)\]}]+$/;

/** Adresele `http(s)` din text: poziția și adresa (fără punctuația de la final). */
function urlRanges(text: string): { start: number; end: number; url: string }[] {
  const out: { start: number; end: number; url: string }[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const trail = TRAILING.exec(m[0])?.[0] ?? "";
    const url = m[0].slice(0, m[0].length - trail.length);
    out.push({ start: m.index, end: m.index + url.length, url });
  }
  return out;
}

/** O bucată de text fără mențiuni: escapată, cu adresele `http(s)` ca linkuri. */
function linkify(text: string): string {
  let html = "";
  let last = 0;
  for (const r of urlRanges(text)) {
    html += escape(text.slice(last, r.start));
    html += `<a href="${escape(r.url)}" rel="nofollow ugc noopener" target="_blank">${escape(r.url)}</a>`;
    last = r.end;
  }
  return html + escape(text.slice(last));
}

/**
 * Pastila unei mențiuni, cu același markup ca în postări: un membru (`gcs-userLink gcs-mention`, cu `data-user-id`;
 * stilul numelui îl adaugă decorarea numelor) sau un grup (`gcs-groupMention`, cu `data-group-id`; culoarea vine din
 * CSS-ul grupurilor). Hover card-ul și cardul grupului se deschid de pe ele, ca peste tot.
 */
function mentionPill(m: GcsTextMention, shown: string): string {
  const id = escape(m.id);
  return m.kind === "group"
    ? `<a class="gcs-groupMention" href="/members?group=${id}" data-group-id="${id}">${escape(shown)}</a>`
    : `<a class="gcs-userLink gcs-mention" href="/members/${id}" data-user="${id}" data-user-id="${id}">${escape(shown)}</a>`;
}

/**
 * HTML-ul unui mesaj: totul escapat; adresele `http(s)` devin linkuri, iar mențiunile (cele hotărâte de server, după
 * id) devin pastile. Un `@nume` din interiorul unei adrese rămâne parte din adresă.
 */
export function renderChatText(text: string, mentions: readonly GcsTextMention[] = []): string {
  if (mentions.length === 0) return linkify(text);
  const urls = urlRanges(text);
  let html = "";
  let pos = 0;
  let plain = "";
  for (const part of splitMentions(text, mentions)) {
    const start = pos;
    pos += part.text.length;
    const inUrl = urls.some((u) => start < u.end && pos > u.start);
    if (part.mention && !inUrl) {
      html += linkify(plain) + mentionPill(part.mention, part.text);
      plain = "";
    } else plain += part.text;
  }
  return html + linkify(plain);
}

/** Litera fără diacritice, cu literă mică (o literă → unul sau mai multe caractere). */
const fold = (c: string) => c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Filtrul de cuvinte (`chat.word_filter`): fiecare apariție a unui cuvânt din listă (ca cuvânt întreg, fără să conteze
 * literele mari sau diacriticele) devine `***`.
 */
export function applyWordFilter(text: string, words: string[]): string {
  const terms = words.map((w) => [...w.trim()].map(fold).join("")).filter((w) => w.length > 0);
  if (terms.length === 0) return text;
  // Textul „pliat”, cu poziția din original a fiecărui caracter.
  const chars = [...text];
  let folded = "";
  const origin: number[] = [];
  let offset = 0;
  for (const c of chars) {
    const f = fold(c);
    for (let i = 0; i < f.length; i++) origin.push(offset);
    folded += f;
    offset += c.length;
  }
  origin.push(offset);
  const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(term, from);
      if (at === -1) break;
      const end = at + term.length;
      if (!isWord(folded[at - 1]) && !isWord(folded[end])) ranges.push([origin[at]!, origin[end]!]);
      from = at + 1;
    }
  }
  if (ranges.length === 0) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  let out = "";
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start < pos) continue;
    out += `${text.slice(pos, start)}***`;
    pos = end;
  }
  return out + text.slice(pos);
}

/** Un conținut afișat sub textul mesajului: o imagine dintr-un link sau un clip YouTube. */
export type GcsChatEmbed = { kind: "image"; url: string } | { kind: "youtube"; id: string };

const MAX_EMBEDS = 3;
const IMAGE_URL_RE = /^https:\/\/[^\s?#]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s#]*)?$/i;
const YOUTUBE_ID = "([A-Za-z0-9_-]{11})";
const YOUTUBE_RES = [
  new RegExp(`^https?://(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:[^\s#]*&)?v=${YOUTUBE_ID}(?:[&#]|$)`, "i"),
  new RegExp(`^https?://(?:www\.|m\.)?youtube\.com/(?:shorts|embed|live)/${YOUTUBE_ID}(?:[?&#/]|$)`, "i"),
  new RegExp(`^https?://youtu\.be/${YOUTUBE_ID}(?:[?&#/]|$)`, "i"),
];

/**
 * Imaginile (doar `https:`, după extensie; GIF-urile GIPHY intră aici) și clipurile YouTube din linkurile mesajului,
 * cel mult 3. Afișarea lor o decid setările `chat.allow_images` / `chat.allow_youtube`.
 */
export function chatEmbeds(text: string): GcsChatEmbed[] {
  const out: GcsChatEmbed[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    if (out.length >= MAX_EMBEDS) break;
    const url = m[0].replace(TRAILING, "");
    let embed: GcsChatEmbed | null = null;
    const yt = YOUTUBE_RES.map((re) => re.exec(url)).find(Boolean);
    if (yt) embed = { kind: "youtube", id: yt[1]! };
    else if (IMAGE_URL_RE.test(url)) embed = { kind: "image", url };
    if (!embed) continue;
    const key = embed.kind === "youtube" ? `yt:${embed.id}` : embed.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(embed);
  }
  return out;
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** Câte emoticoane (emoji) are textul; o secvență compusă (👨‍👩‍👧, 👍🏽) contează o dată. */
export function countEmoji(text: string): number {
  const seg = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  if (!seg) return (text.match(EMOJI_RE) ?? []).length;
  let n = 0;
  for (const { segment } of seg.segment(text)) if (/\p{Extended_Pictographic}/u.test(segment)) n++;
  return n;
}

/** URL-ul GIF-ului GIPHY (varianta de 200 px înălțime), din id-ul lui. */
export const giphyUrl = (id: string) => `https://media.giphy.com/media/${id}/200.gif`;
