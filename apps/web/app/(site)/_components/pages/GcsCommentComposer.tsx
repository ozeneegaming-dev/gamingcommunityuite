"use client";

import { GcsButton } from "@gcs/ui";
import { GcsEditor, type GcsEditorHandle } from "@gcs/ui/editor";
import { GcsIcon } from "@/lib/pages-icons";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { commentPagesRecord } from "../../pages-actions";
import { useEditorLabels } from "../topic/useEditorLabels";

/**
 * Comentariul nou la o înregistrare: editorul comun (sugestiile @, emoji, încărcări în baza înregistrării), cu ciorna
 * păstrată. Într-o bază cu aprobare, comentariul apare cu eticheta „în așteptare” până îl aprobă staff-ul.
 */
export function GcsCommentComposer({ recordId, databaseId }: { recordId: number; databaseId: number }) {
  const t = useTranslations("pages.comments");
  const labels = useEditorLabels();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const editor = useRef<GcsEditorHandle>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  async function send() {
    if (!editor.current || editor.current.isEmpty()) return;
    setPending(true);
    setMessage(null);
    const res = await commentPagesRecord({ recordId, content: editor.current.getJSON() });
    setPending(false);
    if (!res.ok) return setMessage({ kind: "error", text: errorMessage(res.error) });
    editor.current.clear();
    if (res.data.pending) setMessage({ kind: "ok", text: t("pendingNote") });
    router.refresh();
  }

  return (
    <div className="gcs-pgComposer" data-testid="gcs-pages-comment-form">
      <span className="gcs-srOnly" id={`gcs-pg-comment-${recordId}`}>
        {t("write")}
      </span>
      <GcsEditor
        ref={editor}
        id={`gcs-pg-comment-editor-${recordId}`}
        labelledBy={`gcs-pg-comment-${recordId}`}
        labels={labels}
        forumId={databaseId}
        uploadUrl="/api/pages/uploads"
        mentionUrl="/api/forums/mentions"
        draftKey={`pages-comment-${recordId}`}
        compact
      />
      <div className="gcs-pgComposer__actions">
        {message && (
          <span className={message.kind === "error" ? "gcs-formError" : "gcs-muted"} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </span>
        )}
        <GcsButton onClick={send} disabled={pending} icon={<GcsIcon name="fa-solid fa-paper-plane" />} data-testid="gcs-pages-comment-send">
          {t("send")}
        </GcsButton>
      </div>
    </div>
  );
}
