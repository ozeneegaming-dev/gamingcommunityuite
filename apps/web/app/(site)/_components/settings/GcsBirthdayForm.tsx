"use client";

import { GcsButton } from "@gcs/ui";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { saveBirthday } from "../../profile-actions";

type Labels = { title: string; date: string; visible: string; hint: string; save: string; saved: string; clear: string };

/** Ziua de naștere (Setări → Profil): data și dacă e publică (pe profil, fără an, și în `/zi-de-nastere` din chat). */
export function GcsBirthdayForm({ date, visible, labels }: { date: string | null; visible: boolean; labels: Labels }) {
  const errorMessage = useErrorMessage();
  const [value, setValue] = useState(date ?? "");
  const [show, setShow] = useState(visible);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = (next: string) =>
    start(async () => {
      const res = await saveBirthday({ date: next || null, visible: show });
      setStatus(res.ok ? { ok: true, text: labels.saved } : { ok: false, text: errorMessage(res.error) });
    });
  return (
    <form
      className="gcs-card gcs-settingsCard"
      style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        save(value);
      }}
      data-testid="gcs-birthday-form"
    >
      <h3 className="gcs-settingsTitle" style={{ margin: 0 }}>
        {labels.title}
      </h3>
      <label className="gcs-field" style={{ maxWidth: 260 }}>
        {labels.date}
        <input className="gcs-input" type="date" value={value} max={new Date().toISOString().slice(0, 10)} min="1900-01-01" onChange={(e) => setValue(e.target.value)} data-testid="gcs-birthday-date" />
      </label>
      <label className="gcs-check">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} data-testid="gcs-birthday-visible" />
        {labels.visible}
      </label>
      <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>
        {labels.hint}
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <GcsButton type="submit" variant="primary" size="sm" disabled={pending} data-testid="gcs-birthday-save">
          {labels.save}
        </GcsButton>
        {value && (
          <GcsButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setValue("");
              save("");
            }}
          >
            {labels.clear}
          </GcsButton>
        )}
        {status && (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-muted" : undefined} style={{ fontSize: 13 }}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
