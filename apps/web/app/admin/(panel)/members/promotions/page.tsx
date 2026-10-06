import { PROMOTIONS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { deletePromotion, savePromotion } from "../achievements/actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.promotions"))("title") };
}

/** ACP → Membri → Promovări de grup: „din grupurile X, cu pragurile atinse → grupul G” (evaluate de worker). */
export default async function AcpPromotionsPage() {
  await requireAcpSection(PROMOTIONS_ACP_SECTION);
  const t = await getTranslations("acp.promotions");
  const { promotions, db } = services();
  const [rules, groups] = await Promise.all([promotions.list(), db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true, key: true } })]);
  const targets = groups.filter((g) => !["root_admin", "admin", "super_moderator", "moderator", "banned", "guest"].includes(g.key));

  const fields = (r?: (typeof rules)[number]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="gcs-field" style={{ flex: "1 1 220px" }}>
          {t("name")}
          <input className="gcs-input" name="name" defaultValue={r?.name ?? ""} required maxLength={80} />
        </label>
        <label className="gcs-field" style={{ width: 200 }}>
          {t("to")}
          <select className="gcs-input" name="toGroupId" defaultValue={r?.toGroupId ?? (targets.find((g) => g.key !== "member" && g.key !== "new_member") ?? targets[0])?.id}>
            {targets.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field" style={{ width: 200 }}>
          {t("mode")}
          <select className="gcs-input" name="mode" defaultValue={r && !r.asPrimary ? "secondary" : "primary"}>
            <option value="primary">{t("primary")}</option>
            <option value="secondary">{t("secondary")}</option>
          </select>
        </label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <legend className="gcs-field" style={{ marginBottom: 6 }}>
          {t("from")}
        </legend>
        {groups
          .filter((g) => !["root_admin", "admin", "super_moderator", "moderator", "banned", "guest"].includes(g.key))
          .map((g) => (
            <label key={g.id} className="gcs-check">
              <input type="checkbox" name="fromGroupIds" value={g.id} defaultChecked={r ? r.fromGroupIds.includes(g.id) : g.key === "member"} />
              {g.name}
            </label>
          ))}
      </fieldset>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        {(["minPosts", "minDays", "minReputation", "minPoints"] as const).map((k) => (
          <label key={k} className="gcs-field" style={{ width: 130 }}>
            {t(k)}
            <input className="gcs-input" name={k} type="number" min={0} defaultValue={r?.[k] ?? ""} />
          </label>
        ))}
        <label className="gcs-check">
          <input type="checkbox" name="enabled" defaultChecked={r?.enabled ?? true} />
          {t("enabled")}
        </label>
      </div>
    </div>
  );

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-arrow-trend-up">
        {t("title")}
      </GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("help")}
      </p>
      {rules.map((r) => (
        <GcsCard key={r.id} as="section" aria-label={r.name} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-acp-promotion">
          <GcsActionForm action={savePromotion.bind(null, r.id)} submitLabel={t("save")} submitKind="save">
            {fields(r)}
          </GcsActionForm>
          <GcsActionForm action={deletePromotion.bind(null, r.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
            {null}
          </GcsActionForm>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-promotion-new" style={{ padding: 16 }}>
        <h2 id="gcs-promotion-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          <GcsAcpTitleIcon name="fa-solid fa-plus" />
          {t("add")}
        </h2>
        <GcsActionForm action={savePromotion.bind(null, null)} submitLabel={t("add")} submitKind="create">
          {fields()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
