"use client";

import { faClock } from "@fortawesome/free-regular-svg-icons";
import {
  faCheck,
  faCircleCheck,
  faClockRotateLeft,
  faEllipsis,
  faEyeSlash,
  faFaceSmile,
  faFlag,
  faHeart,
  faPenToSquare,
  faQuoteLeft,
  faRotateLeft,
  faTrash,
  faAward,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsReactionCount, GcsReactionView } from "@gcs/core";
import { GcsBadge, GcsButton, GcsDropdown, GcsIconSvg, GcsMemberName, GcsModal, type GcsDropdownItem } from "@gcs/ui";
import { GcsEditor, type GcsEditorBlock, type GcsEditorHandle } from "@gcs/ui/editor";
import type { JSONContent } from "@tiptap/core";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { memberHref } from "@/lib/forum-urls";
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
import { setRecommendedPostAction } from "../../forum-v2-actions";
import { GcsMultiQuoteToggle } from "./GcsMultiQuote";
import { SPLIT_FORM_ID } from "./GcsTopicModMenu";
import { QUOTE_EVENT, useBlockLabels, useEditorLabels, type GcsQuoteDetail } from "./useEditorLabels";

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
    edited: ReactNode;
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
  /** Sub conținut (randate pe server): butonul „Traduce”. */
  extras?: ReactNode;
  /** Forum v2: pastilele din antet („Autor”, „Staff”, „Recomandat”), randate pe server. */
  pills?: ReactNode;
  /** Forum v2: rândul „Tu, A, B și alți N au reacționat” (primii membri care au reacționat). */
  reactors?: { users: { id: string; name: string; nameKey: string }[]; total: number; mine: boolean };
  viewerId?: string | null;
  /** Forum v2: uneltele staff-ului de sub postare (IP-ul cu linkul spre uneltele IP). */
  staffTools?: ReactNode;
  /** Forum v2: „Recomandă” (răspunsul recomandat de staff) și „+ Citat” (MultiQuote). */
  recommend?: { can: boolean; on: boolean };
  multiQuote?: boolean;
  /** Forum v2: familiile de blocuri permise la editare (editorul pe loc). */
  blocks?: GcsEditorBlock[];
  /** Semnătura autorului (randată pe server), sub conținut, după separatorul punctat. */
  signature?: ReactNode;
};

/** Reacția butonului „Apreciază”: `like`, altfel prima reacție activă. */
function likeReaction(list: GcsReactionView[]): GcsReactionView | undefined {
  return list.find((r) => r.key === "like") ?? list[0];
}

type Revision = { id: number; html: string; createdAt: string; editor: string | null };

/**
 * Forum v2: „Tu, Krypt, ShadowRO și alți 56 au reacționat”: primii membri (numele stilizate, vizitatorul ca „Tu”) și
 * restul ca număr.
 */
function ReactorsLine({ users, viewerId, mine, total }: { users: { id: string; name: string; nameKey: string }[]; viewerId: string | null; mine: boolean; total: number }) {
  const t = useTranslations("topic");
  // Vizitatorul tocmai și-a retras reacția: nu mai apare primul în listă.
  const list = mine ? users : users.filter((u) => u.id !== viewerId);
  const shown = list.slice(0, 3);
  const others = Math.max(0, total - shown.length);
  if (shown.length === 0) return <>{t("reactedCount", { count: total })}</>;
  const names = shown.map((u, i) => (
    <span key={u.id}>
      {i > 0 && (i === shown.length - 1 && others === 0 ? ` ${t("and")} ` : ", ")}
      {u.id === viewerId ? t("you") : <GcsMemberName userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u)} />}
    </span>
  ));
  return <>{others > 0 ? t.rich("reactedNamesOthers", { names: () => <>{names}</>, count: others }) : t.rich("reactedNames", { names: () => <>{names}</>, count: shown.length })}</>;
}

/** Conținutul unei postări (macheta Topic): data, corpul, reacțiile și acțiunile, plus editarea pe loc. */
export function GcsPostContent(props: GcsPostContentProps) {
  const { topicId, forumId, post, can } = props;
  const t = useTranslations("topic");
  const tm = useTranslations("mod");
  const labels = useEditorLabels();
  const blockLabels = useBlockLabels();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, start] = useTransition();
  /** Confirmarea în pagină a unei acțiuni de moderare pe postare (ascunderea, ștergerea). */
  const [confirm, setConfirm] = useState<"hide" | "delete" | null>(null);
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
  const actions = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLSpanElement>(null);
  const byId = new Map(props.reactionList.map((r) => [r.id, r]));
  const like = likeReaction(props.reactionList);
  const likeCount = like ? (reactions.find((r) => r.reactionId === like.id)?.count ?? 0) : 0;
  const liked = like !== undefined && mine === like.id;
  const total = reactions.reduce((n, r) => n + r.count, 0);

  // Selectorul de reacții (deschis din „Mai mult…”): focusul pe prima reacție; Escape/click în afară îl închid.
  useEffect(() => {
    if (!picker) return;
    pickerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPicker(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [picker]);

  function closePicker() {
    setPicker(false);
    actions.current?.querySelector<HTMLButtonElement>(".gcs-dropdown__trigger")?.focus();
  }

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

  const quoteDetail = (): GcsQuoteDetail => ({ postId: post.id, authorId: post.authorId, authorName: post.authorName, text: body.current?.innerText.trim() ?? "" });
  function quote() {
    window.dispatchEvent(new CustomEvent(QUOTE_EVENT, { detail: quoteDetail() }));
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

  // „Mai mult…”: acțiunile membrului (altă reacție, raportare), apoi cele de autor/moderare.
  const userItems: GcsDropdownItem[] = [
    ...(can.react && props.reactionList.length > 0
      ? [{ kind: "action" as const, label: t("react"), icon: <GcsIconSvg icon={faFaceSmile} />, onSelect: () => setPicker(true) }]
      : []),
    ...(can.report && !reported
      ? [{ kind: "action" as const, label: t("report"), icon: <GcsIconSvg icon={faFlag} />, onSelect: () => reportDialog.current?.showModal() }]
      : []),
  ];
  const modItems: GcsDropdownItem[] = [
    ...(props.recommend?.can && post.visibility === "VISIBLE"
      ? [
          {
            kind: "action" as const,
            label: props.recommend.on ? t("unrecommend") : t("recommend"),
            icon: <GcsIconSvg icon={faAward} />,
            testId: "gcs-post-recommend",
            onSelect: () => run(() => setRecommendedPostAction({ topicId, postId: props.recommend!.on ? null : post.id })),
          },
        ]
      : []),
    ...(can.edit && post.edited ? [{ kind: "action" as const, label: t("history"), icon: <GcsIconSvg icon={faClockRotateLeft} />, onSelect: () => void openHistory() }] : []),
    ...(can.hide && post.visibility !== "HIDDEN"
      ? [
          {
            kind: "action" as const,
            label: t("hide"),
            icon: <GcsIconSvg icon={faEyeSlash} />,
            // Confirmarea, în pagină (nu `window.confirm`).
            onSelect: () => setConfirm("hide"),
          },
        ]
      : []),
    ...(can.restore && post.visibility === "HIDDEN"
      ? [{ kind: "action" as const, label: t("restore"), icon: <GcsIconSvg icon={faRotateLeft} />, onSelect: () => run(() => restorePostAction({ postId: post.id })) }]
      : []),
    ...(can.delete
      ? [
          {
            kind: "action" as const,
            label: t("delete"),
            icon: <GcsIconSvg icon={faTrash} />,
            onSelect: () => setConfirm("delete"),
          },
        ]
      : []),
  ];
  const moreItems: GcsDropdownItem[] = [...userItems, ...(userItems.length > 0 && modItems.length > 0 ? [{ kind: "separator" as const }] : []), ...modItems];

  const confirmAction = () => {
    const action = confirm;
    if (!action) return;
    run(
      () => (action === "hide" ? hidePostAction({ postId: post.id }) : deletePostAction({ postId: post.id })),
      () => setConfirm(null),
    );
  };

  return (
    <div className="gcs-post__content">
      {confirm && (
        <GcsModal
          title={t(confirm)}
          icon={<GcsIconSvg icon={confirm === "hide" ? faEyeSlash : faTrash} />}
          onClose={() => setConfirm(null)}
          closeLabel={t("cancel")}
          size="sm"
        >
          <p style={{ marginTop: 0 }} data-testid="gcs-post-confirm-text">
            {t(confirm === "hide" ? "confirmHide" : "confirmDelete")}
          </p>
          {error && (
            <p role="alert" className="gcs-notice gcs-notice--error">
              {error}
            </p>
          )}
          <div className="gcs-dialog__actions">
            <GcsButton
              variant="primary"
              icon={<GcsIconSvg icon={confirm === "hide" ? faEyeSlash : faTrash} />}
              loading={pending}
              onClick={confirmAction}
              data-testid={`gcs-post-${confirm}-confirm`}
            >
              {t(confirm)}
            </GcsButton>
            <GcsButton variant="ghost" onClick={() => setConfirm(null)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </GcsModal>
      )}
      <div className="gcs-post__head">
        <time dateTime={post.dateIso} className="gcs-post__date">
          <GcsIconSvg icon={faClock} />
          {post.date}
        </time>
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
          {props.pills}
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
            {...(props.blocks && props.blocks.length > 0 ? { blocks: props.blocks, blockLabels } : {})}
            footer={
              <span style={{ display: "flex", gap: 8 }}>
                <GcsButton variant="ghost" onClick={() => setEditing(null)}>
                  {t("cancel")}
                </GcsButton>
                <GcsButton variant="primary" onClick={saveEdit} loading={pending}>
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
      {props.extras}
      {post.edited && <p className="gcs-post__edited">{post.edited}</p>}
      {props.signature}

      {total > 0 && (
        // Sumarul reacțiilor (bara cu accent): textul, apoi contoarele pe reacții (apăsabile, ca înainte).
        <div className="gcs-post__reactionBar">
          <span className="gcs-post__reactionText" data-testid="gcs-post-reaction-text">
            <GcsIconSvg icon={faHeart} />
            {props.reactors && props.reactors.users.length > 0 ? (
              <ReactorsLine users={props.reactors.users} viewerId={props.viewerId ?? null} mine={mine !== null} total={total} />
            ) : mine !== null ? (
              total > 1 ? (
                t("reactedYouAndOthers", { count: total - 1 })
              ) : (
                t("reactedYou")
              )
            ) : (
              t("reactedCount", { count: total })
            )}
          </span>
          <div className="gcs-post__reactions" role="group" aria-label={t("reactions")}>
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
        </div>
      )}
      {reported && (
        <p className="gcs-post__reported" role="status">
          {t("reported")}
        </p>
      )}
      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {error}
        </p>
      )}

      {props.staffTools}
      <div className="gcs-post__foot">
        <div className="gcs-post__actions" ref={actions}>
          {can.approve && post.visibility === "PENDING" && (
            <GcsButton
              variant="primary"
              size="sm"
              className="gcs-post__action"
              icon={<GcsIconSvg icon={faCircleCheck} />}
              onClick={() => run(() => approvePostsAction({ postIds: [post.id] }))}
            >
              {tm("approve")}
            </GcsButton>
          )}
          {can.solve && (
            <GcsButton
              variant="ghost"
              size="sm"
              className="gcs-post__action"
              icon={<GcsIconSvg icon={faCheck} />}
              onClick={() => run(() => markSolvedAction({ topicId, postId: props.isSolved ? null : post.id }))}
            >
              {props.isSolved ? t("unmarkSolved") : t("markSolved")}
            </GcsButton>
          )}
          {can.react && like && (
            <GcsButton
              variant="ghost"
              size="sm"
              className={`gcs-post__action gcs-post__like${liked ? " gcs-post__like--on" : ""}`}
              icon={<GcsIconSvg icon={faHeart} />}
              aria-pressed={liked}
              disabled={pending}
              onClick={() => react(like.id)}
            >
              {liked ? t("liked") : t("like")}
              {likeCount > 0 && (
                <span className="gcs-post__likeCount" aria-hidden="true">
                  {likeCount}
                </span>
              )}
            </GcsButton>
          )}
          {can.quote && (
            <GcsButton variant="ghost" size="sm" className="gcs-post__action" icon={<GcsIconSvg icon={faQuoteLeft} />} onClick={quote}>
              {t("quoteShort")}
            </GcsButton>
          )}
          {can.quote && props.multiQuote && <GcsMultiQuoteToggle topicId={topicId} quote={quoteDetail} />}
          {can.edit && !editing && (
            <GcsButton variant="ghost" size="sm" className="gcs-post__action" icon={<GcsIconSvg icon={faPenToSquare} />} onClick={startEdit}>
              {t("quickEdit")}
            </GcsButton>
          )}
          {moreItems.length > 0 && (
            <GcsDropdown
              label={t("moreShort")}
              className="gcs-post__more"
              triggerClassName="gcs-post__action"
              testId="gcs-post-more"
              trigger={
                <>
                  <GcsIconSvg icon={faEllipsis} />
                  <span>{t("moreShort")}</span>
                </>
              }
              items={moreItems}
            />
          )}
          {picker && (
            <span
              ref={pickerRef}
              className="gcs-reactionPicker"
              role="group"
              aria-label={t("reactions")}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closePicker();
                }
              }}
            >
              {props.reactionList.map((r) => (
                <button key={r.id} type="button" className="gcs-reaction" aria-label={t("reactWith", { label: r.label })} onClick={() => react(r.id)}>
                  <span style={{ color: r.color, fontWeight: 800 }} aria-hidden="true">
                    {r.symbol}
                  </span>
                </button>
              ))}
            </span>
          )}
        </div>
      </div>

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
