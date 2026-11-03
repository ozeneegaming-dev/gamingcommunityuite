import { faSliders } from "@fortawesome/free-solid-svg-icons";
import { GCS_SHARE_NETWORKS, loadShareConfig, SHARE_ACP_SECTION, type GcsShareNetwork } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { saveShareConfig } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.share"))("title") };
}

const ICONS: Record<GcsShareNetwork, string> = {
  x: "fa-brands fa-x-twitter",
  facebook: "fa-brands fa-facebook",
  whatsapp: "fa-brands fa-whatsapp",
  telegram: "fa-brands fa-telegram",
  reddit: "fa-brands fa-reddit",
  linkedin: "fa-brands fa-linkedin",
  email: "fa-solid fa-envelope",
};

/**
 * ACP › Sistem › Promovare › Distribuire: meniul „Distribuie” al topicurilor — rețelele (pornite sau nu), foaia de
 * distribuire a telefonului și hashtag-urile pentru X. Imaginea și titlul afișate de rețele vin din SEO.
 */
export default async function AcpSharePage() {
  const panel = await requireAcpSection(SHARE_ACP_SECTION);
  const { settings, acp } = services();
  const [t, cfg, canEdit] = await Promise.all([getTranslations("acp.share"), loadShareConfig(settings), acp.can(panel.actor, SHARE_ACP_SECTION, "edit")]);
  const on = new Set(cfg.networks);

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-share-nodes"
        description={t("description")}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("settings")} variant="primary" buttonIcon={<GcsIconSvg icon={faSliders} />} title={t("settings")} titleIcon={<GcsIconSvg icon={faSliders} />} testId="gcs-share-settings">
              <GcsActionForm action={saveShareConfig} submitLabel={t("save")} submitKind="save">
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secMenu")}</legend>
                  <label className="gcs-toggleRow">
                    <span>{t("cfg.enabled")}</span>
                    <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} />
                  </label>
                  <label className="gcs-toggleRow">
                    <span>
                      {t("cfg.nativeShare")}
                      <small className="gcs-achHint">{t("cfg.nativeHint")}</small>
                    </span>
                    <input type="checkbox" name="nativeShare" defaultChecked={cfg.nativeShare} />
                  </label>
                </fieldset>
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secNetworks")}</legend>
                  {GCS_SHARE_NETWORKS.map((n) => (
                    <label key={n} className="gcs-toggleRow">
                      <span>
                        <GcsIcon name={ICONS[n]} /> {t(`networks.${n}`)}
                      </span>
                      <input type="checkbox" name={`net:${n}`} defaultChecked={on.has(n)} />
                    </label>
                  ))}
                  <label className="gcs-field">
                    {t("cfg.hashtags")}
                    <input className="gcs-input" name="hashtags" maxLength={100} defaultValue={cfg.hashtags} placeholder="gaming, cs2" />
                    <span className="gcs-field__hint">{t("cfg.hashtagsHint")}</span>
                  </label>
                </fieldset>
              </GcsActionForm>
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <div className={`gcs-sysSummary gcs-sysSummary--${cfg.enabled ? "ok" : "down"}`} data-testid="gcs-share-summary">
        <GcsIcon name={cfg.enabled ? "fa-solid fa-circle-check" : "fa-solid fa-circle-minus"} />
        <span>
          <strong>{cfg.enabled ? t("stateOn", { count: cfg.networks.length }) : t("stateOff")}</strong>
          <small>{[cfg.nativeShare ? t("chipNative") : null, cfg.hashtags ? t("chipTags", { tags: cfg.hashtags }) : null].filter(Boolean).join(" · ") || t("chipNone")}</small>
        </span>
      </div>

      <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-share-list">
        <div className="gcs-acpPanel__head">
          <h2 id="gcs-share-list" className="gcs-acpPanel__title">
            <GcsIcon name="fa-solid fa-share-nodes" /> {t("networksTitle")}
          </h2>
        </div>
        <ul className="gcs-sysList" data-testid="gcs-share-networks">
          <li className="gcs-sysList__row" data-network="copy">
            <span className="gcs-sysList__icon" aria-hidden="true">
              <GcsIcon name="fa-solid fa-link" />
            </span>
            <span className="gcs-sysList__body">
              <strong>{t("copy")}</strong>
              <small>{cfg.nativeShare ? t("copyNative") : t("copyHint")}</small>
            </span>
            <span className="gcs-sysChip gcs-sysChip--ok">{t("always")}</span>
          </li>
          {GCS_SHARE_NETWORKS.map((n) => (
            <li key={n} className="gcs-sysList__row" data-network={n}>
              <span className="gcs-sysList__icon" aria-hidden="true">
                <GcsIcon name={ICONS[n]} />
              </span>
              <span className="gcs-sysList__body">
                <strong>{t(`networks.${n}`)}</strong>
              </span>
              <span className={`gcs-sysChip gcs-sysChip--${on.has(n) ? "ok" : "off"}`} data-state={on.has(n) ? "on" : "off"}>
                {on.has(n) ? t("on") : t("off")}
              </span>
            </li>
          ))}
        </ul>
      </GcsCard>
    </>
  );
}
