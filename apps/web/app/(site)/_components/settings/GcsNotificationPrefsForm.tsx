"use client";

import { GcsButton } from "@gcs/ui";
import { useState } from "react";
import { saveNotificationPreferences } from "../../notification-actions";
import { GcsStatus } from "./GcsStatus";
import { useSettingsAction } from "./useSettingsAction";

type Email = "OFF" | "INSTANT" | "DIGEST";
export type GcsNotificationPrefRow = { type: string; label: string; site: boolean; email: Email };

/** Setări → Notificări: pentru fiecare tip, pe site (da/nu) și pe email (oprit / imediat / digest). */
export function GcsNotificationPrefsForm({ rows, labels }: { rows: GcsNotificationPrefRow[]; labels: Record<string, string> }) {
  const { pending, status, run } = useSettingsAction(labels.saved!);
  const [value, setValue] = useState(() => Object.fromEntries(rows.map((r) => [r.type, { site: r.site, email: r.email }])));
  const set = (type: string, patch: Partial<{ site: boolean; email: Email }>) => setValue((v) => ({ ...v, [type]: { ...v[type]!, ...patch } }));
  return (
    <form
      className="gcs-settingsForm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveNotificationPreferences({ prefs: value }));
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table className="gcs-prefTable">
          <thead>
            <tr>
              <th scope="col">{labels.type}</th>
              <th scope="col">{labels.site}</th>
              <th scope="col">{labels.email}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type} data-testid={`gcs-pref-${r.type}`}>
                <th scope="row" style={{ fontWeight: 500, textTransform: "none", fontSize: 14, color: "var(--gcs-text)", letterSpacing: 0 }}>
                  {r.label}
                </th>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${labels.site}: ${r.label}`}
                    checked={value[r.type]!.site}
                    onChange={(e) => set(r.type, { site: e.target.checked })}
                  />
                </td>
                <td>
                  <select
                    className="gcs-input"
                    aria-label={`${labels.email}: ${r.label}`}
                    value={value[r.type]!.email}
                    onChange={(e) => set(r.type, { email: e.target.value as Email })}
                  >
                    {(["OFF", "INSTANT", "DIGEST"] as const).map((o) => (
                      <option key={o} value={o}>
                        {labels[`email_${o}`]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <GcsButton type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </GcsButton>
      </div>
      <GcsStatus status={status} />
    </form>
  );
}
