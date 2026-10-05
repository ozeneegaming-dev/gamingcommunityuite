"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { reorderPrefixes } from "../forums/actions";

type Prefix = { id: number; name: string; color: string };

/** Ordinea prefixelor, din butoane ↑/↓ (accesibile din tastatură); se salvează imediat. */
export function PrefixOrder({ prefixes }: { prefixes: Prefix[] }) {
  const t = useTranslations("acp.prefixes");
  const errorMessage = useErrorMessage();
  const [rows, setRows] = useState(prefixes);
  const [error, setError] = useState<string | null>(null);

  async function move(index: number, delta: -1 | 1) {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row!);
    setRows(next);
    const res = await reorderPrefixes(next.map((r) => r.id));
    if (!res.ok) {
      setRows(rows);
      setError(errorMessage(res.error));
    } else setError(null);
  }

  return (
    <ol className="gcs-prefixOrder">
      {rows.map((p, i) => (
        <li key={p.id}>
          <span className="gcs-badge" style={{ color: p.color, background: "var(--gcs-surface2)" }}>
            {p.name}
          </span>
          <button type="button" className="gcs-iconBtn" disabled={i === 0} aria-label={t("moveUp", { name: p.name })} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" className="gcs-iconBtn" disabled={i === rows.length - 1} aria-label={t("moveDown", { name: p.name })} onClick={() => move(i, 1)}>
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
