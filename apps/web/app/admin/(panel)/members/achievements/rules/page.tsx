import { RULES_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { deleteRule, saveRule } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.achievements"))("rulesTitle") };
}

const TRIGGERS = ["POSTS_COUNT", "REPUTATION", "POINTS", "MEMBER_DAYS", "SOLUTIONS_COUNT", "IS_VIP", "EACH_POST", "EACH_REACTION_RECEIVED", "EACH_SOLUTION"] as const;

/** ACP → Membri → Realizări → Reguli: „când X (prag), acordă badge-ul și/sau puncte”, plus punctele pe acțiune. */
export default async function AcpRulesPage() {
  await requireAcpSection(RULES_ACP_SECTION);
  const t = await getTranslations("acp.achievements");
  const { achievementAdmin } = services();
  const [rules, badges] = await Promise.all([achievementAdmin.rules(), achievementAdmin.badges()]);

  const fields = (r?: (typeof rules)[number]) => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="gcs-field" style={{ flex: "1 1 220px" }}>
        {t("name")}
        <input className="gcs-input" name="name" defaultValue={r?.name ?? ""} required maxLength={80} />
      </label>
      <label className="gcs-field" style={{ width: 260 }}>
        {t("trigger")}
        <select className="gcs-input" name="trigger" defaultValue={r?.trigger ?? "POSTS_COUNT"}>
          {TRIGGERS.map((k) => (
            <option key={k} value={k}>
              {t(`triggers.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="gcs-field" style={{ width: 110 }}>
        {t("threshold")}
        <input className="gcs-input" name="threshold" type="number" min={0} defaultValue={r?.threshold ?? 1} />
      </label>
      <label className="gcs-field" style={{ width: 100 }}>
        {t("points")}
        <input className="gcs-input" name="points" type="number" min={-1000} max={1000} defaultValue={r?.points ?? 0} />
      </label>
      <label className="gcs-field" style={{ width: 200 }}>
        {t("badge")}
        <select className="gcs-input" name="badgeId" defaultValue={r?.badgeId ?? ""}>
          <option value="">{t("noBadge")}</option>
          {badges.map((b) => (
            <option key={b.id} value={b.id}>
              {b.symbol} {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="gcs-check">
        <input type="checkbox" name="enabled" defaultChecked={r?.enabled ?? true} />
        {t("enabled")}
      </label>
    </div>
  );

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("rulesTitle")}
      </h1>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("rulesHelp")}
      </p>
      {rules.map((r) => (
        <GcsCard key={r.id} as="section" aria-label={r.name} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-acp-rule">
          <GcsActionForm action={saveRule.bind(null, r.id)} submitLabel={t("save")}>
            {fields(r)}
          </GcsActionForm>
          <GcsActionForm action={deleteRule.bind(null, r.id)} submitLabel={t("delete")} variant="ghost" compact confirm={t("confirmDelete")}>
            {null}
          </GcsActionForm>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-rule-new" style={{ padding: 16 }}>
        <h2 id="gcs-rule-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("addRule")}
        </h2>
        <GcsActionForm action={saveRule.bind(null, null)} submitLabel={t("add")}>
          {fields()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
