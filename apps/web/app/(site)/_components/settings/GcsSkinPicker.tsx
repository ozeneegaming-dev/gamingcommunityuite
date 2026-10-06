"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { setSkin } from "../../edit-actions";

/** Alegerea temei site-ului (Setări → Aspect), dintre temele active; se aplică imediat. */
export function GcsSkinPicker({ themes, current, labels }: { themes: { key: string; name: string }[]; current: string; labels: { skin: string; saved: string } }) {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [value, setValue] = useState(current);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choose = (key: string) => {
    setValue(key);
    startTransition(async () => {
      const res = await setSkin({ key });
      setStatus(res.ok ? labels.saved : errorMessage(res.error));
      if (res.ok) router.refresh();
    });
  };
  return (
    <label className="gcs-fieldRow" style={{ maxWidth: 360 }}>
      <span style={{ fontWeight: 600 }}>{labels.skin}</span>
      <select className="gcs-input" value={value} onChange={(e) => choose(e.target.value)} disabled={pending} data-testid="gcs-skin-select">
        {themes.map((t) => (
          <option key={t.key} value={t.key}>
            {t.name}
          </option>
        ))}
      </select>
      {status && (
        <span role="status" className="gcs-muted" style={{ fontSize: 13 }}>
          {status}
        </span>
      )}
    </label>
  );
}
