import type { GcsDonationStatus } from "@gcs/modules";
import { getTranslations } from "next-intl/server";

export type GcsDonationFieldValues = {
  member: string;
  donorName: string;
  amount: string;
  currency: string;
  donatedAt: string;
  method: string;
  reference: string;
  note: string;
  anonymous: boolean;
  status: GcsDonationStatus;
};

/**
 * Câmpurile unei donații în ACP (adăugare, editare, fișa membrului): membrul (numele lui; gol = un donator fără cont,
 * cu numele dat sau „Anonim”), suma, moneda, data, metoda (cu propunerile din setări), referința, nota, „anonim” în
 * paginile publice, starea și „anunță donatorul” (notificarea la confirmare).
 */
export async function GcsDonationFields({ values, methods, showMember = true, idPrefix }: { values: GcsDonationFieldValues; methods: string[]; showMember?: boolean; idPrefix: string }) {
  const t = await getTranslations("acp.donations.fields");
  const ts = await getTranslations("donations.status");
  return (
    <div className="gcs-donFields">
      {showMember && (
        <label className="gcs-field">
          {t("member")}
          <input className="gcs-input" name="member" defaultValue={values.member} maxLength={40} autoComplete="off" placeholder={t("memberHint")} data-testid="gcs-acp-donation-member" />
        </label>
      )}
      {showMember && (
        <label className="gcs-field">
          {t("donorName")}
          <input className="gcs-input" name="donorName" defaultValue={values.donorName} maxLength={60} autoComplete="off" placeholder={t("donorNameHint")} />
        </label>
      )}
      <label className="gcs-field">
        {t("amount")}
        <input className="gcs-input" name="amount" inputMode="decimal" required defaultValue={values.amount} data-testid="gcs-acp-donation-amount" />
      </label>
      <label className="gcs-field">
        {t("currency")}
        <input className="gcs-input" name="currency" defaultValue={values.currency} maxLength={3} required />
      </label>
      <label className="gcs-field">
        {t("date")}
        <input className="gcs-input" name="donatedAt" type="date" defaultValue={values.donatedAt} />
      </label>
      <label className="gcs-field">
        {t("method")}
        <input className="gcs-input" name="method" list={`${idPrefix}-methods`} defaultValue={values.method} maxLength={40} autoComplete="off" />
        <datalist id={`${idPrefix}-methods`}>
          {methods.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="gcs-field">
        {t("reference")}
        <input className="gcs-input" name="reference" defaultValue={values.reference} maxLength={120} autoComplete="off" />
      </label>
      <label className="gcs-field">
        {t("note")}
        <input className="gcs-input" name="note" defaultValue={values.note} maxLength={200} autoComplete="off" />
      </label>
      <label className="gcs-field">
        {t("status")}
        <select className="gcs-input" name="status" defaultValue={values.status} data-testid="gcs-acp-donation-status">
          {(["CONFIRMED", "PENDING", "REJECTED"] as const).map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </select>
      </label>
      <div className="gcs-donFields__checks">
        <label className="gcs-checkRow">
          <input type="checkbox" name="anonymous" defaultChecked={values.anonymous} data-testid="gcs-acp-donation-anonymous" />
          {t("anonymous")}
        </label>
        <label className="gcs-checkRow">
          <input type="checkbox" name="notify" defaultChecked data-testid="gcs-acp-donation-notify" />
          {t("notify")}
        </label>
      </div>
    </div>
  );
}
