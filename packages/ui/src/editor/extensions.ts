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

/** Extensiile editorului. `mention` primește sugestiile (vezi `mentions.tsx`). */
export function gcsEditorExtensions(opts: { placeholder: string; mention?: Partial<MentionOptions>["suggestion"]; maxLength?: number }): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    GcsImage.configure({ inline: false, allowBase64: false }),
    GcsQuote,
    GcsSpoiler,
    GcsEmbed,
    Mention.configure({
      HTMLAttributes: { class: "gcs-mention" },
      renderText: ({ node }) => `@${(node.attrs.label as string | null) ?? ""}`,
      ...(opts.mention ? { suggestion: opts.mention } : {}),
    }),
    Placeholder.configure({ placeholder: opts.placeholder }),
    // Formatarea din etapa 5: culoare și mărime (textStyle), evidențiere, indice / exponent, aliniere.
    TextStyle,
    Color,
    FontSize,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: [...GCS_EDITOR_ALIGNS] }),
    CharacterCount.configure(opts.maxLength ? { limit: opts.maxLength } : {}),
  ];
}

const EMBED_HOSTS = /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|twitch\.tv|clips\.twitch\.tv|medal\.tv)$/i;

/** Un text lipit e un link video care devine embed? Validarea completă o face serverul. */
export function isEmbedUrl(text: string): boolean {
  const value = text.trim();
  if (!/^https:\/\/\S+$/.test(value) || !URL.canParse(value)) return false;
  return EMBED_HOSTS.test(new URL(value).hostname);
}
