import { faSliders } from "@fortawesome/free-solid-svg-icons";
import { loadPwaConfig, PWA_ACP_SECTION } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { removePwaIcon, savePwaConfig } from "./actions";
import { GcsPwaIconField } from "./GcsPwaIconField";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pwa"))("title") };
}

/**
 * ACP › Sistem › Setări › Web App (PWA): cum arată site-ul instalat pe telefon sau desktop — previzualizarea (iconița,
 * numele, culorile), iconița încărcată prin popupul sistemului și panoul „Setări” (nume, nume scurt, descriere,
 * culori, deschiderea și pagina de pornire). Manifestul (`/manifest.webmanifest`) le citește direct.
 */
export default async function AcpPwaPage() {
  const panel = await requireAcpSection(PWA_ACP_SECTION);
  const { settings, acp } = services();
  const [t, cfg, siteName, canEdit] = await Promise.all([getTranslations("acp.pwa"), loadPwaConfig(settings), settings.get<string>("site.name"), acp.can(panel.actor, PWA_ACP_SECTION, "edit")]);
  const name = cfg.name || siteName;
  const short = cfg.shortName || (name.length > 12 ? name.slice(0, 12) : name);

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-mobile-screen"
        description={t("description")}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("settings")} variant="primary" buttonIcon={<GcsIconSvg icon={faSliders} />} title={t("settings")} titleIcon={<GcsIconSvg icon={faSliders} />} testId="gcs-pwa-settings">
              <GcsActionForm action={savePwaConfig} submitLabel={t("save")} submitKind="save">
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secName")}</legend>
                  <label className="gcs-field">
                    {t("cfg.name")}
                    <input className="gcs-input" name="name" maxLength={60} defaultValue={cfg.name} placeholder={siteName} />
                  </label>
                  <label className="gcs-field">
                    {t("cfg.shortName")}
                    <input className="gcs-input" name="shortName" maxLength={12} defaultValue={cfg.shortName} placeholder={short} />
                    <span className="gcs-field__hint">{t("cfg.shortHint")}</span>
                  </label>
                  <label className="gcs-field">
                    {t("cfg.description")}
                    <textarea className="gcs-input" name="description" rows={2} maxLength={300} defaultValue={cfg.description} />
                  </label>
                </fieldset>
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secLook")}</legend>
                  <div className="gcs-formGrid gcs-formGrid--2">
                    <label className="gcs-field">
                      {t("cfg.themeColor")}
                      <input className="gcs-input" type="color" name="themeColor" defaultValue={cfg.themeColor} />
                    </label>
                    <label className="gcs-field">
                      {t("cfg.backgroundColor")}
                      <input className="gcs-input" type="color" name="backgroundColor" defaultValue={cfg.backgroundColor} />
                    </label>
                  </div>
                  <label className="gcs-field">
                    {t("cfg.display")}
                    <select className="gcs-input" name="display" defaultValue={cfg.display}>
                      {(["standalone", "minimal-ui", "browser"] as const).map((d) => (
                        <option key={d} value={d}>
                          {t(`displays.${d}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="gcs-field">
                    {t("cfg.startUrl")}
                    <input className="gcs-input" name="startUrl" maxLength={200} defaultValue={cfg.startUrl} pattern="/.*" required />
                    <span className="gcs-field__hint">{t("cfg.startHint")}</span>
                  </label>
                </fieldset>
              </GcsActionForm>
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <div className="gcs-sysGrid">
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-pwa-preview">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-pwa-preview" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-mobile-screen-button" /> {t("preview")}
            </h2>
          </div>
          <div className="gcs-pwaPreview" style={{ "--gcs-pwa-theme": cfg.themeColor, "--gcs-pwa-bg": cfg.backgroundColor } as CSSProperties} data-testid="gcs-pwa-preview">
            <div className="gcs-pwaPreview__phone">
              <div className="gcs-pwaPreview__bar" />
              <div className="gcs-pwaPreview__splash">
                <span className="gcs-pwaPreview__icon">
                  {cfg.icon ? (
                    // Iconița încărcată (PNG pătrat).
                    <img src={cfg.icon} alt="" width={72} height={72} />
                  ) : (
                    <GcsIcon name="fa-solid fa-gamepad" />
                  )}
                </span>
                <strong>{name}</strong>
              </div>
            </div>
            <dl className="gcs-sysFacts">
              <div>
                <dt>{t("cfg.shortName")}</dt>
                <dd data-testid="gcs-pwa-short">{short}</dd>
              </div>
              <div>
                <dt>{t("cfg.display")}</dt>
                <dd>{t(`displays.${cfg.display}`)}</dd>
              </div>
              <div>
                <dt>{t("cfg.startUrl")}</dt>
                <dd>
                  <code>{cfg.startUrl}</code>
                </dd>
              </div>
            </dl>
          </div>
        </GcsCard>
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-pwa-icon-title">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-pwa-icon-title" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-image" /> {t("icon")}
            </h2>
          </div>
          <div style={{ padding: "14px 18px 18px" }}>
            {canEdit ? <GcsPwaIconField value={cfg.icon} remove={removePwaIcon} labels={{ title: t("icon"), hint: t("iconHint"), preview: name }} /> : <p className="gcs-sysMuted">{t("iconHint")}</p>}
          </div>
        </GcsCard>
      </div>
    </>
  );
}
