import { mergeAttributes, Node, type Extensions } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import Mention, { type MentionOptions } from "@tiptap/extension-mention";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { gcsBlockExtensions, type GcsEditorBlock } from "./blocks";

/**
 * Nodurile și mărcile pe care editorul le poate produce. Trebuie să fie exact cele acceptate de
 * `GcsContentRenderer` pe server (un test din `apps/web` compară cele două liste și validează JSON-ul editorului).
 */
export const GCS_EDITOR_NODES = [
  "doc",
  "text",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "image",
  "quote",
  "spoiler",
  "embed",
  "mention",
  // Forum v2: blocurile sigure (doar în postările forumului, după permisiunile autorului).
  "gcsSection",
  "gcsCallout",
  "gcsCardGrid",
  "gcsCard",
  "gcsButton",
  "gcsColumns",
  "gcsColumn",
  "gcsSteps",
  "gcsStep",
  "gcsProgress",
  "gcsHidden",
  "gcsHtml",
] as const;
export const GCS_EDITOR_MARKS = ["bold", "italic", "underline", "strike", "code", "link", "subscript", "superscript", "highlight", "textStyle"] as const;

/** Valorile oferite de bara de unelte; serverul (`GcsContentRenderer`) acceptă exact aceleași. */
export const GCS_EDITOR_FONT_SIZES = ["12px", "14px", "18px", "24px", "32px"] as const;
export const GCS_EDITOR_HIGHLIGHTS = ["#FDE68A", "#BBF7D0", "#BFDBFE", "#FBCFE8", "#FECACA"] as const;
export const GCS_EDITOR_COLORS = ["#D62839", "#FF6B74", "#F4B740", "#3DDC97", "#5EA2FF", "#A78BFA", "#F472B6", "#A1A7B4", "#ECEDF1", "#14161C"] as const;
export const GCS_EDITOR_ALIGNS = ["left", "center", "right", "justify"] as const;

/** Citatul unei postări: autorul și id-ul postării, cu conținutul citat. */
export const GcsQuote = Node.create({
  name: "quote",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      postId: { default: null, parseHTML: (el) => Number(el.getAttribute("data-post")) || null, renderHTML: (a) => ({ "data-post": a.postId }) },
      authorId: { default: null, parseHTML: (el) => el.getAttribute("data-author-id"), renderHTML: (a) => ({ "data-author-id": a.authorId }) },
      authorName: { default: null, parseHTML: (el) => el.getAttribute("data-author"), renderHTML: (a) => ({ "data-author": a.authorName }) },
    };
  },
  parseHTML() {
    return [{ tag: "blockquote.gcs-quote", priority: 60 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["blockquote", mergeAttributes({ class: "gcs-quote" }, HTMLAttributes), 0];
  },
});

/** Spoiler: conținut ascuns până la click (pe site e `<details>`; în editor, un bloc marcat). */
export const GcsSpoiler = Node.create({
  name: "spoiler",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { summary: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div.gcs-spoiler" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ class: "gcs-spoiler gcs-spoiler--editor" }, HTMLAttributes), 0];
  },
});

/** Un video (YouTube, Twitch, Medal) sau o imagine externă; serverul îl validează și generează iframe-ul. */
export const GcsEmbed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  addAttributes() {
    return { url: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-embed-url]", getAttrs: (el) => ({ url: (el as HTMLElement).getAttribute("data-embed-url") }) }];
  },
  renderHTML({ node }) {
    return ["div", { class: "gcs-embedPreview", "data-embed-url": node.attrs.url as string }, ["span", {}, `▶ ${node.attrs.url as string}`]];
  },
});

/**
 * Mențiunea (Mențiuni v2): `kind` = `user` (implicit, și pentru conținutul vechi) sau `group`. Pastila unui grup are în
 * editor aceleași clase și `data-group-id` ca pe site, deci culoarea și iconița grupului vin din același CSS generat.
 */
export const GcsMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: null,
        parseHTML: (el) => {
          const kind = el.getAttribute("data-kind");
          return kind === "user" || kind === "group" ? kind : null;
        },
        renderHTML: (a) =>
          a.kind === "group" ? { "data-kind": "group", class: "gcs-groupMention", "data-group-id": a.id as string } : a.kind === "user" ? { "data-kind": "user" } : {},
      },
    };
  },
});

/** Imaginea dintr-un atașament: în JSON apare doar `attachmentId` (fără `src`), ca serverul să o lege de postare. */
export const GcsImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), attachmentId: { default: null } };
  },
  renderHTML({ node, HTMLAttributes }) {
    const id = node.attrs.attachmentId as string | null;
    return ["img", mergeAttributes(HTMLAttributes, { class: "gcs-postImage", ...(id ? { src: `/files/${id}` } : {}) })];
  },
});

/**
 * O culoare din HTML-ul lipit (`#rgb`, `#rrggbb`, `rgb(…)`; browserele normalizează stilurile la `rgb(…)`) → `#RRGGBB`,
 * singura formă acceptată de server. Altceva (nume, transparență) → `null`: textul rămâne, culoarea nu.
 */
export function toHexColor(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join("")}`.toUpperCase();
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(v);
  if (!rgb || (rgb[4] !== undefined && Number.parseFloat(rgb[4]) < (rgb[4].endsWith("%") ? 100 : 1))) return null;
  return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const oneOf = <T extends string>(values: readonly T[], v: string | null) => (v && (values as readonly string[]).includes(v) ? v : null);

/** Culoarea textului: la lipire, adusă la `#RRGGBB` (altfel serverul ar respinge tot documentul). */
const GcsColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (el) => toHexColor(el.style.color),
            renderHTML: (a) => (a.color ? { style: `color: ${a.color as string}` } : {}),
          },
        },
      },
    ];
  },
});

/** Mărimea: doar valorile din bara de unelte (o mărime lipsă sau alta → fără mărime, nu `""`). */
const GcsFontSize = FontSize.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => oneOf(GCS_EDITOR_FONT_SIZES, el.style.fontSize),
            renderHTML: (a) => (a.fontSize ? { style: `font-size: ${a.fontSize as string}` } : {}),
          },
        },
      },
    ];
  },
});

/** Evidențierea: doar culorile din bara de unelte; altă culoare lipită → evidențierea implicită. */
const GcsHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => oneOf(GCS_EDITOR_HIGHLIGHTS, toHexColor(el.getAttribute("data-color") || el.style.backgroundColor)),
        // Fără `color: inherit`: textul evidențiat rămâne închis la culoare (regula `.gcs-editor__content mark`).
        renderHTML: (a) => (a.color ? { "data-color": a.color as string, style: `background-color: ${a.color as string}` } : {}),
      },
    };
  },
});

/**
 * Ce poate conține un câmp (varianta compactă a editorului): nodurile și mărcile încărcate în schemă. Ce nu e în
 * schemă nu se poate nici scrie, nici lipi (ex. un titlu lipit într-o semnătură devine paragraf). Lipsă = tot editorul
 * postărilor. Listele vin din profilurile serverului (`@gcs/core/rich-fields`).
 */
export type GcsEditorAllow = { nodes: readonly string[]; marks: readonly string[] };

/**
 * Extensiile editorului. `mention` primește sugestiile (vezi `mentions.tsx`); `allow` restrânge schema; `blocks`: familiile
 * de blocuri permise autorului (Forum v2; lipsă = niciun bloc în schemă).
 */
export function gcsEditorExtensions(opts: { placeholder: string; mention?: Partial<MentionOptions>["suggestion"]; maxLength?: number; allow?: GcsEditorAllow; blocks?: readonly GcsEditorBlock[] }): Extensions {
  const node = (n: (typeof GCS_EDITOR_NODES)[number]) => !opts.allow || opts.allow.nodes.includes(n);
  const mark = (m: (typeof GCS_EDITOR_MARKS)[number]) => !opts.allow || opts.allow.marks.includes(m);
  const off = <K extends string>(key: K, on: boolean) => (on ? {} : ({ [key]: false } as Record<K, false>));
  const lists = node("bulletList") || node("orderedList");
  return [
    StarterKit.configure({
      heading: node("heading") ? { levels: [2, 3, 4] } : false,
      link: mark("link") ? { openOnClick: false, autolink: true, defaultProtocol: "https" } : false,
      ...off("blockquote", node("blockquote")),
      ...off("bulletList", node("bulletList")),
      ...off("orderedList", node("orderedList")),
      ...off("listItem", lists),
      ...off("listKeymap", lists),
      ...off("codeBlock", node("codeBlock")),
      ...off("horizontalRule", node("horizontalRule")),
      ...off("bold", mark("bold")),
      ...off("italic", mark("italic")),
      ...off("underline", mark("underline")),
      ...off("strike", mark("strike")),
      ...off("code", mark("code")),
    }),
    ...(node("image") ? [GcsImage.configure({ inline: false, allowBase64: false })] : []),
    ...(node("quote") ? [GcsQuote] : []),
    ...(node("spoiler") ? [GcsSpoiler] : []),
    ...(node("embed") ? [GcsEmbed] : []),
    ...(node("mention")
      ? [
          GcsMention.configure({
            HTMLAttributes: { class: "gcs-mention" },
            renderText: ({ node: n }) => `@${(n.attrs.label as string | null) ?? ""}`,
            ...(opts.mention ? { suggestion: opts.mention } : {}),
          }),
        ]
      : []),
    Placeholder.configure({ placeholder: opts.placeholder }),
    // Formatarea din etapa 5: culoare și mărime (textStyle), evidențiere, indice / exponent, aliniere.
    ...(mark("textStyle") ? [TextStyle, GcsColor, GcsFontSize] : []),
    ...(mark("highlight") ? [GcsHighlight.configure({ multicolor: true })] : []),
    ...(mark("subscript") ? [Subscript] : []),
    ...(mark("superscript") ? [Superscript] : []),
    ...(opts.blocks && opts.blocks.length > 0 && !opts.allow ? gcsBlockExtensions(opts.blocks) : []),
    TextAlign.configure({ types: node("heading") ? ["heading", "paragraph"] : ["paragraph"], alignments: [...GCS_EDITOR_ALIGNS] }),
    CharacterCount.configure(opts.maxLength ? { limit: opts.maxLength } : {}),
  ];
}

/** O adresă de imagine acceptată de server pentru câmpurile formatate (doar https, fără spații sau ghilimele). */
export function isImageUrl(text: string): boolean {
  const value = text.trim();
  return /^https:\/\/[^\s"'<>]+$/.test(value) && value.length <= 2000 && URL.canParse(value);
}

const EMBED_HOSTS = /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|twitch\.tv|clips\.twitch\.tv|medal\.tv)$/i;

/** Un text lipit e un link video care devine embed? Validarea completă o face serverul. */
export function isEmbedUrl(text: string): boolean {
  const value = text.trim();
  if (!/^https:\/\/\S+$/.test(value) || !URL.canParse(value)) return false;
  return EMBED_HOSTS.test(new URL(value).hostname);
}
