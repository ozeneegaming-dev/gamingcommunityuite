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
} from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import {
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
};

/** Formularul (gol) de care țin checkbox-urile postărilor pentru despărțire. */
export const SPLIT_FORM_ID = "gcs-split-posts";
const has = (powers: string[], p: string) => powers.includes("*") || powers.includes(p);

/** Uneltele de moderare ale unui topic (macheta Topic, pentru moderatori). */
export function GcsTopicModMenu({ topicId, forumId, forumHref, powers, flags, forums }: Props) {
  const t = useTranslations("mod");
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
