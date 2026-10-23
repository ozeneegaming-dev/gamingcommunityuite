"use client";

import {
  faAlignCenter,
  faAlignJustify,
  faAlignLeft,
  faAlignRight,
  faAt,
  faBold,
  faCheck,
  faCode,
  faCompress,
  faExpand,
  faEyeSlash,
  faEraser,
  faFaceSmile,
  faGamepad,
  faGripLines,
  faHandPeace,
  faHighlighter,
  faImage,
  faItalic,
  faHeart,
  faLink,
  faLinkSlash,
  faListOl,
  faListUl,
  faPalette,
  faQuoteRight,
  faStrikethrough,
  faSubscript,
  faSuperscript,
  faTextSlash,
  faUnderline,
  faVideo,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { forwardRef, Fragment, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { cx } from "../cx";
import { GcsIconSvg } from "../icons/svg";
import { GcsBlockTools, type GcsBlockLabels, type GcsEditorBlock } from "./blocks";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import { GCS_EMOJI_CATEGORIES, GCS_QUICK_EMOJI, type GcsEmojiCategory } from "./emoji";
import { GCS_EDITOR_ALIGNS, GCS_EDITOR_COLORS, GCS_EDITOR_FONT_SIZES, GCS_EDITOR_HIGHLIGHTS, gcsEditorExtensions, isEmbedUrl, isImageUrl, type GcsEditorAllow } from "./extensions";
import { gcsMentionSuggestion } from "./mentions";
import { uploadFile } from "./uploads";

/** Textele editorului (traduse de pagină). */
export type GcsEditorLabels = {
  toolbar: string;
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  superscript: string;
  subscript: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignJustify: string;
  fontSize: string;
  sizeDefault: string;
  color: string;
  colorCustom: string;
  highlight: string;
  removeColor: string;
  clearFormatting: string;
  bulletList: string;
  orderedList: string;
  horizontalRule: string;
  link: string;
  linkUrl: string;
  removeLink: string;
  quote: string;
  code: string;
  spoiler: string;
  mention: string;
  image: string;
  /** Câmpul adresei, la butonul „Imagine” fără upload (`imageUrl`). */
  imageUrl: string;
  invalidImage: string;
  video: string;
  videoUrl: string;
  emoji: string;
  emojiSmileys: string;
  emojiPeople: string;
  emojiGaming: string;
  emojiSymbols: string;
  fullscreen: string;
  exitFullscreen: string;
  /** Contorul de caractere: `{count}`; cu limită, `charactersMax` cu `{count}` și `{max}`. */
  characters: string;
  charactersMax: string;
  insert: string;
  cancel: string;
  invalidVideo: string;
  placeholder: string;
  uploading: string;
  uploadFailed: string;
  noMentions: string;
  /** Lista de mențiuni: eticheta unui grup și a punctului „online”. */
  mentionGroup: string;
  mentionOnline: string;
};

/** Butoanele barei de unelte (varianta compactă alege dintre ele; fiecare apare doar dacă schema îl permite). */
export type GcsEditorTool =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "superscript"
  | "subscript"
  | "align"
  | "size"
  | "color"
  | "highlight"
  | "clear"
  | "bulletList"
  | "orderedList"
  | "horizontalRule"
  | "link"
  | "quote"
  | "code"
  | "spoiler"
  | "mention"
  | "image"
  | "video"
  | "emoji"
  | "fullscreen";

export type GcsQuoteInput = { postId: number; authorId: string | null; authorName: string; text: string };

export type GcsEditorHandle = {
  getJSON(): JSONContent;
  isEmpty(): boolean;
  /** Golește editorul și ciorna (după trimitere). */
  clear(): void;
  focus(): void;
  insertQuote(quote: GcsQuoteInput): void;
  setContent(doc: JSONContent): void;
};

export type GcsEditorProps = {
  labels: GcsEditorLabels;
  /** Forumul în care se postează (pentru permisiunea de upload). */
  forumId: number;
  uploadUrl?: string;
  mentionUrl?: string;
  /** Cheia ciornei din `localStorage`; fără ea, nu se salvează ciornă. */
  draftKey?: string;
  /** Documentul inițial (sau HTML, parsat de schemă: ce nu e permis dispare). */
  initialContent?: JSONContent | string | null;
  /** Varianta compactă: schema restrânsă la nodurile și mărcile câmpului (vezi `GcsEditorAllow`). */
  allow?: GcsEditorAllow;
  /** Butoanele afișate (implicit: toate cele permise de schemă). */
  tools?: readonly GcsEditorTool[];
  /** Butonul „Imagine” cere adresa unei imagini (https), fără upload. */
  imageUrl?: boolean;
  /** Mai scund, fără „Tot ecranul” (câmpuri mici: semnătura, câmpurile de profil). */
  compact?: boolean;
  /** Id-ul etichetei formularului (zona de scris primește `aria-labelledby`). */
  labelledBy?: string;
  /** Limita de caractere (contorul din subsol o arată; editorul nu lasă textul să o depășească). */
  maxLength?: number;
  /** La fiecare modificare: documentul (copie JSON simplă) și dacă editorul e gol. */
  onChange?: (doc: JSONContent, empty: boolean) => void;
  /** Forum v2: familiile de blocuri permise autorului (butonul „Blocuri” și „Setările blocului”) și textele lor. */
  blocks?: readonly GcsEditorBlock[];
  blockLabels?: GcsBlockLabels;
  /** Forum v2: lipirea ca text simplu (fără formatare), pornită din butonul „Lipește ca text” al paginii. */
  plainPaste?: boolean;
  footer?: ReactNode;
  id?: string;
  className?: string;
};

type Popover = "video" | "image" | "link" | "color" | "highlight" | "emoji" | null;

const DRAFT_DELAY_MS = 2000;
const EMOJI_TABS: GcsEmojiCategory[] = ["smileys", "people", "gaming", "symbols"];
/** Iconițele taburilor de emoji (textul rămâne în `aria-label` și `title`). */
const EMOJI_TAB_ICONS = { smileys: faFaceSmile, people: faHandPeace, gaming: faGamepad, symbols: faHeart } as const;

/** Paragrafele unui text simplu (blocurile despărțite de un rând gol). */
function paragraphs(text: string): JSONContent[] {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return (blocks.length > 0 ? blocks : [""]).map((b) => ({ type: "paragraph", content: b ? [{ type: "text", text: b }] : [] }));
}

/**
 * Editorul de postări (spec §7, etapa 5), construit pe Tiptap: formatare (inclusiv culoare, mărime, evidențiere,
 * aliniere), liste, link, citat, cod, spoiler, mențiuni, imagini și fișiere (buton, drag & drop sau paste, cu bară de
 * progres), video, emoji, fullscreen și contor de caractere. Produce JSON Tiptap; HTML-ul îl generează și îl
 * sanitizează doar serverul.
 */
export const GcsEditor = forwardRef<GcsEditorHandle, GcsEditorProps>(function GcsEditor(props, ref) {
  const { labels, forumId, uploadUrl, mentionUrl, draftKey, initialContent, maxLength, onChange, footer, id, className, allow, tools, imageUrl, compact, labelledBy, blocks, blockLabels, plainPaste } = props;
  const plainPasteRef = useRef(plainPaste === true);
  plainPasteRef.current = plainPaste === true;
  const fileInput = useRef<HTMLInputElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoError, setVideoError] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imageSrc, setImageSrc] = useState("");
  const [imageError, setImageError] = useState(false);
  const [emojiTab, setEmojiTab] = useState<GcsEmojiCategory>("smileys");
  const [fullscreen, setFullscreen] = useState(false);
  const baseId = id ?? "gcs-editor";

  const editor = useEditor({
    immediatelyRender: false,
    extensions: gcsEditorExtensions({
      placeholder: labels.placeholder,
      ...(mentionUrl ? { mention: gcsMentionSuggestion(mentionUrl, { empty: labels.noMentions, group: labels.mentionGroup, online: labels.mentionOnline }) } : {}),
      ...(maxLength ? { maxLength } : {}),
      ...(allow ? { allow } : {}),
      ...(blocks ? { blocks } : {}),
    }),
    content: initialContent ?? (draftKey ? loadDraft(draftKey) : null) ?? "",
    editorProps: {
      attributes: { class: "gcs-editor__content", ...(id ? { id } : {}), ...(labelledBy ? { "aria-labelledby": labelledBy } : {}), "aria-multiline": "true", role: "textbox" },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length > 0 && uploadUrl) {
          void uploadAll(files);
          return true;
        }
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (isEmbedUrl(text) && editorRef.current?.schema.nodes.embed) {
          editorRef.current?.chain().focus().insertContent({ type: "embed", attrs: { url: text.trim() } }).run();
          return true;
        }
        // Forum v2: „Lipește ca text”: doar textul, paragraf cu paragraf (fără stilurile paginii din care vine).
        if (plainPasteRef.current && text) {
          editorRef.current?.chain().focus().insertContent(paragraphs(text)).run();
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])];
        if (files.length === 0 || !uploadUrl) return false;
        event.preventDefault();
        void uploadAll(files);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange?.(JSON.parse(JSON.stringify(e.getJSON())) as JSONContent, e.isEmpty);
      if (!draftKey) return;
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => saveDraft(draftKey, e.getJSON()), DRAFT_DELAY_MS);
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // Starea butoanelor (active / dezactivate) și contorul, recalculate la fiecare tranzacție.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      active: (name: string, attrs?: Record<string, unknown>) => (e ? e.isActive(name, attrs) : false),
      aligned: (align: string) => (e ? e.isActive({ textAlign: align }) : false),
      fontSize: (e?.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      characters: e ? (e.storage.characterCount as { characters: () => number }).characters() : 0,
    }),
  });

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  // Escape iese din fullscreen; pagina nu derulează sub editorul pe tot ecranul.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

  async function uploadAll(files: File[]) {
    const e = editorRef.current;
    if (!e || !uploadUrl) return;
    for (const file of files) {
      setStatus(`${labels.uploading} ${file.name}`);
      setProgress(0);
      try {
        const up = await uploadFile(uploadUrl, forumId, file, setProgress);
        if (up.isImage) {
          e.chain().focus().insertContent({ type: "image", attrs: { attachmentId: up.id, alt: up.filename, width: up.width, height: up.height } }).run();
        } else {
          e.chain().focus().insertContent({ type: "text", text: up.filename, marks: [{ type: "link", attrs: { href: up.url } }] }).insertContent(" ").run();
        }
        setStatus(null);
      } catch {
        setStatus(labels.uploadFailed);
      } finally {
        setProgress(null);
      }
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      // Copie JSON simplă: ProseMirror creează atributele cu `Object.create(null)`, iar serializarea Server Actions
      // din React pierde obiectele fără prototip (citatul ajungea pe server fără `postId` și autor).
      getJSON: () => JSON.parse(JSON.stringify(editorRef.current?.getJSON() ?? { type: "doc", content: [] })) as JSONContent,
      isEmpty: () => editorRef.current?.isEmpty ?? true,
      clear: () => {
        editorRef.current?.commands.clearContent(true);
        clearTimeout(draftTimer.current);
        if (draftKey) clearDraft(draftKey);
      },
      focus: () => editorRef.current?.commands.focus("end"),
      insertQuote: (q) => {
        editorRef.current
          ?.chain()
          .focus("end")
          .insertContent([
            { type: "quote", attrs: { postId: q.postId, authorId: q.authorId, authorName: q.authorName }, content: paragraphs(q.text) },
            { type: "paragraph" },
          ])
          .run();
      },
      setContent: (doc) => {
        editorRef.current?.commands.setContent(doc);
      },
    }),
    [draftKey],
  );

  const toggle = (p: Exclude<Popover, null>) => setPopover((cur) => (cur === p ? null : p));
  const tool = (label: string, active: boolean, run: () => void, content: ReactNode, opts: { wide?: boolean; expanded?: boolean } = {}) => (
    <button
      type="button"
      className={cx("gcs-tool", opts.wide && "gcs-tool--wide", active && "gcs-tool--active")}
      aria-label={label}
      aria-pressed={opts.expanded === undefined ? active : undefined}
      aria-expanded={opts.expanded}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      disabled={!editor}
    >
      {content}
    </button>
  );
  const icon = (def: Parameters<typeof GcsIconSvg>[0]["icon"]) => <GcsIconSvg icon={def} />;
  const emojiTabLabels: Record<GcsEmojiCategory, string> = { smileys: labels.emojiSmileys, people: labels.emojiPeople, gaming: labels.emojiGaming, symbols: labels.emojiSymbols };
  const sep = (key: string) => <span key={key} className="gcs-editor__sep" aria-hidden="true" />;

  function insertVideo() {
    if (!isEmbedUrl(videoUrl)) {
      setVideoError(true);
      return;
    }
    editor?.chain().focus().insertContent({ type: "embed", attrs: { url: videoUrl.trim() } }).run();
    setVideoUrl("");
    setVideoError(false);
    setPopover(null);
  }

  function applyLink() {
    const url = linkUrl.trim();
    const chain = editor?.chain().focus().extendMarkRange("link");
    if (!url) chain?.unsetLink().run();
    else chain?.setLink({ href: /^(https?:|mailto:|\/|#)/i.test(url) ? url : `https://${url}` }).run();
    setLinkUrl("");
    setPopover(null);
  }

  function insertImage() {
    if (!isImageUrl(imageSrc)) {
      setImageError(true);
      return;
    }
    editor?.chain().focus().insertContent({ type: "image", attrs: { src: imageSrc.trim(), alt: "" } }).run();
    setImageSrc("");
    setImageError(false);
    setPopover(null);
  }

  const c = () => editor!.chain().focus();
  const characters = maxLength
    ? labels.charactersMax.replace("{count}", String(state?.characters ?? 0)).replace("{max}", String(maxLength))
    : labels.characters.replace("{count}", String(state?.characters ?? 0));
  const active = (name: string) => !!state?.active(name);

  // Un buton apare dacă e cerut (`tools`) și dacă schema îl permite (`allow`); fără ele, bara completă a postărilor.
  const node = (n: string) => !allow || allow.nodes.includes(n);
  const mark = (m: string) => !allow || allow.marks.includes(m);
  const shows = (t: GcsEditorTool): boolean => {
    if (tools && !tools.includes(t)) return false;
    switch (t) {
      case "bold":
      case "italic":
      case "underline":
      case "strike":
      case "superscript":
      case "subscript":
      case "highlight":
      case "link":
        return mark(t);
      case "size":
      case "color":
        return mark("textStyle");
      case "bulletList":
      case "orderedList":
      case "horizontalRule":
      case "spoiler":
        return node(t);
      case "quote":
        return node("blockquote");
      case "code":
        return node("codeBlock");
      case "mention":
        return node("mention") && !!mentionUrl;
      case "image":
        return node("image") && (!!uploadUrl || !!imageUrl);
      case "video":
        return node("embed");
      case "fullscreen":
        return !compact;
      default:
        return true;
    }
  };
  const item = (t: GcsEditorTool, el: ReactNode) => (shows(t) ? <Fragment key={t}>{el}</Fragment> : null);
  // Grupurile barei, despărțite de separatori (un grup fără butoane nu lasă separator).
  const groups: ReactNode[][] = [
    [
      item("bold", tool(labels.bold, active("bold"), () => c().toggleBold().run(), icon(faBold))),
      item("italic", tool(labels.italic, active("italic"), () => c().toggleItalic().run(), icon(faItalic))),
      item("underline", tool(labels.underline, active("underline"), () => c().toggleUnderline().run(), icon(faUnderline))),
      item("strike", tool(labels.strike, active("strike"), () => c().toggleStrike().run(), icon(faStrikethrough))),
      item("superscript", tool(labels.superscript, active("superscript"), () => c().toggleSuperscript().run(), icon(faSuperscript))),
      item("subscript", tool(labels.subscript, active("subscript"), () => c().toggleSubscript().run(), icon(faSubscript))),
    ],
    [
      item(
        "align",
        GCS_EDITOR_ALIGNS.map((a) => {
          const label = { left: labels.alignLeft, center: labels.alignCenter, right: labels.alignRight, justify: labels.alignJustify }[a];
          const def = { left: faAlignLeft, center: faAlignCenter, right: faAlignRight, justify: faAlignJustify }[a];
          return <span key={a}>{tool(label, !!state?.aligned(a), () => c().setTextAlign(a).run(), icon(def))}</span>;
        }),
      ),
    ],
    [
      item(
        "size",
        <>
          <label className="gcs-srOnly" htmlFor={`${baseId}-size`}>
            {labels.fontSize}
          </label>
          <select
            id={`${baseId}-size`}
            className="gcs-input gcs-editor__size"
            title={labels.fontSize}
            value={state?.fontSize ?? ""}
            disabled={!editor}
            onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}
          >
            <option value="">{labels.sizeDefault}</option>
            {GCS_EDITOR_FONT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </>,
      ),
      item("color", tool(labels.color, popover === "color", () => toggle("color"), icon(faPalette), { expanded: popover === "color" })),
      item("highlight", tool(labels.highlight, popover === "highlight", () => toggle("highlight"), icon(faHighlighter), { expanded: popover === "highlight" })),
      item("clear", tool(labels.clearFormatting, false, () => c().unsetAllMarks().unsetTextAlign().run(), icon(faTextSlash))),
    ],
    [
      item("bulletList", tool(labels.bulletList, active("bulletList"), () => c().toggleBulletList().run(), icon(faListUl))),
      item("orderedList", tool(labels.orderedList, active("orderedList"), () => c().toggleOrderedList().run(), icon(faListOl))),
      item("horizontalRule", tool(labels.horizontalRule, false, () => c().setHorizontalRule().run(), icon(faGripLines))),
      item(
        "link",
        tool(
          labels.link,
          active("link") || popover === "link",
          () => {
            setLinkUrl((editor?.getAttributes("link").href as string | undefined) ?? "");
            toggle("link");
          },
          icon(faLink),
          { expanded: popover === "link" },
        ),
      ),
      item("quote", tool(labels.quote, active("blockquote"), () => c().toggleBlockquote().run(), icon(faQuoteRight))),
      item("code", tool(labels.code, active("codeBlock"), () => c().toggleCodeBlock().run(), icon(faCode))),
      item("spoiler", tool(labels.spoiler, active("spoiler"), () => (editor?.isActive("spoiler") ? c().lift("spoiler").run() : c().wrapIn("spoiler").run()), icon(faEyeSlash))),
    ],
    [
      item("mention", tool(labels.mention, false, () => c().insertContent("@").run(), icon(faAt))),
      item(
        "image",
        uploadUrl
          ? tool(labels.image, false, () => fileInput.current?.click(), icon(faImage))
          : tool(labels.image, popover === "image", () => toggle("image"), icon(faImage), { expanded: popover === "image" }),
      ),
      item("video", tool(labels.video, popover === "video", () => toggle("video"), icon(faVideo), { expanded: popover === "video" })),
      item("emoji", tool(labels.emoji, popover === "emoji", () => toggle("emoji"), icon(faFaceSmile), { expanded: popover === "emoji" })),
    ],
  ];
  const toolbar = groups.filter((g) => g.some(Boolean)).flatMap((g, i) => (i === 0 ? g : [sep(`s${i}`), ...g]));

  return (
    <div className={cx("gcs-editor", compact && "gcs-editor--compact", fullscreen && "gcs-editor--fullscreen", className)}>
      <div className="gcs-editor__toolbar" role="toolbar" aria-label={labels.toolbar}>
        {toolbar}
        {blocks && blocks.length > 0 && !allow && (
          <>
            <span className="gcs-editor__sep" aria-hidden="true" />
            <GcsBlockTools editor={editor} allowed={blocks} labels={blockLabels ?? {}} />
          </>
        )}
        <span className="gcs-editor__spacer" />
        {item("fullscreen", tool(fullscreen ? labels.exitFullscreen : labels.fullscreen, fullscreen, () => setFullscreen((f) => !f), icon(fullscreen ? faCompress : faExpand)))}
        {uploadUrl && (
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              void uploadAll(files);
            }}
          />
        )}
      </div>

      {popover === "image" && (
        <div className="gcs-editor__popover">
          <label className="gcs-srOnly" htmlFor={`${baseId}-image`}>
            {labels.imageUrl}
          </label>
          <input
            id={`${baseId}-image`}
            className="gcs-input"
            type="url"
            placeholder={labels.imageUrl}
            value={imageSrc}
            aria-invalid={imageError}
            onChange={(e) => {
              setImageSrc(e.target.value);
              setImageError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                insertImage();
              }
            }}
          />
          <button type="button" className="gcs-btn gcs-btn--primary gcs-btn--sm" onClick={insertImage}>
            <span className="gcs-btn__icon" aria-hidden="true">
              <GcsIconSvg icon={faCheck} />
            </span>
            {labels.insert}
          </button>
          <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => setPopover(null)}>
            <span className="gcs-btn__icon" aria-hidden="true">
              <GcsIconSvg icon={faXmark} />
            </span>
            {labels.cancel}
          </button>
          {imageError && (
            <span className="gcs-editor__error" role="alert">
              {labels.invalidImage}
            </span>
          )}
        </div>
      )}

      {popover === "video" && (
        <div className="gcs-editor__popover">
          <label className="gcs-srOnly" htmlFor={`${baseId}-video`}>
            {labels.videoUrl}
          </label>
          <input
            id={`${baseId}-video`}
            className="gcs-input"
            type="url"
            placeholder={labels.videoUrl}
            value={videoUrl}
            aria-invalid={videoError}
            onChange={(e) => {
              setVideoUrl(e.target.value);
              setVideoError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                insertVideo();
              }
            }}
          />
          <button type="button" className="gcs-btn gcs-btn--primary gcs-btn--sm" onClick={insertVideo}>
            <span className="gcs-btn__icon" aria-hidden="true">
              <GcsIconSvg icon={faCheck} />
            </span>
            {labels.insert}
          </button>
          <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => setPopover(null)}>
            <span className="gcs-btn__icon" aria-hidden="true">
              <GcsIconSvg icon={faXmark} />
            </span>
            {labels.cancel}
          </button>
          {videoError && (
            <span className="gcs-editor__error" role="alert">
              {labels.invalidVideo}
            </span>
          )}
        </div>
      )}

      {popover === "link" && (
        <div className="gcs-editor__popover">
          <label className="gcs-srOnly" htmlFor={`${baseId}-link`}>
            {labels.linkUrl}
          </label>
          <input
            id={`${baseId}-link`}
            className="gcs-input"
            type="url"
            placeholder={labels.linkUrl}
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
          />
          <button type="button" className="gcs-btn gcs-btn--primary gcs-btn--sm" onClick={applyLink}>
            <span className="gcs-btn__icon" aria-hidden="true">
              <GcsIconSvg icon={faCheck} />
            </span>
            {labels.insert}
          </button>
          {active("link") && (
            <button
              type="button"
              className="gcs-btn gcs-btn--ghost gcs-btn--sm"
              onClick={() => {
                c().extendMarkRange("link").unsetLink().run();
                setPopover(null);
              }}
            >
              <span className="gcs-btn__icon" aria-hidden="true">
                <GcsIconSvg icon={faLinkSlash} />
              </span>
              {labels.removeLink}
            </button>
          )}
        </div>
      )}

      {(popover === "color" || popover === "highlight") && (
        <div className="gcs-editor__popover gcs-editor__swatches" role="group" aria-label={popover === "color" ? labels.color : labels.highlight}>
          {(popover === "color" ? GCS_EDITOR_COLORS : GCS_EDITOR_HIGHLIGHTS).map((color) => (
            <button
              key={color}
              type="button"
              className="gcs-editor__swatch"
              style={{ background: color }}
              aria-label={color}
              title={color}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (popover === "color") c().setColor(color).run();
                else c().setHighlight({ color }).run();
                setPopover(null);
              }}
            />
          ))}
          {popover === "color" && (
            <label className="gcs-editor__custom" title={labels.colorCustom}>
              <span className="gcs-srOnly">{labels.colorCustom}</span>
              <input
                type="color"
                onChange={(e) => {
                  c().setColor(e.target.value.toUpperCase()).run();
                }}
              />
            </label>
          )}
          <button
            type="button"
            className="gcs-btn gcs-btn--ghost gcs-btn--sm"
            onClick={() => {
              if (popover === "color") c().unsetColor().run();
              else c().unsetHighlight().run();
              setPopover(null);
            }}
          >
            <span className="gcs-btn__icon" aria-hidden="true">
              <GcsIconSvg icon={faEraser} />
            </span>
            {labels.removeColor}
          </button>
        </div>
      )}

      {popover === "emoji" && (
        <div className="gcs-editor__popover gcs-editor__emoji" role="dialog" aria-label={labels.emoji}>
          <div className="gcs-editor__emojiQuick">
            {GCS_QUICK_EMOJI.map((e) => (
              <button key={e} type="button" className="gcs-editor__emojiBtn" onMouseDown={(ev) => ev.preventDefault()} onClick={() => c().insertContent(e).run()}>
                {e}
              </button>
            ))}
          </div>
          <div className="gcs-seg__group gcs-editor__emojiTabs" role="tablist" aria-label={labels.emoji}>
            {EMOJI_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={emojiTab === tab}
                className={emojiTab === tab ? "gcs-seg gcs-seg--active" : "gcs-seg"}
                onClick={() => setEmojiTab(tab)}
                aria-label={emojiTabLabels[tab]}
                title={emojiTabLabels[tab]}
              >
                <GcsIconSvg icon={EMOJI_TAB_ICONS[tab]} />
              </button>
            ))}
          </div>
          <div className="gcs-editor__emojiGrid" role="tabpanel">
            {GCS_EMOJI_CATEGORIES[emojiTab].map((e) => (
              <button key={e} type="button" className="gcs-editor__emojiBtn" onMouseDown={(ev) => ev.preventDefault()} onClick={() => c().insertContent(e).run()}>
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      <EditorContent editor={editor} />
      <div className="gcs-editor__footer">
        {progress !== null && (
          <span className="gcs-editor__progress" role="progressbar" aria-label={labels.uploading} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </span>
        )}
        {/* Starea încărcărilor (doar editoarele cu upload): un singur `role="status"` pe pagină, nu în fiecare câmp. */}
        {uploadUrl && (
          <span className="gcs-editor__status" role="status">
            {status}
          </span>
        )}
        <span className="gcs-editor__count" data-testid="gcs-editor-count">
          {characters}
        </span>
        {footer}
      </div>
    </div>
  );
});
