import { normalizeThemeTogglePair, THEME_TOGGLE_SETTING, THEMES_ACP_SECTION } from "@gcs/core";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { createTheme, deleteTheme, importTheme, saveThemeToggle, updateTheme } from "../actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.themes"))("title") };
}

/**
 * ACP → Aspect → Teme (specul etapei 5): lista temelor (implicită, activă), duplicarea, ștergerea, exportul și importul
 * unui pachet de temă (`.gcs-theme.json`) și linkul spre editorul vizual (culorile, fonturile, logo-ul și restul se editează acolo, cu previzualizare live).
 */
export default async function AcpThemesPage() {
  await requireAcpSection(THEMES_ACP_SECTION);
  const [t, themes, rawPair] = await Promise.all([
    getTranslations("acp.themes"),
    services().themes.list(),
    services()
      .settings.get<unknown>(THEME_TOGGLE_SETTING)
      .catch(() => null),
  ]);
  const pair = normalizeThemeTogglePair(rawPair);
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
            <GcsButton asChild variant="ghost" size="sm" icon={<GcsIcon name="fa-solid fa-file-export" />}>
              <a href={`/api/themes/export?key=${encodeURIComponent(theme.key)}`} download={`${theme.key}.gcs-theme.json`} data-testid="gcs-acp-theme-export">
                {t("export")}
              </a>
            </GcsButton>
            {!theme.isDefault && (
              <GcsActionForm action={deleteTheme.bind(null, theme.key)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                {null}
              </GcsActionForm>
            )}
          </div>
        </GcsCard>
      ))}
      {/* Comutatorul lună / soare (antetul, meniul contului, subsolul): perechea de teme, în orice temă. */}
      <GcsCard as="section" aria-labelledby="gcs-theme-toggle" style={{ padding: 16 }} data-testid="gcs-acp-theme-toggle">
        <h2 id="gcs-theme-toggle" className="gcs-acpWidget__title" style={{ marginBottom: 6 }}>
          <GcsAcpTitleIcon name="fa-solid fa-circle-half-stroke" />
          {t("toggle.title")}
        </h2>
        <p className="gcs-muted" style={{ margin: "0 0 12px" }}>
          {t("toggle.hint")}
        </p>
        <GcsActionForm action={saveThemeToggle} submitLabel={t("save")} submitKind="save">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="gcs-checkRow">
              <input type="checkbox" name="enabled" defaultChecked={pair.enabled} data-testid="gcs-acp-theme-toggle-enabled" />
              {t("toggle.enabled")}
            </label>
            {(["dark", "light"] as const).map((side) => (
              <label key={side} className="gcs-field" style={{ width: 220 }}>
                {t(`toggle.${side}`)}
                <select className="gcs-input" name={side} defaultValue={pair[side]} data-testid={`gcs-acp-theme-toggle-${side}`}>
                  {!themes.some((x) => x.key === pair[side]) && <option value={pair[side]}>{t("toggle.missing", { key: pair[side] })}</option>}
                  {themes.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.enabled ? x.name : t("toggle.disabled", { name: x.name })}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </GcsActionForm>
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-theme-import" style={{ padding: 16 }}>
        <h2 id="gcs-theme-import" className="gcs-acpWidget__title" style={{ marginBottom: 6 }}>
          <GcsAcpTitleIcon name="fa-solid fa-file-import" />
          {t("import")}
        </h2>
        <p className="gcs-muted" style={{ margin: "0 0 12px" }}>
          {t("importHint")}
        </p>
        <GcsActionForm action={importTheme} submitLabel={t("importSubmit")} submitIcon={<GcsIcon name="fa-solid fa-upload" />}>
          <label className="gcs-field" style={{ maxWidth: 360 }}>
            {t("importFile")}
            <input className="gcs-input" type="file" name="file" accept=".json,application/json" required data-testid="gcs-acp-theme-import-file" />
          </label>
        </GcsActionForm>
      </GcsCard>
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
