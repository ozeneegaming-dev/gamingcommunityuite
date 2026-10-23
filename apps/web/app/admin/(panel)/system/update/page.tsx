import { GCS_PREMIUM_APPS, installDomain, verifyLicense } from "@gcs/core";
import { GcsBadge, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpSection } from "@/lib/acp";
import { installState } from "@/lib/install";
import { services } from "@/lib/services";
import { GCS_APP_VERSION } from "@/lib/system-info";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.update"))("title") };
}

/**
 * ACP › Sistem › Actualizare (etapa 11): versiunea instalată, licența (doar pe server) și actualizarea. Actualizarea
 * rulează pe server, prin `install.sh --upgrade`: backup, fișierele noi (verificate), repornire; migrațiile se aplică
 * la pornire, iar datele rămân. Aplicația din container nu controlează Docker-ul serverului, deci pagina nu o pornește.
 */
export default async function AcpUpdatePage() {
  await requireAcpSection("system.update");
  const t = await getTranslations("acp.update");
  const tr = await getTranslations();
  const format = await getFormatter();
  const token = await installState().readLicense();
  const result = token ? verifyLicense(token, { domain: installDomain(), premiumApps: GCS_PREMIUM_APPS }) : null;
  const registry = services().registry;
  const appName = (key: string) => {
    const labelKey = registry.module(key)?.app?.labelKey;
    return labelKey && tr.has(labelKey) ? tr(labelKey) : key;
  };
  const row = (label: string, value: ReactNode, testId?: string) => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "10px 0", borderBottom: "1px solid var(--gcs-border)" }}>
      <span style={{ flex: "0 0 180px", color: "var(--gcs-muted)", fontSize: 13 }}>{label}</span>
      <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 14 }} data-testid={testId}>
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <GcsAcpTitle icon="fa-solid fa-arrows-rotate" description={t("description")}>
        {t("title")}
      </GcsAcpTitle>

      <GcsCard style={{ padding: "8px 20px 12px" }}>
        {row(t("version"), <strong>{GCS_APP_VERSION}</strong>, "gcs-update-version")}
        {row(
          t("license"),
          !result ? (
            <span style={{ color: "var(--gcs-muted)" }}>{t("noLicense")}</span>
          ) : result.ok ? (
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>
                <GcsBadge tone="ok">{t("licenseValid")}</GcsBadge> {result.license.licensee}
              </span>
              <span style={{ color: "var(--gcs-muted)", fontSize: 13 }}>
                {t("domains", { domains: result.license.domains.join(", ") })} ·{" "}
                {result.license.expiresAt ? t("expires", { date: format.dateTime(new Date(result.license.expiresAt), { dateStyle: "long" }) }) : t("noExpiry")}
              </span>
            </span>
          ) : (
            <GcsBadge tone="warn">{t(`licenseErrors.${result.error}`)}</GcsBadge>
          ),
          "gcs-update-license",
        )}
        {result?.ok && row(t("premium"), result.license.apps.length > 0 ? result.license.apps.map(appName).join(", ") : t("noPremium"))}
      </GcsCard>

      <GcsCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{t("howTitle")}</h2>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14, lineHeight: 1.6 }}>{t("howBody")}</p>
        <pre style={{ margin: 0, padding: "12px 14px", borderRadius: 10, background: "var(--gcs-surface2)", border: "1px solid var(--gcs-border)", overflowX: "auto", fontSize: 13 }} data-testid="gcs-update-command">
          <code>sudo bash /opt/gcs/install.sh --upgrade --from gcs-X.Y.Z.tar.gz --dir /opt/gcs</code>
        </pre>
        <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
          <li>{t("steps.backup")}</li>
          <li>{t("steps.verify")}</li>
          <li>{t("steps.keep")}</li>
          <li>{t("steps.restart")}</li>
        </ol>
      </GcsCard>
    </div>
  );
}
