"use client";

import { faPaperPlane, faReply } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { GcsEditor, type GcsEditorHandle } from "@gcs/ui/editor";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { replyAction } from "../../topic-actions";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { QUOTE_EVENT, useEditorLabels, type GcsQuoteDetail } from "./useEditorLabels";

/**
 * Caseta de răspuns din macheta Topic („Răspuns rapid”): titlul cu iconiță, editorul, ciorna și butonul de trimitere
 * din dreapta-jos. Primește citatele de la butoanele „Citează”.
 */
export function GcsReplyBox({ topicId, forumId, maxUploadMb, maxLength }: { topicId: number; forumId: number; maxUploadMb: number; maxLength?: number }) {
  const t = useTranslations("topic");
  const labels = useEditorLabels();
  const errorMessage = useErrorMessage();
  const editor = useRef<GcsEditorHandle>(null);
  const box = useRef<HTMLElement>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const realtime = useRealtime();
  const lastTyping = useRef(0);

  // „scrie un răspuns…” pentru ceilalți din topic, cel mult o dată la 3 s (serverul are același throttle).
  const onTyping = () => {
    const now = Date.now();
    if (now - lastTyping.current < 3_000) return;
    lastTyping.current = now;
    realtime.emit("typing", topicId);
  };

  useEffect(() => {
    function onQuote(e: Event) {
      editor.current?.insertQuote((e as CustomEvent<GcsQuoteDetail>).detail);
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
    if (res.data.pending) return setNotice({ ok: true, text: t("pendingNotice") });
    // Navigare completă prin permalink: serverul redirecționează la pagina și ancora noului răspuns.
    window.location.assign(res.data.href);
  }

  return (
    <section id="reply" ref={box} aria-labelledby="gcs-reply-label" className="gcs-replyBox gcs-replyBox--quick">
      <h2 id="gcs-reply-label" className="gcs-display gcs-replyBox__title">
        <GcsIconSvg icon={faReply} className="gcs-hIcon" />
        {t("quickReply")}
      </h2>
      <GcsEditor
        ref={editor}
        id="gcs-reply-editor"
        labels={labels}
        {...(maxLength ? { maxLength } : {})}
        forumId={forumId}
        uploadUrl="/api/forums/uploads"
        mentionUrl="/api/forums/mentions"
        draftKey={`topic-${topicId}`}
        onChange={onTyping}
        footer={<span>{maxUploadMb === -1 ? t("footerUnlimited") : t("footer", { mb: maxUploadMb })}</span>}
      />
      <div className="gcs-replyBox__actions">
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
