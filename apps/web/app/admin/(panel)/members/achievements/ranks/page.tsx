import { RANKS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { deleteRank, saveRank } from "../actions";
import { RankOrder } from "../RankOrder";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.achievements"))("ranksTitle") };
}

/** ACP → Membri → Realizări → Ranguri: pragurile (postări, puncte, reputație; goale = fără prag) și ierarhia. */
export default async function AcpRanksPage() {
  await requireAcpSection(RANKS_ACP_SECTION);
  const t = await getTranslations("acp.achievements");
  const ranks = await services().achievementAdmin.ranks();

  const fields = (r?: (typeof ranks)[number]) => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="gcs-field" style={{ width: 180 }}>
        {t("name")}
        <input className="gcs-input" name="name" defaultValue={r?.name ?? ""} required maxLength={40} />
      </label>
      <label className="gcs-field" style={{ width: 80 }}>
        {t("icon")}
        <input className="gcs-input" name="icon" defaultValue={r?.icon ?? ""} maxLength={8} />
      </label>
      {(["minPosts", "minPoints", "minReputation"] as const).map((k) => (
        <label key={k} className="gcs-field" style={{ width: 130 }}>
          {t(k)}
          <input className="gcs-input" name={k} type="number" min={0} defaultValue={r?.[k] ?? ""} />
        </label>
      ))}
    </div>
  );

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("ranksTitle")}
      </h1>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("ranksHelp")}
      </p>
      <GcsCard style={{ padding: 16 }}>
        <RankOrder key={ranks.map((r) => r.id).join(",")} ranks={ranks.map((r) => ({ id: r.id, name: r.name, icon: r.icon }))} />
      </GcsCard>
      {ranks.map((r) => (
        <GcsCard key={r.id} as="section" aria-label={r.name} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-acp-rank">
          <GcsActionForm action={saveRank.bind(null, r.id)} submitLabel={t("save")}>
            {fields(r)}
          </GcsActionForm>
          <GcsActionForm action={deleteRank.bind(null, r.id)} submitLabel={t("delete")} variant="ghost" compact confirm={t("confirmDelete")}>
            {null}
          </GcsActionForm>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-rank-new" style={{ padding: 16 }}>
        <h2 id="gcs-rank-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("addRank")}
        </h2>
        <GcsActionForm action={saveRank.bind(null, null)} submitLabel={t("add")}>
          {fields()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
