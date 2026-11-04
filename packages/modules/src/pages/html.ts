import sanitizeHtml from "sanitize-html";

/**
 * HTML-ul paginilor „HTML manual” și al blocurilor HTML (scris de admini în ACP): mai larg decât conținutul membrilor
 * (titluri, structură, clase și id-uri proprii, stiluri dintr-o listă albă), dar fără scripturi, evenimente, formulare,
 * stiluri sau URL-uri active. Iframe-urile doar de la furnizorii video cunoscuți, în `sandbox`.
 */
const TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", "mark",
  "code", "pre", "kbd", "blockquote", "q", "cite", "abbr", "time", "a", "ul", "ol", "li", "dl", "dt", "dd",
  "div", "span", "section", "article", "aside", "header", "footer", "nav", "main", "figure", "figcaption",
  "img", "picture", "source", "video", "audio", "iframe", "details", "summary",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "svg", "path", "circle", "rect", "line", "polyline", "polygon", "g",
];

const COMMON = ["class", "id", "style", "title", "role", "aria-label", "aria-hidden", "aria-describedby", "data-*", "lang", "dir"];
const IFRAME_HOSTS = ["www.youtube.com", "www.youtube-nocookie.com", "player.twitch.tv", "clips.twitch.tv", "player.vimeo.com", "open.spotify.com", "w.soundcloud.com", "www.google.com"];

/** Proprietățile CSS permise în `style`: aspect și așezare, fără URL-uri (`url()`), expresii sau poziționare fixă. */
const SAFE_VALUE = /^(?!.*(?:url\s*\(|expression|javascript:|@import|\\))[#%,.()\-\w\s/'"!]+$/i;
const STYLE_PROPS = [
  "color", "background", "background-color", "border", "border-top", "border-bottom", "border-left", "border-right", "border-color", "border-width", "border-style", "border-radius",
  "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
  "width", "max-width", "min-width", "height", "max-height", "min-height", "display", "flex", "flex-direction", "flex-wrap", "gap", "row-gap", "column-gap",
  "justify-content", "align-items", "align-self", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "text-align", "vertical-align",
  "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-transform", "text-decoration", "white-space", "opacity", "box-shadow",
  "overflow", "aspect-ratio", "object-fit", "list-style",
];
const allowedStyles = Object.fromEntries(STYLE_PROPS.map((p) => [p, [SAFE_VALUE]]));

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: TAGS,
  allowedAttributes: {
    "*": COMMON,
    a: [...COMMON, "href", "target", "rel"],
    img: [...COMMON, "src", "srcset", "alt", "width", "height", "loading", "decoding"],
    source: ["src", "srcset", "type", "media"],
    video: [...COMMON, "src", "poster", "controls", "muted", "loop", "playsinline", "autoplay", "width", "height"],
    audio: [...COMMON, "src", "controls", "loop"],
    iframe: [...COMMON, "src", "width", "height", "loading", "allowfullscreen", "allow", "frameborder", "sandbox"],
    td: [...COMMON, "colspan", "rowspan"],
    th: [...COMMON, "colspan", "rowspan", "scope"],
    col: [...COMMON, "span"],
    time: [...COMMON, "datetime"],
    ol: [...COMMON, "start", "reversed"],
    svg: [...COMMON, "viewbox", "viewBox", "width", "height", "fill", "stroke", "stroke-width", "xmlns", "focusable"],
    path: ["d", "fill", "stroke", "stroke-width", "fill-rule", "clip-rule"],
    circle: ["cx", "cy", "r", "fill", "stroke"],
    rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke"],
    line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width"],
    polyline: ["points", "fill", "stroke"],
    polygon: ["points", "fill", "stroke"],
    g: ["fill", "stroke", "transform"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"], source: ["http", "https"] },
  allowedIframeHostnames: IFRAME_HOSTS,
  allowProtocolRelative: false,
  allowedStyles: { "*": allowedStyles },
  transformTags: {
    // Linkurile spre alte site-uri se deschid fără acces la pagina noastră.
    a: (tag, attribs) => (attribs.target === "_blank" ? { tagName: tag, attribs: { ...attribs, rel: "noopener noreferrer nofollow" } } : { tagName: tag, attribs }),
    iframe: (tag, attribs) => ({ tagName: tag, attribs: { ...attribs, sandbox: "allow-scripts allow-same-origin allow-presentation allow-popups", loading: "lazy" } }),
  },
  exclusiveFilter: (frame) => frame.tag === "img" && typeof frame.attribs.src === "string" && frame.attribs.src.startsWith("data:") && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(frame.attribs.src),
};

export const MAX_PAGE_HTML = 200_000;

export function sanitizePageHtml(html: string): string {
  return sanitizeHtml(html.slice(0, MAX_PAGE_HTML), OPTIONS);
}

/** Un câmp al unui bloc-șablon (completat de staff, fără cod). `image` = adresa unui fișier din bibliotecă. */
export type GcsBlockField = { key: string; label: string; type: "text" | "textarea" | "url" | "image" };
const BLOCK_FIELD_TYPES = ["text", "textarea", "url", "image"] as const;

export function blockFieldsOf(raw: unknown): GcsBlockField[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).slice(0, 20).flatMap((x): GcsBlockField[] => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    const label = typeof o.label === "string" ? o.label.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(key) || !label || seen.has(key)) return [];
    seen.add(key);
    return [{ key, label, type: BLOCK_FIELD_TYPES.includes(o.type as GcsBlockField["type"]) ? (o.type as GcsBlockField["type"]) : "text" }];
  });
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Șablonul unui bloc cu valorile câmpurilor: `{{cheie}}` → valoarea escapată (textarea: rândurile noi devin `<br>`;
 * url / image: doar adrese sigure, altfel goală). Rezultatul trece apoi prin `sanitizePageHtml`.
 */
export function fillBlockTemplate(source: string, fields: GcsBlockField[], values: Record<string, string>): string {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return source.replace(/\{\{\s*([a-z][a-z0-9_]{0,29})\s*\}\}/g, (_m, key: string) => {
    const f = byKey.get(key);
    const v = values[key] ?? "";
    if (!f) return "";
    if (f.type === "url" || f.type === "image") return /^(https?:\/\/|\/(?!\/))[^\s<>"']*$/i.test(v) ? escapeHtml(v) : "";
    return f.type === "textarea" ? escapeHtml(v).replace(/\r?\n/g, "<br>") : escapeHtml(v);
  });
}

/** Etichetele GCS din HTML-ul unei pagini: `{block="cheie"}` (un bloc reutilizabil) și `{database="cheie"}` (o listă). */
export const PAGE_TAG_RE = /\{(block|database)="([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)"\}/g;

/** HTML-ul despărțit la etichete: bucățile de HTML și etichetele, în ordine (randarea le pune componentele între ele). */
export function splitPageTags(html: string): ({ kind: "html"; html: string } | { kind: "block" | "database"; key: string })[] {
  const out: ({ kind: "html"; html: string } | { kind: "block" | "database"; key: string })[] = [];
  let last = 0;
  for (const m of html.matchAll(PAGE_TAG_RE)) {
    if (m.index! > last) out.push({ kind: "html", html: html.slice(last, m.index) });
    out.push({ kind: m[1] as "block" | "database", key: m[2]! });
    last = m.index! + m[0].length;
  }
  if (last < html.length) out.push({ kind: "html", html: html.slice(last) });
  return out;
}
