"use client";

import type { GcsResult } from "@gcs/core";
import { faEye, faEyeSlash, faFlag, faPaperPlane, faReply, faTrash } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { manageStatus, postStatus, reportStatus } from "../../profile-actions";

/** Textul simplu (cu rânduri noi) → document Tiptap cu paragrafe; serverul îl validează și îl randează. */
function textToDoc(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i) => (i === 0 ? [{ type: "text", text: line }] : [{ type: "hardBreak" }, { type: "text", text: line }])).filter((n) => n.type !== "text" || n.text),
    })),
  };
}

type ComposerLabels = { placeholder: string; post: string; reply: string };

/** Formularul de pe perete (status nou sau răspuns la un status). */
export function GcsWallComposer({ profileUserId, parentId, labels, compact = false }: { profileUserId: string; parentId?: number; labels: ComposerLabels; compact?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const message = useErrorMessage();
  const id = parentId ? `gcs-wall-reply-${parentId}` : "gcs-wall";

  const submit = () =>
    startTransition(async () => {
      const res = await postStatus({ profileUserId, content: textToDoc(text), ...(parentId ? { parentId } : {}) });
      if (!res.ok) {
        setError(message(res.error));
        return;
      }
      setText("");
      setError(null);
      router.refresh();
    });

  return (
    <form
      className={`gcs-wallComposer${compact ? " gcs-wallComposer--compact" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) submit();
      }}
    >
      <label htmlFor={id} className="gcs-srOnly">
        {labels.placeholder}
      </label>
      <textarea
        id={id}
        className="gcs-input gcs-wallComposer__input"
        rows={compact ? 1 : 2}
        maxLength={2000}
        placeholder={labels.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        data-testid={parentId ? "gcs-wall-reply-input" : "gcs-wall-input"}
      />
      <GcsButton
        type="submit"
        variant={compact ? "ghost" : "primary"}
        icon={<GcsIconSvg icon={parentId ? faReply : faPaperPlane} />}
        disabled={pending || !text.trim()}
      >
        {parentId ? labels.reply : labels.post}
      </GcsButton>
      {error && (
        <span role="alert" className="gcs-formError">
          {error}
        </span>
      )}
    </form>
  );
}

/** Acțiunile unui status: ascunde / restaurează / șterge (cine are voie) și raportează. */
export function GcsWallItemActions({
  statusId,
  hidden,
  canManage,
  canModerate,
  canReport,
  labels,
}: {
  statusId: number;
  hidden: boolean;
  canManage: boolean;
  canModerate: boolean;
  canReport: boolean;
  labels: { hide: string; restore: string; delete: string; report: string; reportReason: string; confirmDelete: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const message = useErrorMessage();
  const run = (fn: () => Promise<GcsResult<unknown>>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(message(res.error));
      else router.refresh();
    });

  return (
    <span className="gcs-wallItem__actions">
      {canManage && !hidden && (
        <button type="button" className="gcs-linkButton" disabled={pending} onClick={() => run(() => manageStatus({ statusId, action: "hide" }))}>
          <GcsIconSvg icon={faEyeSlash} className="gcs-linkButton__icon" />
          {labels.hide}
        </button>
      )}
      {canModerate && hidden && (
        <button type="button" className="gcs-linkButton" disabled={pending} onClick={() => run(() => manageStatus({ statusId, action: "restore" }))}>
          <GcsIconSvg icon={faEye} className="gcs-linkButton__icon" />
          {labels.restore}
        </button>
      )}
      {canModerate && (
        <button
          type="button"
          className="gcs-linkButton"
          disabled={pending}
          onClick={() => {
            if (window.confirm(labels.confirmDelete)) run(() => manageStatus({ statusId, action: "delete" }));
          }}
        >
          <GcsIconSvg icon={faTrash} className="gcs-linkButton__icon" />
          {labels.delete}
        </button>
      )}
      {canReport && (
        <button
          type="button"
          className="gcs-linkButton"
          disabled={pending}
          onClick={() => {
            const reason = window.prompt(labels.reportReason);
            if (reason && reason.trim().length >= 3) run(() => reportStatus({ statusId, reason: reason.trim() }));
          }}
        >
          <GcsIconSvg icon={faFlag} className="gcs-linkButton__icon" />
          {labels.report}
        </button>
      )}
      {error && (
        <span role="alert" className="gcs-formError">
          {error}
        </span>
      )}
    </span>
  );
}
