"use client";

import { faCodeMerge, faTrash, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";

type Props = {
  action: (fd: FormData) => Promise<GcsResult<{ id: string }>>;
  /** Eticheta câmpului de confirmare (cu numele care trebuie scris). */
  confirmLabel: string;
  submitLabel: string;
  warning: string;
  kind: "delete" | "merge";
  children?: ReactNode;
  testId: string;
};

/**
 * Confirmarea unei ștergeri / uniri: câmpurile (modul, opțiunile), avertismentul, numele scris de staff și butonul roșu.
 * După succes merge pe pagina de progres a operației.
 */
export function GcsRemovalForm({ action, confirmLabel, submitLabel, warning, kind, children, testId }: Props) {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await action(new FormData(e.currentTarget));
    if (!result.ok) {
      setPending(false);
      setError(errorMessage(result.error));
      return;
    }
    router.push(`/admin/members/removals/${result.data.id}`);
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid={testId}>
      {children}
      <p className="gcs-removalNote gcs-removalNote--warn" style={{ margin: 0 }}>
        <GcsIconSvg icon={faTriangleExclamation} />
        <span>{warning}</span>
      </p>
      <label className="gcs-field">
        {confirmLabel}
        <input className="gcs-input" name="confirm" required autoComplete="off" spellCheck={false} />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIconSvg icon={kind === "delete" ? faTrash : faCodeMerge} />}>
          {submitLabel}
        </GcsButton>
        {error && (
          <span role="alert" style={{ fontSize: 13, fontWeight: 600, color: "var(--gcs-acp-bad)" }}>
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

/** Modul ștergerii (două carduri radio) și opțiunea mesajelor private, valabilă doar cu „Păstrează conținutul”. */
export function GcsRemovalModeFields({
  labels,
}: {
  labels: { legend: string; recommended: string; keepTitle: string; keepBody: string; deleteTitle: string; deleteBody: string; keepMessages: string; keepMessagesHint: string };
}) {
  const [mode, setMode] = useState<"KEEP_CONTENT" | "DELETE_CONTENT">("KEEP_CONTENT");
  return (
    <>
      <fieldset className="gcs-removalModes">
        <legend>{labels.legend}</legend>
        <label className="gcs-removalMode">
          <input type="radio" name="mode" value="KEEP_CONTENT" checked={mode === "KEEP_CONTENT"} onChange={() => setMode("KEEP_CONTENT")} />
          <span className="gcs-removalMode__title">
            {labels.keepTitle} <span className="gcs-acpPill gcs-acpPill--good">{labels.recommended}</span>
          </span>
          <span className="gcs-removalMode__body">{labels.keepBody}</span>
        </label>
        <label className="gcs-removalMode">
          <input type="radio" name="mode" value="DELETE_CONTENT" checked={mode === "DELETE_CONTENT"} onChange={() => setMode("DELETE_CONTENT")} />
          <span className="gcs-removalMode__title">{labels.deleteTitle}</span>
          <span className="gcs-removalMode__body">{labels.deleteBody}</span>
        </label>
      </fieldset>
      <label className="gcs-field" style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, opacity: mode === "KEEP_CONTENT" ? 1 : 0.55 }}>
        <input type="checkbox" name="keepMessages" disabled={mode !== "KEEP_CONTENT"} style={{ marginTop: 3 }} />
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {labels.keepMessages}
          <span style={{ color: "var(--gcs-muted)", fontSize: 12.5, fontWeight: 400 }}>{labels.keepMessagesHint}</span>
        </span>
      </label>
    </>
  );
}
