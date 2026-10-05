"use client";

import type { GcsPollView } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { voteAction } from "../../topic-actions";

/** Sondajul unui topic: formularul de vot sau rezultatele (cu bare procentuale). */
export function GcsPollCard({ poll, loggedIn, closesLabel }: { poll: GcsPollView; loggedIn: boolean; closesLabel: string | null }) {
  const t = useTranslations("topic.poll");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const total = poll.options.reduce((n, o) => n + o.votes, 0);
  const showForm = poll.canVote;

  function vote() {
    setError(null);
    start(async () => {
      const res = await voteAction({ pollId: poll.id, optionIds: chosen });
      if (!res.ok) return setError(errorMessage(res.error));
      router.refresh();
    });
  }

  return (
    <GcsCard as="section" className="gcs-poll" aria-labelledby={`poll-${poll.id}`}>
      <h2 id={`poll-${poll.id}`} className="gcs-display gcs-poll__question">
        {poll.question}
      </h2>
      {showForm ? (
        <fieldset className="gcs-poll__options">
          <legend className="gcs-srOnly">{poll.question}</legend>
          {poll.options.map((o) => (
            <label key={o.id} className="gcs-poll__choice">
              <input
                type={poll.multiple ? "checkbox" : "radio"}
                name={`poll-${poll.id}`}
                value={o.id}
                checked={chosen.includes(o.id)}
                onChange={(e) =>
                  setChosen((c) => (poll.multiple ? (e.target.checked ? [...c, o.id] : c.filter((x) => x !== o.id)) : [o.id]))
                }
              />
              {o.text}
            </label>
          ))}
          <GcsButton variant="primary" onClick={vote} disabled={pending || chosen.length === 0}>
            {t("vote")}
          </GcsButton>
        </fieldset>
      ) : (
        <ul className="gcs-poll__results">
          {poll.options.map((o) => {
            const pct = total === 0 ? 0 : Math.round((o.votes / total) * 100);
            return (
              <li key={o.id}>
                <span className="gcs-poll__label">
                  {o.text}
                  {poll.myVotes.includes(o.id) && <em> · {t("yourVote")}</em>}
                  <span>
                    {pct}% · {t("votes", { count: o.votes })}
                  </span>
                </span>
                <span className="gcs-poll__bar" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="gcs-poll__meta">
        {t("voters", { count: poll.voters })}
        {poll.closed ? ` · ${t("closed")}` : closesLabel ? ` · ${t("closes", { when: closesLabel })}` : ""}
        {!loggedIn && !poll.closed && ` · ${t("loginToVote")}`}
      </p>
      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {error}
        </p>
      )}
    </GcsCard>
  );
}
