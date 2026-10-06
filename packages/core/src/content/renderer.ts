import sanitizeHtml from "sanitize-html";
import { GcsValidationError } from "../errors";
import { embedIframeSrc, GCS_EMBED_IFRAME_HOSTS, parseEmbedUrl, type GcsEmbedProvider } from "./embeds";

/** Un nod Tiptap (JSON), după validare: doar câmpurile cunoscute. */
export type GcsDocNode = {
  type: string;
  attrs?: Record<string, string | number | null>;
  content?: GcsDocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, string | null> }[];
};
export type GcsDoc = GcsDocNode & { type: "doc" };

export type GcsRenderOptions = {
  /** Furnizorii de embed activi (setarea `forums.embeds`); restul devin linkuri simple. */
  embeds: readonly string[];
  /** Host-ul site-ului (Twitch îl cere în `parent`). */
  siteHost: string;
  /** Texte traduse: `quoteWrote` conține `{name}`. */
  labels: { quoteWrote: string; spoiler: string };
};

export type GcsRendered = {
  json: GcsDoc;
  html: string;
  /** Textul simplu: pentru căutare, OpenGraph și lungimea maximă. */
  text: string;
  mentions: string[];
  attachments: string[];
  quotes: number[];
};

const MAX_NODES = 10_000;
const MAX_DEPTH = 20;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const LANGUAGE = /^[A-Za-z0-9+#-]{1,20}$/;

type AttrRule = (v: unknown) => boolean;
const optional = (rule: AttrRule): AttrRule => (v) => v === undefined || v === null || rule(v);
const isInt = (min: number, max: number): AttrRule => (v) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isText = (max: number, min = 0): AttrRule => (v) => typeof v === "string" && v.length >= min && v.length <= max;
const isId: AttrRule = (v) => typeof v === "string" && ID.test(v);
const any: AttrRule = () => true;

type NodeSpec = {
  group: "block" | "inline" | "listItem";
  /** Ce conținut acceptă: un grup, sau nimic (nod frunză). */
  content?: "block" | "inline" | "listItem";
  attrs?: Record<string, AttrRule>;
  /** Atributele obligatorii. */
  required?: string[];
};

/** Nodurile permise. Editorul (`GcsEditor`) definește exact aceleași noduri și atribute. */
export const GCS_DOC_NODES: Record<string, NodeSpec> = {
  paragraph: { group: "block", content: "inline" },
  heading: { group: "block", content: "inline", attrs: { level: isInt(2, 4) }, required: ["level"] },
  bulletList: { group: "block", content: "listItem" },
  orderedList: { group: "block", content: "listItem", attrs: { start: optional(isInt(1, 100_000)), type: optional((v) => v === "1") } },
  listItem: { group: "listItem", content: "block" },
  blockquote: { group: "block", content: "block" },
  codeBlock: { group: "block", content: "inline", attrs: { language: optional((v) => typeof v === "string" && LANGUAGE.test(v)) } },
  horizontalRule: { group: "block" },
  image: {
    group: "block",
    attrs: {
      attachmentId: optional(isId),
      src: optional((v) => typeof v === "string" && isSafeImageSrc(v)),
      alt: optional(isText(300)),
      title: optional(isText(300)),
      width: optional(isInt(1, 10_000)),
      height: optional(isInt(1, 10_000)),
    },
  },
  quote: {
    group: "block",
    content: "block",
    attrs: { postId: isInt(1, Number.MAX_SAFE_INTEGER), authorId: optional(isId), authorName: isText(40, 1) },
    required: ["postId", "authorName"],
  },
  spoiler: { group: "block", content: "block", attrs: { summary: optional(isText(100)) } },
  embed: { group: "block", attrs: { url: isText(2000, 1) }, required: ["url"] },
  hardBreak: { group: "inline" },
  mention: {
    group: "inline",
    attrs: { id: isId, label: isText(40, 1), mentionSuggestionChar: optional((v) => v === "@") },
    required: ["id", "label"],
  },
};

/** Mărcile permise. La `link`, `target`/`rel`/`class`/`title` din Tiptap sunt acceptate, dar ignorate (le punem noi). */
export const GCS_DOC_MARKS: Record<string, Record<string, AttrRule>> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  link: { href: (v) => typeof v === "string" && isSafeHref(v), target: any, rel: any, class: any, title: any },
};

function isSafeHref(href: string): boolean {
  if (href.length > 2000 || /[\s\u0000-\u001f]/.test(href)) return false;
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  if (href.startsWith("#")) return true;
  if (!URL.canParse(href)) return false;
  return ["http:", "https:", "mailto:"].includes(new URL(href).protocol);
}

function isSafeImageSrc(src: string): boolean {
  return src.length <= 2000 && URL.canParse(src) && new URL(src).protocol === "https:" && !/[\s"'<>]/.test(src);
}

function invalid(): never {
  throw new GcsValidationError({ content: "invalid" });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkKeys(obj: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) invalid();
}

function validateAttrs(raw: unknown, rules: Record<string, AttrRule>, required: string[] = []): Record<string, string | number | null> | undefined {
  if (raw === undefined || raw === null) {
    if (required.length > 0) invalid();
    return undefined;
  }
  if (!isRecord(raw)) invalid();
  checkKeys(raw, Object.keys(rules));
  const out: Record<string, string | number | null> = {};
  for (const [key, rule] of Object.entries(rules)) {
    const value = raw[key];
    if (required.includes(key) && (value === undefined || value === null)) invalid();
    if (!rule(value)) invalid();
    if (value !== undefined && value !== null && (typeof value === "string" || typeof value === "number")) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Validează documentul și întoarce o copie care conține doar câmpurile cunoscute. */
function validate(raw: unknown): GcsDoc {
  let nodes = 0;

  function node(value: unknown, expected: "block" | "inline" | "listItem", depth: number): GcsDocNode {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) invalid();
    if (!isRecord(value) || typeof value.type !== "string") invalid();

    if (value.type === "text") {
      if (expected !== "inline") invalid();
      checkKeys(value, ["type", "text", "marks"]);
      if (typeof value.text !== "string" || value.text.length === 0) invalid();
      const out: GcsDocNode = { type: "text", text: value.text };
      if (value.marks !== undefined) {
        if (!Array.isArray(value.marks) || value.marks.length > 10) invalid();
        const marks = value.marks.map((m) => {
          if (!isRecord(m) || typeof m.type !== "string") invalid();
          checkKeys(m, ["type", "attrs"]);
          const rules = GCS_DOC_MARKS[m.type];
          if (!rules) invalid();
          const attrs = validateAttrs(m.attrs, rules, m.type === "link" ? ["href"] : []);
          if (m.type === "link") return { type: "link", attrs: { href: attrs!.href as string } };
          return { type: m.type };
        });
        if (marks.length > 0) out.marks = marks;
      }
      return out;
    }

    const spec = GCS_DOC_NODES[value.type];
    if (!spec || spec.group !== expected) invalid();
    checkKeys(value, ["type", "attrs", "content"]);
    const out: GcsDocNode = { type: value.type };
    const attrs = validateAttrs(value.attrs, spec.attrs ?? {}, spec.required);
    if (attrs) out.attrs = attrs;
    if (value.type === "image" && !attrs?.attachmentId === !attrs?.src) invalid();

    if (value.content !== undefined) {
      if (!spec.content || !Array.isArray(value.content)) invalid();
      out.content = value.content.map((child) => node(child, spec.content!, depth + 1));
    }
    // Containerele de blocuri nu pot fi goale (un paragraf sau un titlu gol, da).
    if (spec.content && spec.content !== "inline" && (out.content?.length ?? 0) === 0) invalid();
    return out;
  }

  if (!isRecord(raw) || raw.type !== "doc" || !Array.isArray(raw.content)) invalid();
  checkKeys(raw, ["type", "content"]);
  const content = raw.content.map((child) => node(child, "block", 1));
  if (content.length === 0) invalid();
  // Un document fără niciun caracter (ex. un singur paragraf gol) e tot un document gol.
  if (!content.some(hasContent)) invalid();
  return { type: "doc", content };
}

function hasContent(n: GcsDocNode): boolean {
  if (n.type === "text") return (n.text ?? "").trim().length > 0;
  if (!GCS_DOC_NODES[n.type]?.content) return n.type !== "hardBreak";
  return (n.content ?? []).some(hasContent);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LINK_ATTRS = 'rel="nofollow ugc noopener" target="_blank"';
const SANDBOX = "allow-scripts allow-same-origin allow-popups allow-presentation";

/** Transformă JSON-ul validat în HTML și colectează textul, mențiunile, atașamentele și citatele. */
function toHtml(doc: GcsDoc, opts: GcsRenderOptions) {
  const text: string[] = [];
  const mentions = new Set<string>();
  const attachments = new Set<string>();
  const quotes = new Set<number>();

  const children = (n: GcsDocNode) => (n.content ?? []).map(render).join("");
  const link = (href: string, label: string) => `<a href="${esc(href)}" ${LINK_ATTRS}>${label}</a>`;

  function render(n: GcsDocNode): string {
    const a = n.attrs ?? {};
    switch (n.type) {
      case "text": {
        text.push(n.text!);
        let html = esc(n.text!);
        for (const mark of [...(n.marks ?? [])].reverse()) {
          if (mark.type === "bold") html = `<strong>${html}</strong>`;
          else if (mark.type === "italic") html = `<em>${html}</em>`;
          else if (mark.type === "underline") html = `<u>${html}</u>`;
          else if (mark.type === "strike") html = `<s>${html}</s>`;
          else if (mark.type === "code") html = `<code>${html}</code>`;
          else if (mark.type === "link") {
            const href = mark.attrs!.href!;
            // Un fișier atașat (non-imagine) apare în postare ca link spre `/files/{id}`.
            const file = /^\/files\/([A-Za-z0-9_-]{1,40})$/.exec(href);
            if (file) attachments.add(file[1]!);
            html = link(href, html);
          }
        }
        return html;
      }
      case "paragraph":
        text.push("\n");
        return `<p>${children(n)}</p>`;
      case "heading":
        text.push("\n");
        return `<h${a.level}>${children(n)}</h${a.level}>`;
      case "bulletList":
        return `<ul>${children(n)}</ul>`;
      case "orderedList":
        return a.start && a.start !== 1 ? `<ol start="${a.start}">${children(n)}</ol>` : `<ol>${children(n)}</ol>`;
      case "listItem":
        return `<li>${children(n)}</li>`;
      case "blockquote":
        return `<blockquote>${children(n)}</blockquote>`;
      case "codeBlock": {
        text.push("\n");
        const cls = a.language ? ` class="language-${esc(String(a.language))}"` : "";
        return `<pre><code${cls}>${(n.content ?? []).map((c) => (c.type === "text" ? (text.push(c.text!), esc(c.text!)) : "\n")).join("")}</code></pre>`;
      }
      case "horizontalRule":
        return "<hr>";
      case "hardBreak":
        text.push("\n");
        return "<br>";
      case "mention": {
        const id = String(a.id);
        mentions.add(id);
        text.push(`@${a.label}`);
        return `<a class="gcs-userLink gcs-mention" href="/members/${esc(id)}" data-user="${esc(id)}">@${esc(String(a.label))}</a>`;
      }
      case "image": {
        const src = a.attachmentId ? `/files/${String(a.attachmentId)}` : String(a.src);
        if (a.attachmentId) attachments.add(String(a.attachmentId));
        const size = (a.width ? ` width="${a.width}"` : "") + (a.height ? ` height="${a.height}"` : "");
        return `<img class="gcs-postImage" src="${esc(src)}" alt="${esc(String(a.alt ?? ""))}"${size} loading="lazy">`;
      }
      case "quote": {
        quotes.add(Number(a.postId));
        const author = opts.labels.quoteWrote.replace("{name}", esc(String(a.authorName)));
        return `<blockquote class="gcs-quote" data-post="${a.postId}"><span class="gcs-quote__author">${author}</span>${children(n)}</blockquote>`;
      }
      case "spoiler": {
        const summary = esc(a.summary ? String(a.summary) : opts.labels.spoiler);
        return `<details class="gcs-spoiler"><summary>${summary}</summary>${children(n)}</details>`;
      }
      case "embed": {
        const url = String(a.url);
        const embed = parseEmbedUrl(url);
        if (!embed) invalid();
        text.push(`\n${url}\n`);
        if (!opts.embeds.includes(embed.provider)) return `<p>${link(url, esc(url))}</p>`;
        if (embed.provider === "image") return `<img class="gcs-postImage" src="${esc(embed.id)}" alt="" loading="lazy">`;
        const src = embedIframeSrc(embed, opts.siteHost);
        if (!src) invalid();
        return (
          `<div class="gcs-embed gcs-embed--${embed.provider satisfies GcsEmbedProvider}"><iframe src="${esc(src)}" ` +
          `title="${embed.provider}" loading="lazy" allowfullscreen sandbox="${SANDBOX}"></iframe></div>`
        );
      }
      default:
        return invalid();
    }
  }

  const html = (doc.content ?? []).map(render).join("");
  return {
    html,
    text: text.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim(),
    mentions: [...mentions],
    attachments: [...attachments],
    quotes: [...quotes],
  };
}

/** A doua linie de apărare: chiar dacă randarea de mai sus ar greși, doar acest HTML ajunge în pagină. */
// `allowedEmptyAttributes` există în sanitize-html 2.x, dar lipsește din @types/sanitize-html.
const SANITIZE: sanitizeHtml.IOptions & { allowedEmptyAttributes: string[] } = {
  allowedTags: [
    "p", "br", "hr", "h2", "h3", "h4", "strong", "em", "u", "s", "code", "pre", "a", "ul", "ol", "li",
    "blockquote", "span", "details", "summary", "img", "div", "iframe",
  ],
  allowedAttributes: {
    a: ["href", "rel", "target", "class", "data-user"],
    img: ["src", "alt", "width", "height", "loading", "class"],
    iframe: ["src", "title", "loading", "allowfullscreen", "sandbox"],
    blockquote: ["class", "data-post"],
    ol: ["start"],
    code: ["class"],
    span: ["class"],
    div: ["class"],
    details: ["class"],
  },
  allowedClasses: { "*": ["gcs-*", "language-*"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  allowedIframeHostnames: GCS_EMBED_IFRAME_HOSTS,
  allowIframeRelativeUrls: false,
  allowedEmptyAttributes: ["alt", "allowfullscreen"],
  disallowedTagsMode: "discard",
};

/**
 * JSON Tiptap → HTML sanitizat (specul etapei 2, §5). Singurul loc în care se produce HTML din conținutul userilor:
 * clientul trimite doar JSON, validat strict aici (orice nod sau atribut necunoscut → `GcsValidationError`).
 */
export class GcsContentRenderer {
  render(raw: unknown, opts: GcsRenderOptions): GcsRendered {
    const json = validate(raw);
    const out = toHtml(json, opts);
    return { json, ...out, html: sanitizeHtml(out.html, SANITIZE) };
  }
}

/**
 * Mențiunile și citatele dintr-un document salvat, pentru notificări. Ce e în interiorul unui citat nu contează
 * (cine e menționat în textul citat a fost deja notificat de postarea originală).
 */
export function contentRefs(json: unknown): { mentions: string[]; quotes: number[] } {
  const mentions = new Set<string>();
  const quotes = new Set<number>();
  const walk = (n: unknown, depth: number) => {
    if (depth > 50 || typeof n !== "object" || n === null) return;
    const node = n as GcsDocNode;
    if (node.type === "mention" && typeof node.attrs?.id === "string") mentions.add(node.attrs.id);
    if (node.type === "quote") {
      const postId = Number(node.attrs?.postId);
      if (Number.isSafeInteger(postId) && postId > 0) quotes.add(postId);
      return;
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c, depth + 1);
  };
  walk(json, 0);
  return { mentions: [...mentions], quotes: [...quotes] };
}
