import type { GcsNameStyle } from "@gcs/core";
import { NAME_STYLES_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { NameStyleEditor } from "../../groups/[id]/NameStyleEditor";
import { createNameStyle, deleteNameStyle, saveNameStyleLook, saveNameStyleMeta } from "../actions";
import { Availability } from "../Availability";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.vip"))("stylesTitle") };
}

/** ACP → VIP → Stiluri de nume: editorul cu previzualizare live și disponibilitatea fiecărui stil. */
export default async function AcpNameStylesPage() {
  await requireAcpSection(NAME_STYLES_ACP_SECTION);
  const t = await getTranslations("acp.vip");
  const tg = await getTranslations("acp.group");
  const { db } = services();
  const [styles, groups, badges] = await Promise.all([
    db.nameStyle.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] }),
    db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }),
    db.badge.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true, symbol: true } }),
  ]);
  const availabilityLabels = { title: t("availability"), all: t("availableAll"), groups: t("availableGroups"), badges: t("availableBadges") };
  const editorLabels = {
    color: tg("style.color"),
    useGradient: tg("style.useGradient"),
    gradientColor: [tg("style.gradientColor", { n: 1 }), tg("style.gradientColor", { n: 2 }), tg("style.gradientColor", { n: 3 })] as [string, string, string],
    animated: tg("style.animated"),
    glow: tg("style.glow"),
    bold: tg("style.bold"),
    italic: tg("style.italic"),
    icon: tg("style.icon"),
    preview: tg("style.preview"),
    save: tg("style.save"),
    saved: tg("style.saved"),
  };

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("stylesTitle")}
      </h1>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("stylesHelp")}
      </p>
      {styles.map((s) => (
        <GcsCard key={s.id} as="section" aria-label={s.name} style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }} data-testid="gcs-acp-name-style">
          <NameStyleEditor onSave={saveNameStyleLook.bind(null, s.id)} name={s.name} initial={(s.style as GcsNameStyle | null) ?? {}} fallbackColor="#ECEDF1" labels={editorLabels} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <code className="gcs-muted">gcs-name--{s.key}</code>
            <GcsActionForm action={saveNameStyleMeta.bind(null, s.id)} submitLabel={t("save")}>
              <label className="gcs-field">
                {t("name")}
                <input className="gcs-input" name="name" defaultValue={s.name} required maxLength={40} />
              </label>
              <Availability value={s} groups={groups} badges={badges} labels={availabilityLabels} />
            </GcsActionForm>
            <GcsActionForm action={deleteNameStyle.bind(null, s.id)} submitLabel={t("delete")} variant="ghost" compact confirm={t("confirmDelete")}>
              {null}
            </GcsActionForm>
          </div>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-style-new" style={{ padding: 16 }}>
        <h2 id="gcs-style-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("addStyle")}
        </h2>
        <GcsActionForm action={createNameStyle} submitLabel={t("addStyle")}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="gcs-field" style={{ width: 180 }}>
              {t("key")}
              <input className="gcs-input" name="key" required pattern="[a-z0-9_]{1,37}" placeholder="fire" />
            </label>
            <label className="gcs-field" style={{ width: 200 }}>
              {t("name")}
              <input className="gcs-input" name="name" required maxLength={40} />
            </label>
          </div>
          <Availability value={{ allGroups: false, groupIds: [], badgeIds: [] }} groups={groups} badges={badges} labels={availabilityLabels} />
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
