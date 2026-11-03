/**
 * Nodurile sărite în fragmente și imagini: citatele (textul altcuiva) și blocurile ascunse (`gcsHidden`, deschise per
 * vizitator în pagina topicului: conținutul lor nu iese din postare, la fel ca în HTML-ul și textul de căutare).
 */
const SKIPPED: ReadonlySet<string> = new Set(["quote", "gcsHidden"]);

const FILE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const SAFE_SRC = /^https:\/\/[^\s"'<>]+$/i;
const IMAGE_URL = /^https:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s"'<>]*)?$/i;

/** O imagine dintr-un document: adresa și dacă e un atașament (`/files/<id>`, cu permisiunile conținutului). */
export type GcsDocImage = { src: string; file: boolean };

/** Imaginea unui nod `image` / `embed` (atașament, `https://` sau embed de imagine), fără filtre; altfel `null`. */
function nodeImage(node: { type?: string; attrs?: Record<string, unknown> }): (GcsDocImage & { width: number | null; height: number | null }) | null {
  const a = node.attrs ?? {};
  const size = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  if (node.type === "image") {
    if (typeof a.attachmentId === "string" || typeof a.attachmentId === "number") {
      const id = String(a.attachmentId);
      return FILE_ID.test(id) ? { src: `/files/${id}`, file: true, width: size(a.width), height: size(a.height) } : null;
    }
    return typeof a.src === "string" && SAFE_SRC.test(a.src) ? { src: a.src, file: false, width: size(a.width), height: size(a.height) } : null;
  }
  if (node.type === "embed" && typeof a.url === "string" && IMAGE_URL.test(a.url)) return { src: a.url, file: false, width: null, height: null };
  return null;
}

/**
 * Prima imagine dintr-un document al editorului (caruselul topicurilor recomandate): un atașament (`/files/<id>`) sau o
 * imagine externă `https://` (nodul imagine sau un embed de imagine); `null` dacă nu are. Citatele și blocurile ascunse
 * se sar.
 */
export function docFirstImage(json: unknown): string | null {
  let found: string | null = null;
  const walk = (n: unknown, depth: number) => {
    if (found || depth > 50 || typeof n !== "object" || n === null) return;
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type && SKIPPED.has(node.type)) return;
    if (node.type === "image" || node.type === "embed") {
      found = nodeImage(node)?.src ?? null;
      if (node.type === "image" || found) return;
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c, depth + 1);
  };
  walk(json, 0);
  return found;
}

/** Latura sub care o imagine e o iconiță (emoticon, insignă, pixel de urmărire), nu o poză. */
const ICON_SIDE = 64;
const TINY_SIDE = 24;
/** Adresele emoticoanelor și ale iconițelor (ex. `/emoji/`, `smiley.gif`, `twemoji`, `favicon.ico`, SVG-urile). */
const ICON_PATH = /(?:^|[/_.-])(?:emojis?|emoticons?|smil(?:e|es|ey|eys|ies)|twemoji|icons?|favicon)(?:[/_.-]|$)|\.(?:svg|ico)$/i;

function looksLikeIcon(img: GcsDocImage & { width: number | null; height: number | null }): boolean {
  const { width: w, height: h } = img;
  if (w !== null && h !== null && w <= ICON_SIDE && h <= ICON_SIDE) return true;
  if ((w !== null && w < TINY_SIDE) || (h !== null && h < TINY_SIDE)) return true;
  if (img.file) return false;
  let path = img.src;
  try {
    path = new URL(img.src).pathname;
  } catch {
    return true;
  }
  return ICON_PATH.test(path);
}

/**
 * Pozele dintr-un document al editorului (previzualizarea cardurilor de forum), în ordine, cel mult `max`: atașamentele
 * și imaginile `https://`, fără emoticoane și iconițe (latura mică sau adresa lor). `skip`: nodurile sărite (implicit
 * citatele și blocurile ascunse; cardurile sar și spoilerele).
 */
export function docImages(json: unknown, opts: { max?: number; skip?: ReadonlySet<string> } = {}): GcsDocImage[] {
  const max = opts.max ?? 3;
  const skip = opts.skip ?? SKIPPED;
  const out: GcsDocImage[] = [];
  const walk = (n: unknown, depth: number) => {
    if (out.length >= max || depth > 50 || typeof n !== "object" || n === null) return;
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type && skip.has(node.type)) return;
    if (node.type === "image" || node.type === "embed") {
      const img = nodeImage(node);
      if (img && !looksLikeIcon(img) && !out.some((x) => x.src === img.src)) out.push({ src: img.src, file: img.file });
      return;
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c, depth + 1);
  };
  walk(json, 0);
  return out;
}

/**
 * Textul simplu al unui document al editorului (fără citate și blocuri ascunse), scurtat la `max` caractere
 * (notificări, widget-uri). `skip`: alte noduri sărite (ex. spoilerele, în previzualizarea cardurilor).
 */
export function docSnippet(json: unknown, max = 140, skip: ReadonlySet<string> = SKIPPED): string {
  const parts: string[] = [];
  const walk = (n: unknown, depth: number) => {
    if (depth > 50 || typeof n !== "object" || n === null) return;
    const node = n as { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type && skip.has(node.type)) return;
    if (node.type === "text" && typeof node.text === "string") parts.push(node.text);
    if (node.type === "mention" && typeof node.attrs?.label === "string") parts.push(`@${node.attrs.label}`);
    if (Array.isArray(node.content)) for (const c of node.content) walk(c, depth + 1);
    if (node.type === "paragraph" || node.type === "heading") parts.push(" ");
  };
  walk(json, 0);
  const text = parts.join("").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
