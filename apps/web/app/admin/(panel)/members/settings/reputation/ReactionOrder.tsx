"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { reorderReactions } from "../../../moderation-actions";

type Reaction = { id: number; label: string; symbol: string; color: string };

/** Ordinea reacțiilor (bara de reacții de pe postări), din butoane ↑/↓; se salvează imediat. */
export function ReactionOrder({ reactions }: { reactions: Reaction[] }) {
  const t = useTranslations("acp.reactions");
  const errorMessage = useErrorMessage();
  const [rows, setRows] = useState(reactions);
  const [error, setError] = useState<string | null>(null);

  async function move(index: number, delta: -1 | 1) {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row!);
    setRows(next);
    const res = await reorderReactions(next.map((r) => r.id));
    if (!res.ok) {
      setRows(rows);
      setError(errorMessage(res.error));
    } else setError(null);
  }

  return (
    <ol className="gcs-prefixOrder">
      {rows.map((r, i) => (
        <li key={r.id}>
          <span className="gcs-reaction" aria-hidden="true">
            <span style={{ color: r.color, fontWeight: 800 }}>{r.symbol}</span>
          </span>
          <span>{r.label}</span>
          <button type="button" className="gcs-iconBtn" disabled={i === 0} aria-label={t("moveUp", { name: r.label })} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" className="gcs-iconBtn" disabled={i === rows.length - 1} aria-label={t("moveDown", { name: r.label })} onClick={() => move(i, 1)}>
            ↓
          </button>
        </li>
      ))}
      {error && (
        <li role="alert" className="gcs-field__error">
          {error}
        </li>
      )}
    </ol>
  );
}
