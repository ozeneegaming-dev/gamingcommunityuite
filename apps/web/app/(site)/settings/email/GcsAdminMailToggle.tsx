"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { setAdminMailAction } from "../../admin-mail-actions";

/** Comutatorul „Emailuri de la administratori” (anunțuri trimise prin Email în masă); se salvează la schimbare. */
export function GcsAdminMailToggle({ receive }: { receive: boolean }) {
  const t = useTranslations("settings.email");
  const errorMessage = useErrorMessage();
  const [on, setOn] = useState(receive);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="gcs-card gcs-adminMail" aria-labelledby="gcs-admin-mail-title" data-testid="gcs-admin-mail">
      <label className="gcs-toggleRow">
        <span>
          <strong id="gcs-admin-mail-title">{t("adminMail")}</strong>
          <small className="gcs-achHint">{t("adminMailHint")}</small>
        </span>
        <input
          type="checkbox"
          checked={on}
          onChange={async (e) => {
            const next = e.target.checked;
            setOn(next);
            setStatus(null);
            const result = await setAdminMailAction({ receive: next });
            if (!result.ok) {
              setOn(!next);
              return setStatus({ ok: false, text: errorMessage(result.error) });
            }
            setStatus({ ok: true, text: t("adminMailSaved") });
          }}
          data-testid="gcs-admin-mail-toggle"
        />
      </label>
      {status && (
        <span role={status.ok ? "status" : "alert"} className={`gcs-bulkBar__status gcs-bulkBar__status--${status.ok ? "ok" : "bad"}`}>
          {status.text}
        </span>
      )}
    </section>
  );
}
