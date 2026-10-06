import { BADGES_ACP_SECTION } from "@gcs/modules";
import { GcsCard, GcsProfileBadge } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { deleteBadge, saveBadge } from "../actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.achievements"))("badgesTitle") };
}

/** ACP → Membri → Realizări → Badge-uri: simbol, culoare, manual/automat și punctele primite odată cu badge-ul. */
export default async function AcpBadgesPage() {
  await requireAcpSection(BADGES_ACP_SECTION);
  const t = await getTranslations("acp.achievements");
  const badges = await services().achievementAdmin.badges();

  const fields = (b?: (typeof badges)[number]) => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="gcs-field" style={{ width: 140 }}>
        {t("key")}
        <input className="gcs-input" name="key" defaultValue={b?.key ?? ""} required pattern="[a-z0-9_]{2,40}" readOnly={Boolean(b)} />
      </label>
      <label className="gcs-field" style={{ width: 180 }}>
        {t("name")}
        <input className="gcs-input" name="name" defaultValue={b?.name ?? ""} required maxLength={40} />
      </label>
      <label className="gcs-field" style={{ width: 80 }}>
        {t("symbol")}
        <input className="gcs-input" name="symbol" defaultValue={b?.symbol ?? ""} required maxLength={8} />
      </label>
      <label className="gcs-field" style={{ width: 110 }}>
        {t("color")}
        <input className="gcs-input" name="color" defaultValue={b?.color ?? "#F4B740"} required pattern="#[0-9A-Fa-f]{6}" />
      </label>
      <label className="gcs-field" style={{ width: 90 }}>
        {t("points")}
        <input className="gcs-input" name="points" type="number" min={-1000} max={1000} defaultValue={b?.points ?? 0} required />
      </label>
      <label className="gcs-field" style={{ flex: "1 1 220px" }}>
        {t("description")}
        <input className="gcs-input" name="description" defaultValue={b?.description ?? ""} maxLength={200} />
      </label>
      <label className="gcs-check">
        <input type="checkbox" name="manual" defaultChecked={b?.manual ?? true} />
        {t("manual")}
      </label>
    </div>
  );

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-award">
        {t("badgesTitle")}
      </GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("badgesHelp")}
      </p>
      {badges.map((b) => (
        <GcsCard key={b.id} as="section" aria-label={b.name} style={{ padding: 16, display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }} data-testid="gcs-acp-badge">
          <GcsProfileBadge badge={{ name: b.name, symbol: b.symbol, image: null, color: b.color }} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <GcsActionForm action={saveBadge.bind(null, b.id)} submitLabel={t("save")} submitKind="save">
              {fields(b)}
            </GcsActionForm>
            <GcsActionForm action={deleteBadge.bind(null, b.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
              {null}
            </GcsActionForm>
          </div>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-badge-new" style={{ padding: 16 }}>
        <h2 id="gcs-badge-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          <GcsAcpTitleIcon name="fa-solid fa-plus" />
          {t("addBadge")}
        </h2>
        <GcsActionForm action={saveBadge.bind(null, null)} submitLabel={t("add")} submitKind="create">
          {fields()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
