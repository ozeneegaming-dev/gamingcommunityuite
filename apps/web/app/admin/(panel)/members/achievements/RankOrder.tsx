"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { reorderRanks } from "./actions";

/** Ordinea rangurilor (ierarhia: ultimul e cel mai înalt), din butoane ↑/↓; se salvează imediat. */
export function RankOrder({ ranks }: { ranks: { id: number; name: string; icon: string | null }[] }) {
  const t = useTranslations("acp.achievements");
  const errorMessage = useErrorMessage();
  const [rows, setRows] = useState(ranks);
  const [error, setError] = useState<string | null>(null);

  async function move(index: number, delta: -1 | 1) {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row!);
    setRows(next);
    const res = await reorderRanks(next.map((r) => r.id));
    if (!res.ok) {
      setRows(rows);
      setError(errorMessage(res.error));
    } else setError(null);
  }

  return (
    <ol className="gcs-prefixOrder">
      {rows.map((r, i) => (
        <li key={r.id}>
          <span>
            {r.icon ? `${r.icon} ` : ""}
            {r.name}
          </span>
          <button type="button" className="gcs-iconBtn" disabled={i === 0} aria-label={t("moveUp", { name: r.name })} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" className="gcs-iconBtn" disabled={i === rows.length - 1} aria-label={t("moveDown", { name: r.name })} onClick={() => move(i, 1)}>
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
