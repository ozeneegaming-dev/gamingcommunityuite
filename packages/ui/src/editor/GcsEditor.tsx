"use client";

import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { cx } from "../cx";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import { gcsEditorExtensions, isEmbedUrl } from "./extensions";
import { gcsMentionSuggestion } from "./mentions";
import { uploadFile } from "./uploads";

/** Textele editorului (traduse de pagină). */
export type GcsEditorLabels = {
  toolbar: string;
  bold: string;
  italic: string;
  underline: string;
  quote: string;
  code: string;
  spoiler: string;
  mention: string;
  image: string;
  video: string;
  videoUrl: string;
  insert: string;
  cancel: string;
  invalidVideo: string;
  placeholder: string;
  uploading: string;
  uploadFailed: string;
  noMentions: string;
};

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
  initialContent?: JSONContent | null;
  onChange?: (doc: JSONContent) => void;
  footer?: ReactNode;
  id?: string;
  className?: string;
};

const DRAFT_DELAY_MS = 2000;

/** Paragrafele unui text simplu (blocurile despărțite de un rând gol). */
function paragraphs(text: string): JSONContent[] {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return (blocks.length > 0 ? blocks : [""]).map((b) => ({ type: "paragraph", content: b ? [{ type: "text", text: b }] : [] }));
}

/**
 * Editorul de postări (spec §7), construit pe Tiptap, cu toolbar-ul din macheta Topic. Produce JSON Tiptap;
 * HTML-ul îl generează și îl sanitizează doar serverul.
 */
export const GcsEditor = forwardRef<GcsEditorHandle, GcsEditorProps>(function GcsEditor(props, ref) {
  const { labels, forumId, uploadUrl, mentionUrl, draftKey, initialContent, onChange, footer, id, className } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoError, setVideoError] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: gcsEditorExtensions({
      placeholder: labels.placeholder,
      ...(mentionUrl ? { mention: gcsMentionSuggestion(mentionUrl, labels.noMentions) } : {}),
    }),
    content: initialContent ?? (draftKey ? loadDraft(draftKey) : null) ?? "",
    editorProps: {
      attributes: { class: "gcs-editor__content", ...(id ? { id } : {}), "aria-multiline": "true", role: "textbox" },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length > 0 && uploadUrl) {
          void uploadAll(files);
          return true;
        }
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (isEmbedUrl(text)) {
          editorRef.current?.chain().focus().insertContent({ type: "embed", attrs: { url: text.trim() } }).run();
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
      onChange?.(e.getJSON());
      if (!draftKey) return;
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => saveDraft(draftKey, e.getJSON()), DRAFT_DELAY_MS);
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  async function uploadAll(files: File[]) {
    const e = editorRef.current;
    if (!e || !uploadUrl) return;
    for (const file of files) {
      setStatus(labels.uploading);
      try {
        const up = await uploadFile(uploadUrl, forumId, file);
        if (up.isImage) {
          e.chain().focus().insertContent({ type: "image", attrs: { attachmentId: up.id, alt: up.filename, width: up.width, height: up.height } }).run();
        } else {
          e.chain().focus().insertContent({ type: "text", text: up.filename, marks: [{ type: "link", attrs: { href: up.url } }] }).insertContent(" ").run();
        }
        setStatus(null);
      } catch {
        setStatus(labels.uploadFailed);
      }
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      getJSON: () => editorRef.current?.getJSON() ?? { type: "doc", content: [] },
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

  const tool = (label: string, active: boolean, run: () => void, content: ReactNode, wide = false) => (
    <button
      type="button"
      className={cx("gcs-tool", wide && "gcs-tool--wide", active && "gcs-tool--active")}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      disabled={!editor}
    >
      {content}
    </button>
  );

  function insertVideo() {
    if (!isEmbedUrl(videoUrl)) {
      setVideoError(true);
      return;
    }
    editor?.chain().focus().insertContent({ type: "embed", attrs: { url: videoUrl.trim() } }).run();
    setVideoUrl("");
    setVideoError(false);
    setVideoOpen(false);
  }

  const c = () => editor!.chain().focus();
  return (
    <div className={cx("gcs-editor", className)}>
      <div className="gcs-editor__toolbar" role="toolbar" aria-label={labels.toolbar}>
        {tool(labels.bold, !!editor?.isActive("bold"), () => c().toggleBold().run(), "B")}
        {tool(labels.italic, !!editor?.isActive("italic"), () => c().toggleItalic().run(), <span style={{ fontStyle: "italic" }}>I</span>)}
        {tool(labels.underline, !!editor?.isActive("underline"), () => c().toggleUnderline().run(), <span style={{ textDecoration: "underline" }}>U</span>)}
        {tool(labels.quote, !!editor?.isActive("blockquote"), () => c().toggleBlockquote().run(), "“")}
        {tool(labels.code, !!editor?.isActive("codeBlock"), () => c().toggleCodeBlock().run(), "</>")}
        {tool(labels.spoiler, !!editor?.isActive("spoiler"), () => (editor?.isActive("spoiler") ? c().lift("spoiler").run() : c().wrapIn("spoiler").run()), labels.spoiler, true)}
        {mentionUrl && tool(labels.mention, false, () => c().insertContent("@").run(), "@")}
        {uploadUrl && tool(labels.image, false, () => fileInput.current?.click(), labels.image, true)}
        {tool(labels.video, videoOpen, () => setVideoOpen((v) => !v), labels.video, true)}
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
      </div>
      {videoOpen && (
        <div className="gcs-editor__popover">
          <label className="gcs-srOnly" htmlFor={`${id ?? "gcs-editor"}-video`}>
            {labels.videoUrl}
          </label>
          <input
            id={`${id ?? "gcs-editor"}-video`}
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
            {labels.insert}
          </button>
          <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => setVideoOpen(false)}>
            {labels.cancel}
          </button>
          {videoError && (
            <span className="gcs-editor__error" role="alert">
              {labels.invalidVideo}
            </span>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
      <div className="gcs-editor__footer">
        <span className="gcs-editor__status" role="status">
          {status}
        </span>
        {footer}
      </div>
    </div>
  );
});
