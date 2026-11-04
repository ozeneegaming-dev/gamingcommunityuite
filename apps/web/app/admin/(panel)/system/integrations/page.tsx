import { faChartLine } from "@fortawesome/free-solid-svg-icons";
import { INTEGRATIONS_ACP_SECTION, integrationsOverview, loadAnalyticsConfig, type GcsIntegrationGroup } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { saveAnalytics } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.integrations"))("title") };
}

const GROUPS: { key: GcsIntegrationGroup; icon: string }[] = [
  { key: "login", icon: "fa-solid fa-right-to-bracket" },
  { key: "security", icon: "fa-solid fa-shield-halved" },
  { key: "email", icon: "fa-solid fa-envelope" },
  { key: "search", icon: "fa-solid fa-magnifying-glass-chart" },
  { key: "translate", icon: "fa-solid fa-language" },
  { key: "developers", icon: "fa-solid fa-code" },
];
const ICONS: Record<string, string> = {
  discord: "fa-brands fa-discord",
  google: "fa-brands fa-google",
  steam: "fa-brands fa-steam",
  turnstile: "fa-solid fa-robot",
  sfs: "fa-solid fa-ban",
  smtp: "fa-solid fa-paper-plane",
  verification: "fa-solid fa-circle-check",
  indexnow: "fa-solid fa-bolt",
  translate: "fa-solid fa-language",
  webhooks: "fa-solid fa-satellite-dish",
  api: "fa-solid fa-key",
};

/**
 * ACP › Sistem › Funcții site › Integrări: serviciile externe ale site-ului (login, anti-spam, email, motoare de
 * căutare, traduceri, dezvoltatori), fiecare cu starea și linkul spre pagina unde se configurează, plus analiza
 * traficului (Google Analytics 4, Plausible sau Umami), care se setează chiar aici.
 */
export default async function AcpIntegrationsPage() {
  const panel = await requireAcpSection(INTEGRATIONS_ACP_SECTION);
  const { acp, db, settings } = services();
  const [t, items, analytics, canEdit] = await Promise.all([
    getTranslations("acp.integrations"),
    integrationsOverview({ db, settings }),
    loadAnalyticsConfig(settings),
    acp.can(panel.actor, INTEGRATIONS_ACP_SECTION, "edit"),
  ]);
  const on = items.filter((i) => i.level !== "off").length + (analytics.provider === "none" ? 0 : 1);
  const warn = items.filter((i) => i.level === "warn");
  const levelLabel = (level: "ok" | "warn" | "off") => t(`levels.${level}`);

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-plug" description={t("description")}>
        {t("title")}
      </GcsAcpTitle>

      <div className={`gcs-sysSummary${warn.length > 0 ? " gcs-sysSummary--warn" : ""}`} data-testid="gcs-integrations-summary">
        <GcsIcon name={warn.length > 0 ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-plug-circle-check"} />
        <span>
          <strong>{t("summary", { on, all: items.length + 1 })}</strong>
          <small>{warn.length > 0 ? t("summaryWarn", { names: warn.map((i) => t(`items.${i.key}.name`)).join(", ") }) : t("summaryHint")}</small>
        </span>
      </div>

      <GcsCard className="gcs-acpPanel">
        <h2 className="gcs-acpPanel__title">
          <GcsIconSvg icon={faChartLine} /> {t("analytics.title")}
        </h2>
        <ul className="gcs-sysList">
          <li className="gcs-sysList__row" data-testid="gcs-integration-row" data-key="analytics">
            <span className="gcs-sysList__icon" aria-hidden="true">
              <GcsIcon name="fa-solid fa-chart-line" />
            </span>
            <span className="gcs-sysList__body">
              <strong>{t(`analytics.providers.${analytics.provider}`)}</strong>
              <small>{t("analytics.hint")}</small>
            </span>
            <span className={`gcs-sysChip gcs-sysChip--${analytics.provider === "none" ? "off" : "ok"}`} data-level={analytics.provider === "none" ? "off" : "ok"}>
              {levelLabel(analytics.provider === "none" ? "off" : "ok")}
            </span>
            {canEdit && (
              <GcsAcpEditPanel title={t("analytics.title")} titleIcon={<GcsIconSvg icon={faChartLine} />} testId="gcs-analytics-edit">
                <GcsActionForm action={saveAnalytics} submitLabel={t("save")} submitKind="save">
                  <fieldset className="gcs-formSec">
                    <legend>{t("analytics.provider")}</legend>
                    <label className="gcs-field">
                      {t("analytics.provider")}
                      <select className="gcs-input" name="provider" defaultValue={analytics.provider}>
                        {(["none", "ga4", "plausible", "umami"] as const).map((p) => (
                          <option key={p} value={p}>
                            {t(`analytics.providers.${p}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                  <fieldset className="gcs-formSec">
                    <legend>{t("analytics.providers.ga4")}</legend>
                    <label className="gcs-field">
                      {t("analytics.ga4Id")}
                      <input className="gcs-input" name="ga4Id" defaultValue={analytics.ga4Id} placeholder="G-XXXXXXXXXX" maxLength={18} />
                      <span className="gcs-field__hint">{t("analytics.ga4Hint")}</span>
                    </label>
                  </fieldset>
                  <fieldset className="gcs-formSec">
                    <legend>{t("analytics.providers.plausible")}</legend>
                    <label className="gcs-field">
                      {t("analytics.domain")}
                      <input className="gcs-input" name="plausibleDomain" defaultValue={analytics.plausibleDomain} placeholder="forum.exemplu.ro" maxLength={253} />
                    </label>
                    <label className="gcs-field">
                      {t("analytics.script")}
                      <input className="gcs-input" name="plausibleSrc" type="url" defaultValue={analytics.plausibleSrc} maxLength={300} />
                      <span className="gcs-field__hint">{t("analytics.scriptHint")}</span>
                    </label>
                  </fieldset>
                  <fieldset className="gcs-formSec">
                    <legend>{t("analytics.providers.umami")}</legend>
                    <label className="gcs-field">
                      {t("analytics.websiteId")}
                      <input className="gcs-input" name="umamiId" defaultValue={analytics.umamiId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" maxLength={36} />
                    </label>
                    <label className="gcs-field">
                      {t("analytics.script")}
                      <input className="gcs-input" name="umamiSrc" type="url" defaultValue={analytics.umamiSrc} maxLength={300} />
                    </label>
                  </fieldset>
                  <fieldset className="gcs-formSec">
                    <legend>{t("analytics.who")}</legend>
                    <label className="gcs-toggleRow">
                      <span>{t("analytics.skipStaff")}</span>
                      <input type="checkbox" name="skipStaff" defaultChecked={analytics.skipStaff} />
                    </label>
                    <label className="gcs-toggleRow">
                      <span>{t("analytics.afterCookieNotice")}</span>
                      <input type="checkbox" name="afterCookieNotice" defaultChecked={analytics.afterCookieNotice} />
                    </label>
                    <span className="gcs-field__hint">{t("analytics.cookieHint")}</span>
                  </fieldset>
                </GcsActionForm>
              </GcsAcpEditPanel>
            )}
          </li>
        </ul>
      </GcsCard>

      {GROUPS.map((g) => {
        const rows = items.filter((i) => i.group === g.key);
        return (
          <GcsCard key={g.key} className="gcs-acpPanel">
            <h2 className="gcs-acpPanel__title">
              <GcsIcon name={g.icon} /> {t(`groups.${g.key}`)}
            </h2>
            <ul className="gcs-sysList">
              {rows.map((i) => (
                <li key={i.key} className="gcs-sysList__row" data-testid="gcs-integration-row" data-key={i.key}>
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    <GcsIcon name={ICONS[i.key] ?? "fa-solid fa-plug"} />
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{t(`items.${i.key}.name`)}</strong>
                    <small>
                      {t(`items.${i.key}.hint`)}
                      {i.detail !== undefined && i.level !== "off" && ` · ${t(`items.${i.key}.detail`, { detail: i.detail })}`}
                    </small>
                  </span>
                  <span className={`gcs-sysChip gcs-sysChip--${i.level}`} data-level={i.level}>
                    {levelLabel(i.level)}
                  </span>
                  <Link href={i.href} className="gcs-btn gcs-btn--ghost gcs-btn--sm" data-testid="gcs-integration-link">
                    <GcsIcon name="fa-solid fa-sliders" className="gcs-btn__icon" />
                    {t("configure")}
                  </Link>
                </li>
              ))}
            </ul>
          </GcsCard>
        );
      })}
    </>
  );
}
