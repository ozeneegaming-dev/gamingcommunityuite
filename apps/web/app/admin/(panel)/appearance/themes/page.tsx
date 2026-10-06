import { THEMES_ACP_SECTION } from "@gcs/core";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { createTheme, deleteTheme, updateTheme } from "../actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.themes"))("title") };
}

/**
 * ACP → Aspect → Teme (specul etapei 5): lista temelor (implicită, activă), duplicarea, ștergerea și linkul spre
 * editorul vizual (culorile, fonturile, logo-ul și restul se editează acolo, cu previzualizare live).
 */
export default async function AcpThemesPage() {
  await requireAcpSection(THEMES_ACP_SECTION);
  const [t, themes] = await Promise.all([getTranslations("acp.themes"), services().themes.list()]);
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-brush">
        {t("title")}
      </GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("hint")}
      </p>
      {themes.map((theme) => (
        <GcsCard key={theme.key} as="section" aria-label={theme.name} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-acp-theme">
          <h2 className="gcs-acpWidget__title" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="gcs-themeSwatch" style={{ background: theme.settings.dark.accent }} aria-hidden="true" />
            {theme.name} <code className="gcs-muted">{theme.key}</code>
            {theme.isDefault && <span className="gcs-badge gcs-badge--accent">{t("default")}</span>}
            {theme.draft && <span className="gcs-badge">{t("draft")}</span>}
          </h2>
          <GcsActionForm action={updateTheme.bind(null, theme.key)} submitLabel={t("save")} submitKind="save">
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label className="gcs-field" style={{ width: 220 }}>
                {t("name")}
                <input className="gcs-input" name="name" defaultValue={theme.name} required maxLength={40} />
              </label>
              <label className="gcs-checkRow">
                <input type="checkbox" name="enabled" defaultChecked={theme.enabled} />
                {t("enabled")}
              </label>
              <label className="gcs-checkRow">
                <input type="checkbox" name="isDefault" defaultChecked={theme.isDefault} />
                {t("isDefault")}
              </label>
            </div>
          </GcsActionForm>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <GcsButton asChild variant="primary" size="sm" icon={<GcsIcon name="fa-solid fa-paintbrush" />}>
              <Link href={`/admin/theme-editor/${theme.key}`} data-testid="gcs-acp-theme-visual">
                {t("visualEditor")}
              </Link>
            </GcsButton>
            {!theme.isDefault && (
              <GcsActionForm action={deleteTheme.bind(null, theme.key)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                {null}
              </GcsActionForm>
            )}
          </div>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-theme-new" style={{ padding: 16 }}>
        <h2 id="gcs-theme-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          <GcsAcpTitleIcon name="fa-solid fa-plus" />
          {t("create")}
        </h2>
        <GcsActionForm action={createTheme} submitLabel={t("create")} submitKind="create">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="gcs-field" style={{ width: 160 }}>
              {t("key")}
              <input className="gcs-input" name="key" required pattern="[a-z0-9][a-z0-9-]{1,31}" />
            </label>
            <label className="gcs-field" style={{ width: 220 }}>
              {t("name")}
              <input className="gcs-input" name="name" required maxLength={40} />
            </label>
            <label className="gcs-field" style={{ width: 200 }}>
              {t("copyFrom")}
              <select className="gcs-input" name="from" defaultValue={themes.find((x) => x.isDefault)?.key ?? ""}>
                <option value="">{t("fromDefaults")}</option>
                {themes.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
