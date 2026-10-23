"use client";

import { faDesktop, faEye, faMobileScreen, faPaperPlane, faPaste, faReply, faTabletScreenButton, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { GcsEditor, loadDraft, type GcsEditorBlock, type GcsEditorHandle } from "@gcs/ui/editor";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { previewPostAction } from "../../forum-v2-actions";
import { replyAction } from "../../topic-actions";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { QUOTE_EVENT, useBlockLabels, useEditorLabels, type GcsQuoteDetail } from "./useEditorLabels";

type Device = "desktop" | "tablet" | "phone";
const DEVICES: { key: Device; icon: typeof faDesktop }[] = [
  { key: "desktop", icon: faDesktop },
  { key: "tablet", icon: faTabletScreenButton },
  { key: "phone", icon: faMobileScreen },
];

/**
 * Caseta de răspuns din macheta Topic („Răspuns rapid”). Forum v2: pornește strânsă (un singur rând „Răspunde…”) și se
 * deschide la focus, la un citat sau cu o ciornă salvată (ciorna se restaurează singură, cu „Renunță la ciornă”);
 * „Lipește ca text” scoate formatarea din ce se lipește; previzualizarea arată postarea pe desktop, tabletă și telefon;
 * blocurile permise autorului apar în bara editorului.
 */
export function GcsReplyBox({ topicId, forumId, maxUploadMb, maxLength, blocks = [] }: { topicId: number; forumId: number; maxUploadMb: number; maxLength?: number; blocks?: GcsEditorBlock[] }) {
  const t = useTranslations("topic");
  const tr = useTranslations("topic.replyBox");
  const labels = useEditorLabels();
  const blockLabels = useBlockLabels();
  const errorMessage = useErrorMessage();
  const editor = useRef<GcsEditorHandle>(null);
  const box = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [restored, setRestored] = useState(false);
  const [plainPaste, setPlainPaste] = useState(false);
  const [preview, setPreview] = useState<{ html: string; device: Device } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const realtime = useRealtime();
  const lastTyping = useRef(0);
  const draftKey = `topic-${topicId}`;

  // „scrie un răspuns…” pentru ceilalți din topic, cel mult o dată la 3 s (serverul are același throttle).
  const onTyping = () => {
    const now = Date.now();
    if (now - lastTyping.current < 3_000) return;
    lastTyping.current = now;
    realtime.emit("typing", topicId);
  };

  // O ciornă salvată (editorul o încarcă singur) sau `#reply` în adresă deschid caseta direct.
  useEffect(() => {
    const draft = loadDraft(draftKey);
    if (draft) setRestored(true);
    if (draft || window.location.hash === "#reply") setCollapsed(false);
    // Butonul „Răspunde” din antet (`#reply`) deschide caseta și o aduce în focus.
    const onHash = () => {
      if (window.location.hash !== "#reply") return;
      setCollapsed(false);
      window.setTimeout(() => editor.current?.focus(), 50);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [draftKey]);

  useEffect(() => {
    function onQuote(e: Event) {
      editor.current?.insertQuote((e as CustomEvent<GcsQuoteDetail>).detail);
      setCollapsed(false);
      box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.addEventListener(QUOTE_EVENT, onQuote);
    return () => window.removeEventListener(QUOTE_EVENT, onQuote);
  }, []);

  async function send() {
    if (!editor.current || editor.current.isEmpty()) return;
    setSending(true);
    setNotice(null);
    const res = await replyAction({ topicId, content: editor.current.getJSON() });
    setSending(false);
    if (!res.ok) return setNotice({ ok: false, text: errorMessage(res.error) });
    editor.current.clear();
    setRestored(false);
    setPreview(null);
    if (res.data.pending) return setNotice({ ok: true, text: t("pendingNotice") });
    // Navigare completă prin permalink: serverul redirecționează la pagina și ancora noului răspuns.
    window.location.assign(res.data.href);
  }

  async function showPreview(device: Device) {
    if (!editor.current || editor.current.isEmpty()) return;
    setPreviewing(true);
    const res = await previewPostAction({ forumId, content: editor.current.getJSON() });
    setPreviewing(false);
    if (!res.ok) return setNotice({ ok: false, text: errorMessage(res.error) });
    setPreview({ html: res.data.html, device });
  }

  return (
    <section
      id="reply"
      ref={box}
      aria-labelledby="gcs-reply-label"
      className={`gcs-replyBox gcs-replyBox--quick${collapsed ? " gcs-replyBox--collapsed" : ""}`}
      data-testid="gcs-reply-box"
      data-collapsed={collapsed ? "" : undefined}
      onFocusCapture={() => setCollapsed(false)}
      onClick={() => setCollapsed(false)}
    >
      <h2 id="gcs-reply-label" className={collapsed ? "gcs-srOnly" : "gcs-display gcs-replyBox__title"}>
        <GcsIconSvg icon={faReply} className="gcs-hIcon" />
        {t("quickReply")}
      </h2>
      {restored && !collapsed && (
        <p className="gcs-replyBox__draft" role="status" data-testid="gcs-reply-draft">
          {tr("draftRestored")}
          <button
            type="button"
            className="gcs-btn gcs-btn--ghost gcs-btn--sm"
            onClick={() => {
              editor.current?.clear();
              setRestored(false);
            }}
          >
            <GcsIconSvg icon={faTrashCan} className="gcs-btn__icon" />
            {tr("discardDraft")}
          </button>
        </p>
      )}
      <GcsEditor
        ref={editor}
        id="gcs-reply-editor"
        labels={collapsed ? { ...labels, placeholder: tr("placeholder") } : labels}
        {...(maxLength ? { maxLength } : {})}
        forumId={forumId}
        uploadUrl="/api/forums/uploads"
        mentionUrl="/api/forums/mentions"
        draftKey={draftKey}
        onChange={onTyping}
        blocks={blocks}
        blockLabels={blockLabels}
        plainPaste={plainPaste}
        footer={<span>{maxUploadMb === -1 ? t("footerUnlimited") : t("footer", { mb: maxUploadMb })}</span>}
      />
      {preview && (
        <div className="gcs-replyPreview" data-device={preview.device} data-testid="gcs-reply-preview">
          <div className="gcs-seg__group gcs-replyPreview__devices" role="tablist" aria-label={tr("previewDevices")}>
            {DEVICES.map((d) => (
              <button
                key={d.key}
                type="button"
                role="tab"
                aria-selected={preview.device === d.key}
                className={preview.device === d.key ? "gcs-seg gcs-seg--active" : "gcs-seg"}
                aria-label={tr(`devices.${d.key}`)}
                onClick={() => setPreview({ ...preview, device: d.key })}
                data-testid={`gcs-reply-preview-${d.key}`}
              >
                <GcsIconSvg icon={d.icon} />
              </button>
            ))}
          </div>
          {/* HTML-ul randat și sanitizat de server (aceeași cale ca la publicare). */}
          <div className="gcs-replyPreview__frame">
            <div className="gcs-postBody" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        </div>
      )}
      <div className="gcs-replyBox__actions">
        <GcsButton variant="ghost" size="sm" aria-pressed={plainPaste} icon={<GcsIconSvg icon={faPaste} />} onClick={() => setPlainPaste((v) => !v)} data-testid="gcs-reply-plain-paste">
          {plainPaste ? tr("plainPasteOn") : tr("plainPaste")}
        </GcsButton>
        <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faEye} />} loading={previewing} onClick={() => (preview ? setPreview(null) : void showPreview("desktop"))} data-testid="gcs-reply-preview-btn">
          {preview ? tr("closePreview") : tr("preview")}
        </GcsButton>
        <GcsButton variant="primary" className="gcs-replyBox__send" onClick={send} loading={sending} icon={<GcsIconSvg icon={faPaperPlane} />}>
          {sending ? t("sending") : t("send")}
        </GcsButton>
      </div>
      {notice && (
        <p role={notice.ok ? "status" : "alert"} className={notice.ok ? "gcs-notice" : "gcs-notice gcs-notice--error"}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
