"use client";

import type { GcsResult } from "@gcs/core";
import { GcsButton } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { acknowledgeWarningAction, appealWarningAction } from "../warning-actions";

/** Confirmarea și contestația unui avertisment, pe pagina „Avertismentele mele”. */
export function GcsWarningActions({ warningId, canAcknowledge, canAppeal }: { warningId: string; canAcknowledge: boolean; canAppeal: boolean }) {
  const t = useTranslations("warningsPage");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<GcsResult<void>>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(errorMessage(res.error));
      setOpen(false);
      router.refresh();
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canAcknowledge && (
          <GcsButton variant="primary" size="sm" disabled={pending} onClick={() => run(() => acknowledgeWarningAction({ warningId }))} data-testid="gcs-warning-ack">
            {t("acknowledge")}
          </GcsButton>
        )}
        {canAppeal && !open && (
          <GcsButton size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(true)} data-testid="gcs-warning-appeal-open">
            {t("appeal")}
          </GcsButton>
        )}
      </div>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => appealWarningAction({ warningId, text }));
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <label className="gcs-field">
            {t("appealText")}
            <textarea className="gcs-input" rows={4} minLength={10} maxLength={2000} required value={text} onChange={(e) => setText(e.target.value)} data-testid="gcs-warning-appeal-text" />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <GcsButton variant="primary" size="sm" type="submit" disabled={pending} data-testid="gcs-warning-appeal-send">
              {t("appealSend")}
            </GcsButton>
            <GcsButton size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
