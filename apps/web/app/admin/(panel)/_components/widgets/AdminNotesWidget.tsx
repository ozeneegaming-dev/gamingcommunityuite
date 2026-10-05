"use client";

import { GcsButton } from "@gcs/ui";
import { useId, useState } from "react";
import { saveAdminNote } from "../../actions";

type Props = {
  initial: string;
  updatedLine: string;
  canEdit: boolean;
  labels: { label: string; save: string; saved: string };
};

/** Widgetul „Notițe admin”: un perete comun pentru staff, salvat în `admin_notes`. */
export function AdminNotesWidget({ initial, updatedLine, canEdit, labels }: Props) {
  const id = useId();
  const [body, setBody] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    setStatus("saving");
    const result = await saveAdminNote(body);
    setStatus(result.ok ? "saved" : "error");
  }

  return (
    <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <label htmlFor={id} className="gcs-srOnly">
        {labels.label}
      </label>
      <textarea
        id={id}
        className="gcs-input"
        value={body}
        readOnly={!canEdit}
        onChange={(e) => {
          setBody(e.target.value);
          setStatus("idle");
        }}
        style={{ minHeight: 110, font: "500 13px/1.6 var(--gcs-font-text)", resize: "vertical" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: "var(--gcs-muted)" }}>
        <span role="status">{status === "saved" ? labels.saved : updatedLine}</span>
        {canEdit && (
          <GcsButton variant="ghost" size="sm" onClick={save} disabled={status === "saving"}>
            {labels.save}
          </GcsButton>
        )}
      </div>
    </div>
  );
}
