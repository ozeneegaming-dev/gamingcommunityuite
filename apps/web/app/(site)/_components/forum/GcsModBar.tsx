"use client";

import type { GcsErrorPayload } from "@gcs/core";
import { GcsButton } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { applySavedActionAction, moveTopicsAction, setTopicFlagAction, setTopicsHiddenAction } from "../../mod-actions";

type Result = { ok: true; data: unknown } | { ok: false; error: GcsErrorPayload };
type Props = {
  formId: string;
  powers: string[];
  forums: { id: number; name: string }[];
  savedActions: { id: number; name: string }[];
};

const has = (powers: string[], p: string) => powers.includes("*") || powers.includes(p);

/** Bara de acțiuni în masă pe lista de topicuri (moderatori): fixează, blochează, mută, ascunde, acțiuni salvate. */
export function GcsModBar({ formId, powers, forums, savedActions }: Props) {
  const t = useTranslations("mod");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [moveTo, setMoveTo] = useState("");
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[form="${formId}"]`)];
  const selected = () => boxes().filter((b) => b.checked).map((b) => Number(b.value));

  useEffect(() => {
    const update = () => setCount(selected().length);
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
  });

  function run(action: (topicIds: number[]) => Promise<Result>) {
    const topicIds = selected();
    if (topicIds.length === 0) return;
    setError(null);
    start(async () => {
      const res = await action(topicIds);
      if (!res.ok) return setError(errorMessage(res.error));
      for (const b of boxes()) b.checked = false;
      setCount(0);
      router.refresh();
    });
  }

  return (
    <div className="gcs-modBar" role="toolbar" aria-label={t("bar")}>
      <span className="gcs-modBar__count" aria-live="polite">
        {t("selected", { count })}
      </span>
      {has(powers, "pin") && (
        <>
          <GcsButton variant="ghost" size="sm" disabled={!count || pending} onClick={() => run((topicIds) => setTopicFlagAction({ topicIds, flag: "pinned", value: true }))}>
            {t("pin")}
          </GcsButton>
          <GcsButton variant="ghost" size="sm" disabled={!count || pending} onClick={() => run((topicIds) => setTopicFlagAction({ topicIds, flag: "pinned", value: false }))}>
            {t("unpin")}
          </GcsButton>
        </>
      )}
      {has(powers, "lock") && (
        <>
          <GcsButton variant="ghost" size="sm" disabled={!count || pending} onClick={() => run((topicIds) => setTopicFlagAction({ topicIds, flag: "locked", value: true }))}>
            {t("lock")}
          </GcsButton>
          <GcsButton variant="ghost" size="sm" disabled={!count || pending} onClick={() => run((topicIds) => setTopicFlagAction({ topicIds, flag: "locked", value: false }))}>
            {t("unlock")}
          </GcsButton>
        </>
      )}
      {has(powers, "hide") && (
        <GcsButton variant="ghost" size="sm" disabled={!count || pending} onClick={() => run((topicIds) => setTopicsHiddenAction({ topicIds, hidden: true }))}>
          {t("hide")}
        </GcsButton>
      )}
      {has(powers, "move") && (
        <span className="gcs-modBar__group">
          <label className="gcs-srOnly" htmlFor={`${formId}-move`}>
            {t("moveTo")}
          </label>
          <select id={`${formId}-move`} className="gcs-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">{t("moveTo")}…</option>
            {forums.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <GcsButton variant="ghost" size="sm" disabled={!count || !moveTo || pending} onClick={() => run((topicIds) => moveTopicsAction({ topicIds, forumId: Number(moveTo) }))}>
            {t("move")}
          </GcsButton>
        </span>
      )}
      {savedActions.length > 0 && (
        <span className="gcs-modBar__group">
          <label className="gcs-srOnly" htmlFor={`${formId}-saved`}>
            {t("savedAction")}
          </label>
          <select id={`${formId}-saved`} className="gcs-input" value={actionId} onChange={(e) => setActionId(e.target.value)}>
            <option value="">{t("savedAction")}…</option>
            {savedActions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <GcsButton
            variant="ghost"
            size="sm"
            disabled={!count || !actionId || pending}
            onClick={() => run((topicIds) => applySavedActionAction({ actionId: Number(actionId), topicIds }))}
          >
            {t("apply")}
          </GcsButton>
        </span>
      )}
      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {error}
        </p>
      )}
    </div>
  );
}
