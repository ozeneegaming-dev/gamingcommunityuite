"use client";

import type { GcsResult } from "@gcs/core";
import { faEye, faEyeSlash, faFlag, faPaperPlane, faReply, faTrash } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { splitMentions } from "@gcs/core/text-mentions";
import type { GcsMentionAttrs } from "@gcs/ui/editor";
import { useMentionInput } from "@gcs/ui/mention-input";
import { useErrorMessage } from "@/lib/use-error-message";
import { manageStatus, postStatus, reportStatus } from "../../profile-actions";

/** Un rând de text → nodurile lui: textul și mențiunile alese din sugestii (nodurile `mention`, după id). */
function lineNodes(line: string, mentions: GcsMentionAttrs[]) {
  return splitMentions(
    line,
    mentions.map((m) => ({ kind: m.kind, id: m.id, name: m.label })),
  ).map((part) => (part.mention ? { type: "mention", attrs: { id: part.mention.id, label: part.mention.name, kind: part.mention.kind } } : { type: "text", text: part.text }));
}

/**
 * Textul simplu (cu rânduri noi) → document Tiptap cu paragrafe, cu mențiunile alese ca noduri `mention`; serverul îl
 * validează și îl randează (pastilele, după id; grupurile doar dacă autorul le poate menționa).
 */
function textToDoc(text: string, mentions: GcsMentionAttrs[] = []) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p
        .split("\n")
        .flatMap((line, i) => (i === 0 ? lineNodes(line, mentions) : [{ type: "hardBreak" }, ...lineNodes(line, mentions)]))
        .filter((n) => n.type !== "text" || (n as { text?: string }).text),
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
  // @mențiunile: aceeași listă de sugestii ca în editorul postărilor.
  const te = useTranslations("topic.editor");
  const mention = useMentionInput<HTMLTextAreaElement>({
    value: text,
    onValue: setText,
    labels: { empty: te("noMentions"), group: te("mentionGroup"), online: te("mentionOnline") },
    maxLength: 2000,
  });

  const submit = () =>
    startTransition(async () => {
      const res = await postStatus({ profileUserId, content: textToDoc(text, mention.picks()), ...(parentId ? { parentId } : {}) });
      if (!res.ok) {
        setError(message(res.error));
        return;
      }
      setText("");
      mention.reset();
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
      <div className="gcs-mentionAnchor gcs-wallComposer__field">
        <textarea
          ref={mention.ref}
          id={id}
          className="gcs-input gcs-wallComposer__input"
          rows={compact ? 1 : 2}
          maxLength={2000}
          placeholder={labels.placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            mention.onText(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => void mention.onKeyDown(e)}
          onBlur={mention.onBlur}
          {...mention.aria}
          data-testid={parentId ? "gcs-wall-reply-input" : "gcs-wall-input"}
        />
        {mention.popup}
      </div>
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
