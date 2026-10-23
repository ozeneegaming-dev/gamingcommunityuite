import sanitizeHtml from "sanitize-html";
import { GcsValidationError } from "../errors";
import { GCS_BLOCK_OF_NODE, GCS_BLOCK_TONES, GCS_CALLOUT_KINDS, GCS_HIDDEN_MODES, sanitizeHtmlBlock, type GcsBlockType, type GcsHiddenPart } from "./blocks";
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
  /**
   * Grupurile pe care autorul le poate menționa (id → numele curent), calculate de apelant (`GcsGroupMentionService`).
   * O mențiune de grup care nu e aici (sau fără listă: semnături, importuri…) devine text simplu `@Nume`.
   */
  groups?: ReadonlyMap<string, { name: string }>;
  /**
   * Forum v2: familiile de blocuri pe care autorul le poate folosi (permisiunile `forums.block_*`, calculate de
   * apelant). Lipsă = niciun bloc (semnături, mesaje private, câmpuri): un bloc nepermis → `block_forbidden`.
   */
  blocks?: readonly GcsBlockType[];
  /** SVG-ul unei iconițe Font Awesome după nume (iconițele blocurilor); lipsă = blocurile fără iconițe. */
  icon?: (name: string) => string | null;
};

export type GcsRendered = {
  json: GcsDoc;
  html: string;
  /** Textul simplu: pentru căutare, OpenGraph și lungimea maximă. */
  text: string;
  /** Membrii menționați (mențiunile fără `kind` sau cu `kind: "user"`). */
  mentions: string[];
  /** Grupurile menționate (doar cele permise, păstrate ca pastile). */
  groupMentions: number[];
  attachments: string[];
  quotes: number[];
  /** Forum v2: blocurile „conținut ascuns”, scoase din `html` (în locul lor rămâne un marcaj gol). */
  hiddenParts: GcsHiddenPart[];
};

/** Tipul unei mențiuni: un membru (implicit, și pentru conținutul vechi fără `kind`) sau un grup. */
export const GCS_MENTION_KINDS = ["user", "group"] as const;
export type GcsMentionKind = (typeof GCS_MENTION_KINDS)[number];
/** Eticheta salvată a unei mențiuni (numele membrului sau al grupului). */
const MENTION_LABEL_MAX = 40;

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
const oneOf = (values: readonly string[]): AttrRule => (v) => typeof v === "string" && values.includes(v);

/** Formatarea din editor (etapa 5): doar aceste valori ajung în `style`, verificate aici și de sanitizer. */
export const GCS_TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
export const GCS_FONT_SIZES = ["12px", "14px", "18px", "24px", "32px"] as const;
export const GCS_HIGHLIGHTS = ["#FDE68A", "#BBF7D0", "#BFDBFE", "#FBCFE8", "#FECACA"] as const;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const isColor: AttrRule = (v) => typeof v === "string" && HEX_COLOR.test(v);
const textAlign = optional(oneOf(GCS_TEXT_ALIGNS));
/** O iconiță Font Awesome după nume (`fa-solid fa-gift`); iconițele necunoscute nu se desenează. */
const isIcon: AttrRule = (v) => typeof v === "string" && /^fa-(?:solid|regular|brands) fa-[a-z0-9-]{1,60}$/.test(v);

/** Grupurile de noduri: blocurile, textul, elementele de listă și copiii blocurilor (carduri, coloane, pași). */
type NodeGroup = "block" | "inline" | "listItem" | "blockCard" | "blockColumn" | "blockStep";
type NodeSpec = {
  group: NodeGroup;
  /** Ce conținut acceptă: un grup, sau nimic (nod frunză). */
  content?: NodeGroup;
  attrs?: Record<string, AttrRule>;
  /** Atributele obligatorii. */
  required?: string[];
};

/** Nodurile permise. Editorul (`GcsEditor`) definește exact aceleași noduri și atribute. */
export const GCS_DOC_NODES: Record<string, NodeSpec> = {
  paragraph: { group: "block", content: "inline", attrs: { textAlign } },
  heading: { group: "block", content: "inline", attrs: { level: isInt(2, 4), textAlign }, required: ["level"] },
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
    attrs: { id: isId, label: isText(MENTION_LABEL_MAX, 1), mentionSuggestionChar: optional((v) => v === "@"), kind: optional(oneOf(GCS_MENTION_KINDS)) },
    required: ["id", "label"],
  },
  // ─── Forum v2: blocurile sigure (macheta GiveawayBlocks) ───
  gcsSection: { group: "block", content: "block", attrs: { title: optional(isText(120)), icon: optional(isIcon), tone: optional(oneOf(GCS_BLOCK_TONES)) } },
  gcsCallout: { group: "block", content: "block", attrs: { kind: oneOf(GCS_CALLOUT_KINDS), title: optional(isText(120)) }, required: ["kind"] },
  gcsCardGrid: { group: "block", content: "blockCard", attrs: { columns: optional(isInt(1, 4)) } },
  gcsCard: {
    group: "blockCard",
    attrs: { title: isText(120, 1), subtitle: optional(isText(160)), value: optional(isText(60)), badge: optional(isText(30)), icon: optional(isIcon), highlight: optional((v) => v === "1") },
    required: ["title"],
  },
  gcsButton: { group: "block", attrs: { label: isText(60, 1), href: (v) => typeof v === "string" && isSafeHref(v), variant: optional(oneOf(["primary", "ghost"])), icon: optional(isIcon) }, required: ["label", "href"] },
  gcsColumns: { group: "block", content: "blockColumn" },
  gcsColumn: { group: "blockColumn", content: "block" },
  gcsSteps: { group: "block", content: "blockStep" },
  gcsStep: { group: "blockStep", content: "block", attrs: { title: optional(isText(120)) } },
  gcsProgress: { group: "block", attrs: { label: isText(80, 1), value: isInt(0, 1_000_000_000), max: isInt(1, 1_000_000_000) }, required: ["label", "value", "max"] },
  gcsHidden: { group: "block", content: "block", attrs: { mode: oneOf(GCS_HIDDEN_MODES), groups: optional((v) => typeof v === "string" && /^\d{1,9}(?:,\d{1,9}){0,19}$/.test(v)), label: optional(isText(120)) }, required: ["mode"] },
  gcsHtml: { group: "block", attrs: { html: isText(20_000, 1) }, required: ["html"] },
};

/** Mărcile permise. La `link`, `target`/`rel`/`class`/`title` din Tiptap sunt acceptate, dar ignorate (le punem noi). */
export const GCS_DOC_MARKS: Record<string, Record<string, AttrRule>> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  link: { href: (v) => typeof v === "string" && isSafeHref(v), target: any, rel: any, class: any, title: any },
  subscript: {},
  superscript: {},
  highlight: { color: optional(oneOf(GCS_HIGHLIGHTS)) },
  textStyle: { color: optional(isColor), fontSize: optional(oneOf(GCS_FONT_SIZES)) },
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

/** Un bloc pe care autorul nu-l poate folosi (permisiunile `forums.block_*`). */
function forbiddenBlock(block: GcsBlockType): never {
  throw new GcsValidationError({ content: "block_forbidden" }, { block });
}

/** Validează documentul și întoarce o copie care conține doar câmpurile cunoscute. */
function validate(raw: unknown, allowedBlocks: readonly GcsBlockType[] = []): GcsDoc {
  let nodes = 0;

  function node(value: unknown, expected: NodeGroup, depth: number): GcsDocNode {
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
          if (attrs && (m.type === "highlight" || m.type === "textStyle")) return { type: m.type, attrs: attrs as Record<string, string> };
          return { type: m.type };
        });
        if (marks.length > 0) out.marks = marks;
      }
      return out;
    }

    const spec = GCS_DOC_NODES[value.type];
    if (!spec || spec.group !== expected) invalid();
    const block = GCS_BLOCK_OF_NODE[value.type];
    if (block && !allowedBlocks.includes(block)) forbiddenBlock(block);
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

/**
 * Mențiunile de grup (Mențiuni v2): cele permise primesc numele curent al grupului (autorul nu poate pune altă
 * etichetă pe pastilă); celelalte devin text simplu `@Nume`, și în JSON-ul salvat.
 */
function resolveGroupMentions(doc: GcsDoc, groups: ReadonlyMap<string, { name: string }> | undefined): GcsDoc {
  const walk = (n: GcsDocNode): GcsDocNode => {
    if (n.type === "mention" && n.attrs?.kind === "group") {
      const group = groups?.get(String(n.attrs.id));
      if (!group) return { type: "text", text: `@${String(n.attrs.label)}` };
      return { ...n, attrs: { ...n.attrs, label: group.name.slice(0, MENTION_LABEL_MAX) } };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(doc) as GcsDoc;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LINK_ATTRS = 'rel="nofollow ugc noopener" target="_blank"';
const SANDBOX = "allow-scripts allow-same-origin allow-popups allow-presentation";

/** Transformă JSON-ul validat în HTML și colectează textul, mențiunile, atașamentele și citatele. */
function toHtml(doc: GcsDoc, opts: GcsRenderOptions) {
  const text: string[] = [];
  const hiddenParts: GcsHiddenPart[] = [];
  // Iconițele blocurilor: un marcaj gol acum, înlocuit cu SVG-ul după sanitizare (`withBlockIcons`).
  const iconTag = (name: unknown, cls: string) => (typeof name === "string" && opts.icon ? `<i class="gcs-blockIcon ${cls}" data-gcs-icon="${esc(name)}"></i>` : "");
  const mentions = new Set<string>();
  const groupMentions = new Set<number>();
  const attachments = new Set<string>();
  const quotes = new Set<number>();

  const children = (n: GcsDocNode) => (n.content ?? []).map(render).join("");
  // Alinierea implicită (stânga) nu are nevoie de `style`.
  const align = (a: Record<string, string | number | null>) => (a.textAlign && a.textAlign !== "left" ? ` style="text-align:${a.textAlign}"` : "");
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
          else if (mark.type === "subscript") html = `<sub>${html}</sub>`;
          else if (mark.type === "superscript") html = `<sup>${html}</sup>`;
          else if (mark.type === "highlight") {
            const color = mark.attrs?.color;
            html = color ? `<mark style="background-color:${color}">${html}</mark>` : `<mark>${html}</mark>`;
          } else if (mark.type === "textStyle") {
            const styles = [mark.attrs?.color ? `color:${mark.attrs.color}` : "", mark.attrs?.fontSize ? `font-size:${mark.attrs.fontSize}` : ""].filter(Boolean);
            if (styles.length > 0) html = `<span style="${styles.join(";")}">${html}</span>`;
          }
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
        return `<p${align(a)}>${children(n)}</p>`;
      case "heading":
        text.push("\n");
        return `<h${a.level}${align(a)}>${children(n)}</h${a.level}>`;
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
        text.push(`@${a.label}`);
        // Doar grupurile permise ajung aici ca mențiuni de grup (`resolveGroupMentions`); culoarea și iconița vin din
        // CSS-ul generat (`/gcs-names.css`), deci rămân la zi și pentru conținutul salvat.
        if (a.kind === "group") {
          groupMentions.add(Number(id));
          return `<a class="gcs-groupMention" href="/members?group=${esc(id)}" data-group-id="${esc(id)}">@${esc(String(a.label))}</a>`;
        }
        mentions.add(id);
        // `data-user`: formatul vechi (HTML-ul deja salvat îl are doar pe acesta); `data-user-id`: hover card-ul.
        return `<a class="gcs-userLink gcs-mention" href="/members/${esc(id)}" data-user="${esc(id)}" data-user-id="${esc(id)}">@${esc(String(a.label))}</a>`;
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
      case "gcsSection": {
        const tone = a.tone ? String(a.tone) : "accent";
        const head = a.title || a.icon ? `<div class="gcs-block__head">${iconTag(a.icon, "gcs-block__icon")}${a.title ? `<strong class="gcs-block__title">${esc(String(a.title))}</strong>` : ""}</div>` : "";
        if (a.title) text.push(`\n${String(a.title)}\n`);
        return `<section class="gcs-block gcs-block--section gcs-blockTone--${tone}">${head}<div class="gcs-block__body">${children(n)}</div></section>`;
      }
      case "gcsCallout": {
        const kind = String(a.kind);
        const icon = kind === "warning" ? "fa-solid fa-triangle-exclamation" : kind === "success" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-info";
        if (a.title) text.push(`\n${String(a.title)}\n`);
        const title = a.title ? `<strong class="gcs-block__title">${esc(String(a.title))}</strong>` : "";
        return `<div class="gcs-block gcs-block--callout gcs-callout--${kind}" role="note">${iconTag(icon, "gcs-callout__icon")}<div class="gcs-block__body">${title}${children(n)}</div></div>`;
      }
      case "gcsCardGrid":
        return `<div class="gcs-block gcs-block--cards" data-columns="${a.columns ?? 3}">${children(n)}</div>`;
      case "gcsCard": {
        text.push(`\n${String(a.title)}${a.subtitle ? ` ${String(a.subtitle)}` : ""}${a.value ? ` ${String(a.value)}` : ""}\n`);
        return (
          `<div class="gcs-blockCard${a.highlight === "1" ? " gcs-blockCard--highlight" : ""}">` +
          (a.badge ? `<span class="gcs-blockCard__badge">${esc(String(a.badge))}</span>` : "") +
          iconTag(a.icon, "gcs-blockCard__icon") +
          `<strong class="gcs-blockCard__title">${esc(String(a.title))}</strong>` +
          (a.subtitle ? `<span class="gcs-blockCard__sub">${esc(String(a.subtitle))}</span>` : "") +
          (a.value ? `<span class="gcs-blockCard__value">${esc(String(a.value))}</span>` : "") +
          `</div>`
        );
      }
      case "gcsButton": {
        const href = String(a.href);
        const variant = a.variant === "ghost" ? "ghost" : "primary";
        const external = !href.startsWith("/") && !href.startsWith("#");
        text.push(`\n${String(a.label)}\n`);
        return `<p class="gcs-block gcs-block--button"><a class="gcs-btn gcs-btn--${variant} gcs-blockBtn" href="${esc(href)}"${external ? ` ${LINK_ATTRS}` : ""}>${iconTag(a.icon, "gcs-btn__icon")}<span>${esc(String(a.label))}</span></a></p>`;
      }
      case "gcsColumns":
        return `<div class="gcs-block gcs-block--columns" data-columns="${Math.min(Math.max(n.content?.length ?? 2, 2), 3)}">${children(n)}</div>`;
      case "gcsColumn":
        return `<div class="gcs-blockCol">${children(n)}</div>`;
      case "gcsSteps":
        return `<ol class="gcs-block gcs-block--steps">${children(n)}</ol>`;
      case "gcsStep": {
        if (a.title) text.push(`\n${String(a.title)}\n`);
        return `<li class="gcs-blockStep">${a.title ? `<strong class="gcs-blockStep__title">${esc(String(a.title))}</strong>` : ""}<div class="gcs-block__body">${children(n)}</div></li>`;
      }
      case "gcsProgress": {
        const value = Number(a.value);
        const max = Number(a.max);
        const pct = Math.round(Math.min(100, Math.max(0, (value / max) * 100)) * 10) / 10;
        text.push(`\n${String(a.label)} ${value} / ${max}\n`);
        return (
          `<div class="gcs-block gcs-block--progress" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.min(value, max)}" aria-label="${esc(String(a.label))}">` +
          `<div class="gcs-progress__head"><span class="gcs-progress__label">${esc(String(a.label))}</span><span class="gcs-progress__value">${value} / ${max}</span></div>` +
          `<div class="gcs-progress__track"><span class="gcs-progress__fill" style="width:${pct}%"></span></div></div>`
        );
      }
      case "gcsHidden": {
        // Conținutul ascuns nu rămâne în HTML (nici în text, deci nici în căutare): îl arată pagina, per vizitator.
        const id = `h${hiddenParts.length + 1}`;
        const mark = text.length;
        const inner = children(n);
        text.length = mark;
        const groups = typeof a.groups === "string" && a.groups ? a.groups.split(",").map(Number) : [];
        hiddenParts.push({ id, mode: String(a.mode) as GcsHiddenPart["mode"], groups, label: a.label ? String(a.label) : null, html: inner });
        return `<div class="gcs-hiddenBlock" data-hidden-id="${id}" data-hidden-mode="${esc(String(a.mode))}"></div>`;
      }
      case "gcsHtml":
        // Doar Root Admin (permisiunea `forums.block_html`); lista albă a blocului HTML, nu a postărilor.
        return `<div class="gcs-block gcs-block--html">${sanitizeHtmlBlock(String(a.html))}</div>`;
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
    groupMentions: [...groupMentions],
    attachments: [...attachments],
    quotes: [...quotes],
    hiddenParts,
  };
}

/** Marcajele iconițelor blocurilor (puse înaintea sanitizării) → SVG-ul iconiței, sau nimic dacă e necunoscută. */
function withBlockIcons(html: string, icon: GcsRenderOptions["icon"]): string {
  if (!html.includes("data-gcs-icon")) return html;
  return html.replace(/<i class="gcs-blockIcon ([a-zA-Z_ -]*)" data-gcs-icon="([a-z0-9 -]{1,80})"><\/i>/g, (_m, cls: string, name: string) => {
    const svg = icon?.(name);
    return svg ? `<span class="gcs-blockIcon ${cls.replace(/[^a-zA-Z_ -]/g, "")}" aria-hidden="true">${svg}</span>` : "";
  });
}

/** A doua linie de apărare: chiar dacă randarea de mai sus ar greși, doar acest HTML ajunge în pagină. */
// `allowedEmptyAttributes` există în sanitize-html 2.x, dar lipsește din @types/sanitize-html.
const SANITIZE: sanitizeHtml.IOptions & { allowedEmptyAttributes: string[] } = {
  allowedTags: [
    "p", "br", "hr", "h2", "h3", "h4", "strong", "em", "u", "s", "code", "pre", "a", "ul", "ol", "li",
    "blockquote", "span", "details", "summary", "img", "div", "iframe", "sub", "sup", "mark",
    // Forum v2: blocurile (secțiuni, carduri, pași, progres) și iconițele lor (SVG-ul registrului, fără atribute active).
    "section", "i", "svg", "path",
    // Blocul HTML (doar Root, deja trecut prin lista lui albă): tabelele.
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "small",
  ],
  allowedAttributes: {
    a: ["href", "rel", "target", "class", "data-user", "data-user-id", "data-group-id"],
    section: ["class"],
    i: ["class", "data-gcs-icon"],
    svg: ["class", "viewbox", "viewBox", "width", "height", "fill", "focusable", "aria-hidden", "data-icon"],
    path: ["d"],
    li: ["class"],
    table: ["class"],
    thead: ["class"],
    tbody: ["class"],
    tfoot: ["class"],
    tr: ["class"],
    caption: ["class"],
    small: ["class"],
    th: ["colspan", "rowspan", "class", "style", "scope"],
    td: ["colspan", "rowspan", "class", "style"],
    img: ["src", "alt", "width", "height", "loading", "class"],
    iframe: ["src", "title", "loading", "allowfullscreen", "sandbox"],
    blockquote: ["class", "data-post"],
    ol: ["start", "class"],
    code: ["class"],
    span: ["class", "style", "aria-hidden"],
    p: ["style", "class"],
    strong: ["class"],
    h2: ["style"],
    h3: ["style"],
    h4: ["style"],
    mark: ["style"],
    div: ["class", "data-columns", "data-hidden-id", "data-hidden-mode", "role", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-label"],
    details: ["class"],
  },
  allowedClasses: { "*": ["gcs-*", "language-*"] },
  // Doar proprietățile și valorile din editor; orice altceva (url(), expression(), alte proprietăți) dispare.
  allowedStyles: {
    "*": {
      color: [/^#[0-9a-fA-F]{6}$/],
      "background-color": [/^#[0-9a-fA-F]{6}$/],
      "font-size": [/^(?:12|14|18|24|32)px$/],
      "text-align": [/^(?:left|center|right|justify)$/],
      // Bara de progres a blocului „Progres”.
      width: [/^\d{1,3}(?:\.\d)?%$/],
      // Blocul HTML (doar Root): îngroșarea textului.
      "font-weight": [/^(?:400|600|700|bold|normal)$/],
    },
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  allowedIframeHostnames: GCS_EMBED_IFRAME_HOSTS,
  allowIframeRelativeUrls: false,
  allowedEmptyAttributes: ["alt", "allowfullscreen"],
  disallowedTagsMode: "discard",
};

/** Re-sanitizează HTML de conținut venit din afara renderer-ului (ex. traducerea unei postări), cu aceleași reguli. */
export function sanitizeContentHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE);
}

/**
 * JSON Tiptap → HTML sanitizat (specul etapei 2, §5). Singurul loc în care se produce HTML din conținutul userilor:
 * clientul trimite doar JSON, validat strict aici (orice nod sau atribut necunoscut → `GcsValidationError`).
 */
export class GcsContentRenderer {
  render(raw: unknown, opts: GcsRenderOptions): GcsRendered {
    const json = resolveGroupMentions(validate(raw, opts.blocks ?? []), opts.groups);
    const out = toHtml(json, opts);
    const clean = (html: string) => withBlockIcons(sanitizeHtml(html, SANITIZE), opts.icon);
    return { json, ...out, html: clean(out.html), hiddenParts: out.hiddenParts.map((p) => ({ ...p, html: clean(p.html) })) };
  }
}

/**
 * Mențiunile (membri și grupuri) și citatele dintr-un document salvat, pentru notificări. Ce e în interiorul unui citat
 * nu contează (cine e menționat în textul citat a fost deja notificat de postarea originală).
 */
export function contentRefs(json: unknown): { mentions: string[]; groups: number[]; quotes: number[] } {
  const mentions = new Set<string>();
  const groups = new Set<number>();
  const quotes = new Set<number>();
  const walk = (n: unknown, depth: number) => {
    if (depth > 50 || typeof n !== "object" || n === null) return;
    const node = n as GcsDocNode;
    if (node.type === "mention" && typeof node.attrs?.id === "string") {
      if (node.attrs.kind !== "group") mentions.add(node.attrs.id);
      else if (/^\d{1,9}$/.test(node.attrs.id)) groups.add(Number(node.attrs.id));
    }
    if (node.type === "quote") {
      const postId = Number(node.attrs?.postId);
      if (Number.isSafeInteger(postId) && postId > 0) quotes.add(postId);
      return;
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c, depth + 1);
  };
  walk(json, 0);
  return { mentions: [...mentions], groups: [...groups], quotes: [...quotes] };
}
