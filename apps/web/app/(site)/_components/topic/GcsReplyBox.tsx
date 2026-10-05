"use client";

import { GcsButton } from "@gcs/ui";
import { GcsEditor, type GcsEditorHandle } from "@gcs/ui/editor";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { replyAction } from "../../topic-actions";
import { QUOTE_EVENT, useEditorLabels, type GcsQuoteDetail } from "./useEditorLabels";

/** Caseta de răspuns din macheta Topic: editorul, ciorna și trimiterea. Primește citatele de la butoanele „Citează”. */
export function GcsReplyBox({ topicId, forumId, maxUploadMb }: { topicId: number; forumId: number; maxUploadMb: number }) {
  const t = useTranslations("topic");
  const labels = useEditorLabels();
  const errorMessage = useErrorMessage();
  const editor = useRef<GcsEditorHandle>(null);
  const box = useRef<HTMLElement>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

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
    <section id="reply" ref={box} aria-labelledby="gcs-reply-label" className="gcs-replyBox">
      <h2 id="gcs-reply-label" className="gcs-srOnly">
        {t("replyLabel")}
      </h2>
      <GcsEditor
        ref={editor}
        id="gcs-reply-editor"
        labels={labels}
        forumId={forumId}
        uploadUrl="/api/forums/uploads"
        mentionUrl="/api/forums/mentions"
        draftKey={`topic-${topicId}`}
        footer={
          <>
            <span>{maxUploadMb === -1 ? t("footerUnlimited") : t("footer", { mb: maxUploadMb })}</span>
            <GcsButton variant="primary" onClick={send} disabled={sending}>
              {sending ? t("sending") : t("send")}
            </GcsButton>
          </>
        }
      />
      {notice && (
        <p role={notice.ok ? "status" : "alert"} className={notice.ok ? "gcs-notice" : "gcs-notice gcs-notice--error"}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
