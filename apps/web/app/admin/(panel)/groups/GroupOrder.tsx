"use client";

import { GcsBadge } from "@gcs/ui";
import Link from "next/link";
import { useState } from "react";
import { useErrorMessage } from "../_components/GcsActionForm";
import { reorderGroups } from "./actions";

type Row = { id: number; key: string; name: string; members: number; type: "protected" | "vip" | "custom" };

type Props = {
  groups: Row[];
  labels: { name: string; members: string; type: string; edit: string; types: Record<Row["type"], string>; moveUp: Record<number, string>; moveDown: Record<number, string> };
};

/** Lista grupurilor, reordonabilă din butoane (accesibile din tastatură); ordinea se salvează imediat. */
export function GroupOrder({ groups, labels }: Props) {
  const [rows, setRows] = useState(groups);
  const [error, setError] = useState<string | null>(null);
  const errorMessage = useErrorMessage();

  async function move(index: number, delta: -1 | 1) {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row!);
    setRows(next);
    const result = await reorderGroups(next.map((r) => r.id));
    if (!result.ok) {
      setRows(rows);
      setError(errorMessage(result.error));
    } else {
      setError(null);
    }
  }

  return (
    <div className="gcs-table">
      {error && (
        <p role="alert" className="gcs-field__error" style={{ padding: "8px 16px" }}>
          {error}
        </p>
      )}
      <table className="gcs-table__table">
        <thead>
          <tr>
            <th className="gcs-table__th" scope="col">{labels.name}</th>
            <th className="gcs-table__th" scope="col">{labels.members}</th>
            <th className="gcs-table__th" scope="col">{labels.type}</th>
            <th className="gcs-table__th" scope="col" />
          </tr>
        </thead>
        <tbody>
          {rows.map((g, i) => (
            <tr key={g.id} className="gcs-table__row">
              <td className="gcs-table__td">
                <span className={`gcs-name--${g.key}`}>{g.name}</span>
              </td>
              <td className="gcs-table__td">{g.members}</td>
              <td className="gcs-table__td">
                <GcsBadge tone={g.type === "vip" ? "vip" : g.type === "protected" ? "neutral" : "info"}>{labels.types[g.type]}</GcsBadge>
              </td>
              <td className="gcs-table__td" style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                <button type="button" className="gcs-iconBtn" disabled={i === 0} aria-label={labels.moveUp[g.id]} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="gcs-iconBtn" disabled={i === rows.length - 1} aria-label={labels.moveDown[g.id]} onClick={() => move(i, 1)}>
                  ↓
                </button>{" "}
                <Link href={`/admin/groups/${g.id}`} aria-label={`${labels.edit}: ${g.name}`} style={{ marginLeft: 8 }}>
                  {labels.edit}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
