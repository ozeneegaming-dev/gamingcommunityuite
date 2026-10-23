"use client";

import type { GcsErrorPayload } from "@gcs/core";
import {
  type IconDefinition,
  faCodeMerge,
  faEye,
  faEyeSlash,
  faLock,
  faLockOpen,
  faRightLeft,
  faScissors,
  faShieldHalved,
  faStar,
  faThumbtack,
  faThumbtackSlash,
  faTrash,
  faBullhorn,
  faUserCheck,
  faBoxArchive,
  faBoxOpen,
  faStarHalfStroke,
  faClockRotateLeft,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg, GcsMemberName, GcsModal } from "@gcs/ui";
import { GcsEditor, type GcsEditorHandle } from "@gcs/ui/editor";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { addTopicNoticeAction, removeTopicVotesAction, setTopicApprovalAction, setTopicsArchivedAction, topicHistoryAction } from "../../forum-v2-actions";
import { useEditorLabels } from "./useEditorLabels";
import {
  applySavedActionAction,
  deleteTopicAction,
  mergeTopicAction,
  moveTopicsAction,
  setTopicFlagAction,
  setTopicsHiddenAction,
  splitPostsAction,
} from "../../mod-actions";

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: GcsErrorPayload };
type Props = {
  topicId: number;
  forumId: number;
  forumHref: string;
  powers: string[];
  flags: { pinned: boolean; locked: boolean; featured: boolean; hidden: boolean };
  forums: { id: number; name: string }[];
  /** Forum v2: acțiunile salvate permise pe forum (aplicate dintr-un click), aprobarea per topic, arhivarea, nota. */
  savedActions?: { id: number; name: string }[];
  requireApproval?: boolean;
  archived?: boolean;
  rating?: { count: number } | null;
};

type HistoryEntry = { id: string; action: string; at: string; actor: { id: string; name: string; nameKey: string } | null };

/** Formularul (gol) de care țin checkbox-urile postărilor pentru despărțire. */
export const SPLIT_FORM_ID = "gcs-split-posts";
const has = (powers: string[], p: string) => powers.includes("*") || powers.includes(p);

/** Uneltele de moderare ale unui topic (macheta Topic, pentru moderatori). */
export function GcsTopicModMenu({ topicId, forumId, forumHref, powers, flags, forums, savedActions = [], requireApproval = false, archived = false, rating = null }: Props) {
  const t = useTranslations("mod");
  const tv = useTranslations("mod.v2");
  const labels = useEditorLabels();
  const notice = useRef<GcsEditorHandle>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeTone, setNoticeTone] = useState("info");
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [splitTitle, setSplitTitle] = useState("");
  const [splitForum, setSplitForum] = useState(String(forumId));
  const [confirmDelete, setConfirmDelete] = useState(false);

  function run<T>(action: () => Promise<Result<T>>, after?: (data: T) => void) {
    setError(null);
    start(async () => {
      const res = await action();
      if (!res.ok) return setError(errorMessage(res.error));
      if (after) after(res.data);
      else router.refresh();
    });
  }

  /** Iconițele butoanelor de stare: [pornește, oprește]. */
  const flagIcons: Record<"pinned" | "locked" | "featured", [IconDefinition, IconDefinition]> = {
    pinned: [faThumbtack, faThumbtackSlash],
    locked: [faLock, faLockOpen],
    featured: [faStar, faStar],
  };
  /** Culoarea plăcii (designul Nova): evidențierea verde, ascunderea portocalie, restul mov. */
  const flagTone: Record<"pinned" | "locked" | "featured", GcsModTone> = { pinned: "other", locked: "other", featured: "feature" };
  const flag = (name: "pinned" | "locked" | "featured", on: string, off: string, power: string) =>
    has(powers, power) && (
      <GcsButton
        variant="ghost"
        size="sm"
        className="gcs-modTile"
        data-tone={flagTone[name]}
        icon={<GcsIconSvg icon={flagIcons[name][flags[name] ? 1 : 0]} />}
        disabled={pending}
        onClick={() => run(() => setTopicFlagAction({ topicIds: [topicId], flag: name, value: !flags[name] }))}
      >
        {flags[name] ? off : on}
      </GcsButton>
    );

  const selectedPosts = () =>
    [...document.querySelectorAll<HTMLInputElement>(`input[form="${SPLIT_FORM_ID}"]:checked`)].map((b) => Number(b.value));

  return (
    <details className="gcs-card gcs-modMenu">
      <summary className="gcs-modMenu__summary">
        <GcsIconSvg icon={faShieldHalved} className="gcs-hIcon" />
        {t("menu")}
      </summary>
      <div className="gcs-modMenu__body">
        {/* Plăcile acțiunilor rapide (în designul Nova, colorate la hover după tipul acțiunii). */}
        <div className="gcs-modMenu__row gcs-modTiles">
          {flag("pinned", t("pin"), t("unpin"), "pin")}
          {flag("locked", t("lock"), t("unlock"), "lock")}
          {flag("featured", t("feature"), t("unfeature"), "feature")}
          {has(powers, "hide") && (
            <GcsButton
              variant="ghost"
              size="sm"
              className="gcs-modTile"
              data-tone="hide"
              icon={<GcsIconSvg icon={flags.hidden ? faEye : faEyeSlash} />}
              disabled={pending}
              onClick={() => run(() => setTopicsHiddenAction({ topicIds: [topicId], hidden: !flags.hidden }))}
            >
              {flags.hidden ? t("restore") : t("hide")}
            </GcsButton>
          )}
          {has(powers, "delete") && (
            <GcsButton variant="ghost" size="sm" className="gcs-modTile" data-tone="delete" icon={<GcsIconSvg icon={faTrash} />} disabled={pending} onClick={() => setConfirmDelete(true)}>
              {t("delete")}
            </GcsButton>
          )}
        </div>

        {/* Forum v2: mesajul moderatorului, aprobarea per topic, arhivarea, istoricul și nota. */}
        <div className="gcs-modMenu__row gcs-modTiles">
          {has(powers, "edit") && (
            <GcsButton variant="ghost" size="sm" className="gcs-modTile" data-tone="other" icon={<GcsIconSvg icon={faBullhorn} />} disabled={pending} onClick={() => setNoticeOpen(true)} data-testid="gcs-mod-notice">
              {tv("addNotice")}
            </GcsButton>
          )}
          {has(powers, "approve") && (
            <GcsButton
              variant="ghost"
              size="sm"
              className="gcs-modTile"
              data-tone="other"
              aria-pressed={requireApproval}
              icon={<GcsIconSvg icon={faUserCheck} />}
              disabled={pending}
              onClick={() => run(() => setTopicApprovalAction({ topicId, value: !requireApproval }))}
              data-testid="gcs-mod-approval"
            >
              {requireApproval ? tv("approvalOff") : tv("approvalOn")}
            </GcsButton>
          )}
          {has(powers, "lock") && (
            <GcsButton
              variant="ghost"
              size="sm"
              className="gcs-modTile"
              data-tone={archived ? "feature" : "other"}
              icon={<GcsIconSvg icon={archived ? faBoxOpen : faBoxArchive} />}
              disabled={pending}
              onClick={() => run(() => setTopicsArchivedAction({ topicIds: [topicId], archived: !archived }))}
              data-testid="gcs-mod-archive"
            >
              {archived ? tv("unarchive") : tv("archive")}
            </GcsButton>
          )}
          {has(powers, "edit") && rating && rating.count > 0 && (
            <GcsButton variant="ghost" size="sm" className="gcs-modTile" data-tone="hide" icon={<GcsIconSvg icon={faStarHalfStroke} />} disabled={pending} onClick={() => setConfirmReset(true)} data-testid="gcs-mod-rating-reset">
              {tv("resetRating")}
            </GcsButton>
          )}
          <GcsButton
            variant="ghost"
            size="sm"
            className="gcs-modTile"
            data-tone="other"
            icon={<GcsIconSvg icon={faClockRotateLeft} />}
            disabled={pending}
            onClick={() =>
              run(
                () => topicHistoryAction({ topicId }),
                (d) => setHistory(d),
              )
            }
            data-testid="gcs-mod-history"
          >
            {tv("history")}
          </GcsButton>
        </div>

        {savedActions.length > 0 && (
          // Acțiunile salvate (macro-urile din ACP), aplicate topicului dintr-un singur click.
          <div className="gcs-modMenu__row gcs-modMenu__saved" data-testid="gcs-mod-saved-actions">
            <span className="gcs-modMenu__label">
              <GcsIconSvg icon={faWandMagicSparkles} />
              {tv("savedActions")}
            </span>
            {savedActions.map((a) => (
              <GcsButton key={a.id} variant="ghost" size="sm" className="gcs-modTile" data-tone="other" disabled={pending} onClick={() => run(() => applySavedActionAction({ actionId: a.id, topicIds: [topicId] }))}>
                {a.name}
              </GcsButton>
            ))}
          </div>
        )}

        {has(powers, "move") && (
          <div className="gcs-modMenu__row">
            <label className="gcs-srOnly" htmlFor="gcs-topic-move">
              {t("moveTo")}
            </label>
            <select id="gcs-topic-move" className="gcs-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">{t("moveTo")}…</option>
              {forums
                .filter((f) => f.id !== forumId)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
            <GcsButton variant="ghost" size="sm" className="gcs-modTile" data-tone="move" icon={<GcsIconSvg icon={faRightLeft} />} disabled={!moveTo || pending} onClick={() => run(() => moveTopicsAction({ topicIds: [topicId], forumId: Number(moveTo) }))}>
              {t("move")}
            </GcsButton>
          </div>
        )}

        {has(powers, "merge") && (
          <div className="gcs-modMenu__row">
            <label className="gcs-srOnly" htmlFor="gcs-topic-merge">
              {t("mergeInto")}
            </label>
            <input
              id="gcs-topic-merge"
              className="gcs-input"
              placeholder={t("mergeInto")}
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
            />
            <GcsButton
              variant="ghost"
              size="sm"
              className="gcs-modTile"
              data-tone="other"
              icon={<GcsIconSvg icon={faCodeMerge} />}
              disabled={!mergeTarget || pending}
              onClick={() => run(() => mergeTopicAction({ topicId, target: mergeTarget }), (d) => window.location.assign(d.href))}
            >
              {t("merge")}
            </GcsButton>
          </div>
        )}

        {has(powers, "split") && (
          <div className="gcs-modMenu__row">
            <label className="gcs-srOnly" htmlFor="gcs-split-title">
              {t("splitTitle")}
            </label>
            <input
              id="gcs-split-title"
              className="gcs-input"
              placeholder={t("splitTitle")}
              value={splitTitle}
              onChange={(e) => setSplitTitle(e.target.value)}
            />
            <label className="gcs-srOnly" htmlFor="gcs-split-forum">
              {t("splitForum")}
            </label>
            <select id="gcs-split-forum" className="gcs-input" value={splitForum} onChange={(e) => setSplitForum(e.target.value)}>
              {forums.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <GcsButton
              variant="ghost"
              size="sm"
              className="gcs-modTile"
              data-tone="other"
              icon={<GcsIconSvg icon={faScissors} />}
              disabled={!splitTitle || pending}
              onClick={() =>
                run(
                  () => splitPostsAction({ postIds: selectedPosts(), title: splitTitle, forumId: Number(splitForum) }),
                  (d) => window.location.assign(d.href),
                )
              }
            >
              {t("split")}
            </GcsButton>
          </div>
        )}
        {error && (
          <p role="alert" className="gcs-notice gcs-notice--error">
            {error}
          </p>
        )}
      </div>
      {noticeOpen && (
        <GcsModal title={tv("addNotice")} icon={<GcsIconSvg icon={faBullhorn} />} onClose={() => setNoticeOpen(false)} closeLabel={t("cancel")} size="md">
          <div className="gcs-field">
            <label htmlFor="gcs-notice-tone">{tv("noticeTone")}</label>
            <select id="gcs-notice-tone" className="gcs-input" value={noticeTone} onChange={(e) => setNoticeTone(e.target.value)}>
              {(["info", "warn", "ok", "danger"] as const).map((tone) => (
                <option key={tone} value={tone}>
                  {tv(`tones.${tone}`)}
                </option>
              ))}
            </select>
          </div>
          <GcsEditor ref={notice} id="gcs-notice-editor" labels={labels} forumId={forumId} mentionUrl="/api/forums/mentions" compact />
          {error && (
            <p role="alert" className="gcs-notice gcs-notice--error">
              {error}
            </p>
          )}
          <div className="gcs-dialog__actions">
            <GcsButton
              variant="primary"
              icon={<GcsIconSvg icon={faBullhorn} />}
              disabled={pending}
              onClick={() => {
                const content = notice.current?.getJSON();
                if (!content || notice.current?.isEmpty()) return;
                run(
                  () => addTopicNoticeAction({ topicId, content, tone: noticeTone }),
                  () => {
                    setNoticeOpen(false);
                    router.refresh();
                  },
                );
              }}
              data-testid="gcs-notice-save"
            >
              {tv("publishNotice")}
            </GcsButton>
            <GcsButton variant="ghost" onClick={() => setNoticeOpen(false)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </GcsModal>
      )}
      {history && (
        <GcsModal title={tv("history")} icon={<GcsIconSvg icon={faClockRotateLeft} />} onClose={() => setHistory(null)} closeLabel={t("cancel")} size="md">
          {history.length === 0 ? (
            <p className="gcs-muted">{tv("historyEmpty")}</p>
          ) : (
            <ol className="gcs-modHistory" data-testid="gcs-mod-history-list">
              {history.map((h) => (
                <li key={h.id} className="gcs-modHistory__item" data-action={h.action}>
                  <span className="gcs-modHistory__action">{tv.has(`actions.${h.action}` as never) ? tv(`actions.${h.action}` as never) : h.action}</span>
                  <span className="gcs-modHistory__meta">
                    {h.actor ? <GcsMemberName userId={h.actor.id} name={h.actor.name} nameKey={h.actor.nameKey} /> : tv("system")} · <time dateTime={h.at}>{new Date(h.at).toLocaleString()}</time>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </GcsModal>
      )}
      {confirmReset && (
        <GcsModal title={tv("resetRating")} icon={<GcsIconSvg icon={faStarHalfStroke} />} onClose={() => setConfirmReset(false)} closeLabel={t("cancel")} size="sm">
          <p style={{ marginTop: 0 }}>{tv("resetRatingConfirm")}</p>
          <div className="gcs-dialog__actions">
            <GcsButton
              variant="primary"
              disabled={pending}
              onClick={() =>
                run(
                  () => removeTopicVotesAction({ topicId, userId: null }),
                  () => {
                    setConfirmReset(false);
                    router.refresh();
                  },
                )
              }
              data-testid="gcs-mod-rating-reset-confirm"
            >
              {tv("resetRating")}
            </GcsButton>
            <GcsButton variant="ghost" onClick={() => setConfirmReset(false)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </GcsModal>
      )}
      {confirmDelete && (
        // Confirmarea ștergerii, în pagină (nu `window.confirm`).
        <GcsModal title={t("delete")} icon={<GcsIconSvg icon={faTrash} />} onClose={() => setConfirmDelete(false)} closeLabel={t("cancel")} size="sm">
          <p style={{ marginTop: 0 }}>{t("confirmDelete")}</p>
          <div className="gcs-dialog__actions">
            <GcsButton
              variant="primary"
              icon={<GcsIconSvg icon={faTrash} />}
              disabled={pending}
              onClick={() => run(() => deleteTopicAction({ topicId }), () => window.location.assign(forumHref))}
              data-testid="gcs-topic-delete-confirm"
            >
              {t("delete")}
            </GcsButton>
            <GcsButton variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </GcsModal>
      )}
    </details>
  );
}

/** Tipul unei acțiuni de moderare (culoarea plăcii în designul Nova). */
export type GcsModTone = "feature" | "move" | "hide" | "delete" | "other";
