"use client";

import type { GcsReactionCount, GcsReactionView } from "@gcs/core";
import { GcsBadge, GcsButton } from "@gcs/ui";
import { GcsEditor, type GcsEditorHandle } from "@gcs/ui/editor";
import type { JSONContent } from "@tiptap/core";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { approvePostsAction } from "../../mod-actions";
import {
  deletePostAction,
  editPostAction,
  hidePostAction,
  markSolvedAction,
  postSourceAction,
  reactAction,
  reportAction,
  restorePostAction,
  revisionsAction,
} from "../../topic-actions";
import { SPLIT_FORM_ID } from "./GcsTopicModMenu";
import { QUOTE_EVENT, useEditorLabels, type GcsQuoteDetail } from "./useEditorLabels";

export type GcsPostContentProps = {
  topicId: number;
  forumId: number;
  post: {
    id: number;
    number: number;
    html: string;
    visibility: "VISIBLE" | "PENDING" | "HIDDEN";
    date: string;
    dateIso: string;
    edited: string | null;
    hiddenReason: string | null;
    authorId: string | null;
    authorName: string;
    /** Fișierele atașate care nu sunt imagini (imaginile apar în conținut). */
    attachments?: { id: string; filename: string; size: number }[];
  };
  isSolved: boolean;
  reactions: GcsReactionCount[];
  myReaction: number | null;
  reactionList: GcsReactionView[];
  permalink: string;
  can: {
    react: boolean;
    quote: boolean;
    report: boolean;
    edit: boolean;
    hide: boolean;
    restore: boolean;
    delete: boolean;
    solve: boolean;
    approve: boolean;
    /** Checkbox pentru despărțirea postărilor (moderatori cu puterea `split`). */
    split: boolean;
  };
};

type Revision = { id: number; html: string; createdAt: string; editor: string | null };

/** Conținutul unei postări (macheta Topic): data, corpul, reacțiile și acțiunile, plus editarea pe loc. */
export function GcsPostContent(props: GcsPostContentProps) {
  const { topicId, forumId, post, can } = props;
  const t = useTranslations("topic");
  const tm = useTranslations("mod");
  const labels = useEditorLabels();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reactions, setReactions] = useState(props.reactions);
  const [mine, setMine] = useState(props.myReaction);
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<{ json: JSONContent; title: string | null } | null>(null);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [reported, setReported] = useState(false);
  const editor = useRef<GcsEditorHandle>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const reportDialog = useRef<HTMLDialogElement>(null);
  const historyDialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const byId = new Map(props.reactionList.map((r) => [r.id, r]));

  /** Rulează o acțiune; la succes, reîncarcă datele paginii. */
  function run<T>(action: () => Promise<{ ok: true; data: T } | { ok: false; error: Parameters<typeof errorMessage>[0] }>, after?: (data: T) => void) {
    setError(null);
    start(async () => {
      const res = await action();
      if (!res.ok) return setError(errorMessage(res.error));
      after?.(res.data);
      router.refresh();
    });
  }

  function react(reactionId: number) {
    setPicker(false);
    run(
      () => reactAction({ postId: post.id, reactionId: mine === reactionId ? null : reactionId }),
      (data) => {
        setReactions(data.reactions);
        setMine(data.mine);
      },
    );
  }

  function quote() {
    const text = body.current?.innerText.trim() ?? "";
    const detail: GcsQuoteDetail = { postId: post.id, authorId: post.authorId, authorName: post.authorName, text };
    window.dispatchEvent(new CustomEvent(QUOTE_EVENT, { detail }));
  }

  async function startEdit() {
    setError(null);
    const res = await postSourceAction({ postId: post.id });
    if (!res.ok) return setError(errorMessage(res.error));
    setEditing({ json: res.data.json as JSONContent, title: res.data.title });
  }

  function saveEdit() {
    const content = editor.current?.getJSON();
    if (!content) return;
    const title = editing?.title !== null ? titleInput.current?.value : undefined;
    run(() => editPostAction({ postId: post.id, content, ...(title !== undefined ? { title } : {}) }), () => setEditing(null));
  }

  async function openHistory() {
    const res = await revisionsAction({ postId: post.id });
    if (!res.ok) return setError(errorMessage(res.error));
    setRevisions(res.data);
    historyDialog.current?.showModal();
  }

  return (
    <div className="gcs-post__content">
      <div className="gcs-post__head">
        <time dateTime={post.dateIso}>{post.date}</time>
        <span className="gcs-post__headRight">
          {can.split && (
            <input
              type="checkbox"
              form={SPLIT_FORM_ID}
              name="postId"
              value={post.id}
              className="gcs-modCheck"
              aria-label={tm("splitSelect", { number: post.number })}
            />
          )}
          {props.isSolved && <GcsBadge tone="ok">{t("bestAnswer")}</GcsBadge>}
          <a href={props.permalink} aria-label={t("permalink", { number: post.number })}>
            {t("postNumber", { number: post.number })}
          </a>
        </span>
      </div>

      {post.visibility === "PENDING" && (
        <p className="gcs-post__notice gcs-post__notice--pending" role="note">
          {t("pendingPost")}
        </p>
      )}
      {post.visibility === "HIDDEN" && (
        <p className="gcs-post__notice" role="note">
          {t("hiddenPost")}
          {post.hiddenReason && ` · ${t("hiddenReason", { reason: post.hiddenReason })}`}
        </p>
      )}

      {editing ? (
        <div className="gcs-post__edit">
          {editing.title !== null && (
            <label className="gcs-field">
              <span className="gcs-field__label">{t("titleLabel")}</span>
              <input ref={titleInput} className="gcs-input" defaultValue={editing.title} maxLength={150} />
            </label>
          )}
          <GcsEditor
            ref={editor}
            labels={labels}
            forumId={forumId}
            uploadUrl="/api/forums/uploads"
            mentionUrl="/api/forums/mentions"
            initialContent={editing.json}
            footer={
              <span style={{ display: "flex", gap: 8 }}>
                <GcsButton variant="ghost" onClick={() => setEditing(null)}>
                  {t("cancel")}
                </GcsButton>
                <GcsButton variant="primary" onClick={saveEdit} disabled={pending}>
                  {t("save")}
                </GcsButton>
              </span>
            }
          />
        </div>
      ) : (
        <div ref={body} className="gcs-postBody" dangerouslySetInnerHTML={{ __html: post.html }} />
      )}
      {post.attachments && post.attachments.length > 0 && (
        <ul className="gcs-attachments" data-testid="gcs-post-attachments">
          {post.attachments.map((a) => (
            <li key={a.id}>
              <a href={`/files/${a.id}`}>{a.filename}</a> <span className="gcs-muted">({Math.max(1, Math.round(a.size / 1024))} KB)</span>
            </li>
          ))}
        </ul>
      )}
      {post.edited && <p className="gcs-post__edited">{post.edited}</p>}

      <div className="gcs-post__foot">
        <div className="gcs-post__reactions" aria-label={t("reactions")}>
          {reactions.map((r) => {
            const def = byId.get(r.reactionId);
            if (!def) return null;
            return (
              <button
                key={r.reactionId}
                type="button"
                className="gcs-reaction"
                aria-label={`${def.label}: ${r.count}`}
                aria-pressed={mine === r.reactionId}
                disabled={!can.react || pending}
                onClick={() => react(r.reactionId)}
              >
                <span style={{ color: def.color, fontWeight: 800 }} aria-hidden="true">
                  {def.symbol}
                </span>
                {r.count}
              </button>
            );
          })}
        </div>
        <div className="gcs-post__actions">
          {can.approve && post.visibility === "PENDING" && (
            <GcsButton variant="primary" size="sm" onClick={() => run(() => approvePostsAction({ postIds: [post.id] }))}>
              {tm("approve")}
            </GcsButton>
          )}
          {can.quote && (
            <GcsButton variant="ghost" size="sm" onClick={quote}>
              {t("quote")}
            </GcsButton>
          )}
          {can.react && (
            <span className="gcs-post__pickerWrap">
              <GcsButton variant="ghost" size="sm" aria-expanded={picker} onClick={() => setPicker((v) => !v)}>
                {t("react")}
              </GcsButton>
              {picker && (
                <span className="gcs-reactionPicker" role="group" aria-label={t("reactions")}>
                  {props.reactionList.map((r) => (
                    <button key={r.id} type="button" className="gcs-reaction" aria-label={t("reactWith", { label: r.label })} onClick={() => react(r.id)}>
                      <span style={{ color: r.color, fontWeight: 800 }} aria-hidden="true">
                        {r.symbol}
                      </span>
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
          {can.report && (
            <GcsButton variant="ghost" size="sm" onClick={() => reportDialog.current?.showModal()} disabled={reported}>
              {reported ? t("reported") : t("report")}
            </GcsButton>
          )}
          {can.solve && (
            <GcsButton variant="ghost" size="sm" onClick={() => run(() => markSolvedAction({ topicId, postId: props.isSolved ? null : post.id }))}>
              {props.isSolved ? t("unmarkSolved") : t("markSolved")}
            </GcsButton>
          )}
          {can.edit && !editing && (
            <GcsButton variant="ghost" size="sm" onClick={startEdit}>
              {t("edit")}
            </GcsButton>
          )}
          {can.edit && post.edited && (
            <GcsButton variant="ghost" size="sm" onClick={openHistory}>
              {t("history")}
            </GcsButton>
          )}
          {can.hide && post.visibility !== "HIDDEN" && (
            <GcsButton
              variant="ghost"
              size="sm"
              onClick={() => window.confirm(t("confirmHide")) && run(() => hidePostAction({ postId: post.id }))}
            >
              {t("hide")}
            </GcsButton>
          )}
          {can.restore && post.visibility === "HIDDEN" && (
            <GcsButton variant="ghost" size="sm" onClick={() => run(() => restorePostAction({ postId: post.id }))}>
              {t("restore")}
            </GcsButton>
          )}
          {can.delete && (
            <GcsButton
              variant="ghost"
              size="sm"
              onClick={() => window.confirm(t("confirmDelete")) && run(() => deletePostAction({ postId: post.id }))}
            >
              {t("delete")}
            </GcsButton>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {error}
        </p>
      )}

      <dialog ref={reportDialog} className="gcs-dialog" aria-labelledby={`report-${post.id}`}>
        <form
          method="dialog"
          onSubmit={(e) => {
            const reason = new FormData(e.currentTarget).get("reason");
            if (typeof reason !== "string") return;
            run(() => reportAction({ postId: post.id, reason }), () => setReported(true));
          }}
        >
          <h2 id={`report-${post.id}`} className="gcs-display gcs-dialog__title">
            {t("reportTitle")}
          </h2>
          <label className="gcs-field">
            <span className="gcs-field__label">{t("reportReason")}</span>
            <textarea name="reason" className="gcs-input" required minLength={3} maxLength={500} rows={4} />
          </label>
          <div className="gcs-dialog__actions">
            <GcsButton variant="ghost" type="button" onClick={() => reportDialog.current?.close()}>
              {t("cancel")}
            </GcsButton>
            <GcsButton variant="primary" type="submit">
              {t("reportSend")}
            </GcsButton>
          </div>
        </form>
      </dialog>

      <dialog ref={historyDialog} className="gcs-dialog gcs-dialog--wide" aria-labelledby={`history-${post.id}`}>
        <h2 id={`history-${post.id}`} className="gcs-display gcs-dialog__title">
          {t("historyTitle")}
        </h2>
        {revisions?.length === 0 && <p>{t("noHistory")}</p>}
        {revisions?.map((r) => (
          <article key={r.id} className="gcs-revision">
            <p className="gcs-revision__meta">
              {new Date(r.createdAt).toLocaleString()} {r.editor && `· ${r.editor}`}
            </p>
            <div className="gcs-postBody" dangerouslySetInnerHTML={{ __html: r.html }} />
          </article>
        ))}
        <div className="gcs-dialog__actions">
          <GcsButton variant="ghost" onClick={() => historyDialog.current?.close()}>
            {t("close")}
          </GcsButton>
        </div>
      </dialog>
    </div>
  );
}
