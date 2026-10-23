"use client";

import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { votePostAction } from "../../forum-v2-actions";

/**
 * Votul Q&A al unei postări (Forum v2): ▲ scorul ▼. Același vot încă o dată îl anulează. Vizitatorii și autorul
 * postării văd doar scorul (butoanele sunt dezactivate, cu motivul în tooltip).
 */
export function GcsPostVote({ postId, score, mine, disabled }: { postId: number; score: number; mine: -1 | 0 | 1; disabled: "guest" | "own" | "closed" | null }) {
  const t = useTranslations("topic.vote");
  const errorMessage = useErrorMessage();
  const [state, setState] = useState({ score, mine });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const why = disabled === "guest" ? t("login") : disabled === "own" ? t("own") : null;

  function vote(value: 1 | -1) {
    setError(null);
    start(async () => {
      const res = await votePostAction({ postId, value });
      if (res.ok) setState(res.data);
      else setError(errorMessage(res.error));
    });
  }

  const button = (value: 1 | -1) => {
    const label = value === 1 ? t("up") : t("down");
    return (
      <button
        type="button"
        className={`gcs-iconBtn gcs-sweep gcs-postVote__btn${state.mine === value ? " gcs-postVote__btn--on" : ""}`}
        aria-label={label}
        aria-pressed={state.mine === value}
        title={why ?? label}
        disabled={disabled !== null || pending}
        onClick={() => vote(value)}
        data-testid={value === 1 ? "gcs-vote-up" : "gcs-vote-down"}
      >
        <GcsIconSvg icon={value === 1 ? faChevronUp : faChevronDown} />
      </button>
    );
  };

  return (
    <span className="gcs-postVote" data-testid="gcs-post-vote">
      {button(1)}
      <span className="gcs-postVote__score" aria-label={t("score", { score: state.score })} data-testid="gcs-vote-score">
        {state.score}
      </span>
      {button(-1)}
      {error && (
        <span className="gcs-srOnly" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
