"use client";

import { useState, type ReactNode } from "react";
import { GcsProfileSortable } from "./GcsProfileSortable";

export type GcsPostbitOrderRow = { id: string; name: string; icon: ReactNode; meta: string };

/**
 * „Ordinea în postare”: câmpurile afișate sub avatar, reordonabile prin tragere sau săgeți. Fiecare rând trimite
 * `order.<cheie>` = poziția, citit de `savePostbitOrder` (butonul formularului din jur salvează).
 */
export function GcsPostbitOrder({ fields }: { fields: GcsPostbitOrderRow[] }) {
  const [rows, setRows] = useState(fields);
  return (
    <GcsProfileSortable
      items={rows}
      onChange={setRows}
      className="gcs-acpProf__rows gcs-acpProf__rows--boxed"
      testId="gcs-acp-postbit-list"
      renderRow={(row, { handle, arrows }) => (
        <div className="gcs-acpProf__row" data-testid="gcs-acp-postbit-row" data-key={row.id}>
          {handle}
          <span className="gcs-acpProf__pos" aria-hidden="true">
            {rows.indexOf(row) + 1}
          </span>
          <span className="gcs-acpProf__tile" aria-hidden="true">
            {row.icon}
          </span>
          <span className="gcs-acpProf__text">
            <b className="gcs-acpProf__name">{row.name}</b>
            <span className="gcs-acpProf__meta">
              <code className="gcs-acpProf__key">{row.id}</code>
              {row.meta && <> · {row.meta}</>}
            </span>
          </span>
          <span className="gcs-acpProf__actions">{arrows}</span>
          <input type="hidden" name={`order.${row.id}`} value={rows.indexOf(row) + 1} />
        </div>
      )}
    />
  );
}
