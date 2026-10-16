import { getTranslations } from "next-intl/server";

export type GcsGoalFieldValues = {
  title: string;
  target: string;
  currency: string;
  period: "MONTHLY" | "CUSTOM";
  startsOn: string;
  endsOn: string;
  autoRenew: boolean;
  groupIds: number[];
  enabled: boolean;
};

/**
 * Câmpurile unui obiectiv de donații: titlul, ținta și moneda, perioada (luna — cu reînnoire lunară — sau un interval),
 * grupurile care îl văd (niciunul bifat = toată lumea) și dacă e pornit.
 */
export async function GcsGoalFields({ values, groups }: { values: GcsGoalFieldValues; groups: { id: number; name: string }[] }) {
  const t = await getTranslations("acp.donations.goals.fields");
  return (
    <div className="gcs-donFields">
      <label className="gcs-field gcs-donFields__wide">
        {t("title")}
        <input className="gcs-input" name="title" defaultValue={values.title} maxLength={80} required placeholder={t("titleHint")} data-testid="gcs-acp-goal-title" />
      </label>
      <label className="gcs-field">
        {t("target")}
        <input className="gcs-input" name="target" inputMode="decimal" defaultValue={values.target} required data-testid="gcs-acp-goal-target" />
      </label>
      <label className="gcs-field">
        {t("currency")}
        <input className="gcs-input" name="currency" defaultValue={values.currency} maxLength={3} required />
      </label>
      <label className="gcs-field">
        {t("period")}
        <select className="gcs-input" name="period" defaultValue={values.period}>
          <option value="MONTHLY">{t("monthly")}</option>
          <option value="CUSTOM">{t("custom")}</option>
        </select>
      </label>
      <label className="gcs-field">
        {t("startsOn")}
        <input className="gcs-input" name="startsOn" type="date" defaultValue={values.startsOn} />
      </label>
      <label className="gcs-field">
        {t("endsOn")}
        <input className="gcs-input" name="endsOn" type="date" defaultValue={values.endsOn} />
      </label>
      <div className="gcs-donFields__checks">
        <label className="gcs-checkRow">
          <input type="checkbox" name="autoRenew" defaultChecked={values.autoRenew} />
          {t("autoRenew")}
        </label>
        <label className="gcs-checkRow">
          <input type="checkbox" name="enabled" defaultChecked={values.enabled} />
          {t("enabled")}
        </label>
      </div>
      <fieldset className="gcs-donFields__groups gcs-donFields__wide">
        <legend>{t("groups")}</legend>
        <span className="gcs-muted">{t("groupsHint")}</span>
        <div className="gcs-donFields__groupList">
          {groups.map((g) => (
            <label key={g.id} className="gcs-checkRow">
              <input type="checkbox" name="groupIds" value={g.id} defaultChecked={values.groupIds.includes(g.id)} />
              {g.name}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
