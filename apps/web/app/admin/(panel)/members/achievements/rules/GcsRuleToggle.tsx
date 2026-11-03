"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { toggleRule } from "../actions";

/**
 * Comutatorul unei reguli clasice din listă: pornește / oprește regula pe loc (fără panou), cu revenire la starea de
 * dinainte și mesajul de eroare dacă salvarea nu reușește.
 */
export function GcsRuleToggle({ id, name, enabled }: { id: number; name: string; enabled: boolean }) {
  const t = useTranslations("acp.achievements.v2");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    const next = !on;
    setOn(next);
    setBusy(true);
    setError(null);
    const res = await toggleRule(id, next);
    setBusy(false);
    if (!res.ok) {
      setOn(!next);
      setError(errorMessage(res.error));
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button type="button" role="switch" aria-checked={on} aria-label={t("toggle", { name })} className="gcs-ruleList__switch gcs-sweep" disabled={busy} onClick={flip} data-testid="gcs-classic-rule-toggle">
        <span />
      </button>
      {error && (
        <span role="alert" className="gcs-field__error gcs-achClassic__error">
          {error}
        </span>
      )}
    </>
  );
}
