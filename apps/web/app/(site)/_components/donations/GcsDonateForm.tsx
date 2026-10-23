"use client";

import { faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsField, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { submitDonation } from "../../donation-actions";

/**
 * „Am donat”: suma, moneda, metoda, referința plății (ex. id-ul tranzacției), data, o notă și „afișează-mă anonim”.
 * Cererea ajunge la echipă în așteptare; după confirmare, membrul primește o notificare. Niciodată date de card.
 */
export function GcsDonateForm({ currency, methods, today }: { currency: string; methods: string[]; today: string }) {
  const t = useTranslations("donations.form");
  const tErr = useTranslations("errors");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const value = (k: string) => String(fd.get(k) ?? "");
    const amount = Number(value("amount").replace(",", "."));
    setPending(true);
    setStatus(null);
    const result = await submitDonation({
      amount: Number.isFinite(amount) ? amount : 0,
      currency: value("currency"),
      method: value("method"),
      reference: value("reference"),
      note: value("note"),
      anonymous: fd.get("anonymous") === "on",
      donatedAt: value("donatedAt"),
    });
    setPending(false);
    if (!result.ok) {
      setErrors(Object.fromEntries(Object.entries(result.error.fields ?? {}).map(([k, code]) => [k, tErr.has(`fields.${code}`) ? tErr(`fields.${code}`) : code])));
      setStatus({ ok: false, text: errorMessage(result.error) });
      return;
    }
    setErrors({});
    form.reset();
    setStatus({ ok: true, text: t("sent") });
    router.refresh();
  }

  return (
    <form className="gcs-donForm" onSubmit={onSubmit} data-testid="gcs-donate-form" noValidate>
      <div className="gcs-donForm__grid">
        <GcsField label={t("amount")} {...(errors.amount ? { error: errors.amount } : {})}>
          <input name="amount" inputMode="decimal" required autoComplete="off" data-testid="gcs-donate-amount" />
        </GcsField>
        <GcsField label={t("currency")} {...(errors.currency ? { error: errors.currency } : {})}>
          <input name="currency" defaultValue={currency} maxLength={3} required autoComplete="off" />
        </GcsField>
        <GcsField label={t("method")} {...(errors.method ? { error: errors.method } : {})}>
          <input name="method" list="gcs-donate-methods" maxLength={40} autoComplete="off" data-testid="gcs-donate-method" />
        </GcsField>
        <GcsField label={t("date")} {...(errors.donatedAt ? { error: errors.donatedAt } : {})}>
          <input name="donatedAt" type="date" defaultValue={today} max={today} />
        </GcsField>
      </div>
      <datalist id="gcs-donate-methods">
        {methods.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <GcsField label={t("reference")} hint={t("referenceHint")} {...(errors.reference ? { error: errors.reference } : {})}>
        <input name="reference" maxLength={120} required autoComplete="off" data-testid="gcs-donate-reference" />
      </GcsField>
      <GcsField label={t("note")} {...(errors.note ? { error: errors.note } : {})}>
        <input name="note" maxLength={200} autoComplete="off" />
      </GcsField>
      <label className="gcs-checkRow">
        <input type="checkbox" name="anonymous" data-testid="gcs-donate-anonymous" />
        {t("anonymous")}
      </label>
      <p className="gcs-muted gcs-donForm__safe">{t("noCard")}</p>
      <div className="gcs-donForm__foot">
        <GcsButton type="submit" variant="primary" loading={pending} icon={<GcsIconSvg icon={faPaperPlane} />} data-testid="gcs-donate-submit">
          {t("submit")}
        </GcsButton>
        {status && (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-donForm__ok" : "gcs-donForm__err"} data-testid="gcs-donate-status">
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
