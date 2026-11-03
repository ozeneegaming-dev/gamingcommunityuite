import { GCS_PREMIUM_APPS, installDomain, maskLicenseKey, verifyLicense } from "@gcs/core";
import { GcsBadge, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpSection } from "@/lib/acp";
import { installState } from "@/lib/install";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { changeLicenseAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.license"))("title") };
}

/**
 * ACP › Sistem › Licență: licența GamingCommunitySuite a site-ului (licențiatul, cheia mascată, domeniile, expirarea,
 * aplicațiile premium, verificarea online zilnică și perioada de grație) și schimbarea ei cu o cheie scurtă
 * (`GCS-XXXX-XXXX-XXXX`, activată la Data Center) sau cu tokenul lung al unei licențe offline. Tokenul nu ajunge în
 * browser.
 */
export default async function AcpLicensePage() {
  const { actor } = await requireAcpSection("system.license");
  const t = await getTranslations("acp.license");
  const tu = await getTranslations("acp.update");
  const tr = await getTranslations();
  const format = await getFormatter();
  const state = installState();
  const [token, key] = await Promise.all([state.readLicense(), state.readLicenseKey()]);
  const domain = installDomain();
  const result = token ? verifyLicense(token, { domain, premiumApps: GCS_PREMIUM_APPS }) : null;
  const { registry, licenseOnline, acp } = services();
  const canEdit = await acp.can(actor, "system.license", "edit");
  // Verificarea online a licenței (doar cele emise de Data Center): ultima stare, scrisă de jobul zilnic.
  const online = await licenseOnline.read().catch(() => null);
  const graceEnds = licenseOnline.graceEndsAt(online);
  const appName = (k: string) => {
    const labelKey = registry.module(k)?.app?.labelKey;
    return labelKey && tr.has(labelKey) ? tr(labelKey) : k;
  };
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long" });
  const row = (label: string, value: ReactNode, testId?: string) => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "10px 0", borderBottom: "1px solid var(--gcs-border)" }}>
      <span style={{ flex: "0 0 180px", color: "var(--gcs-muted)", fontSize: 13 }}>{label}</span>
      <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 14, overflowWrap: "anywhere" }} data-testid={testId}>
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <GcsAcpTitle icon="fa-solid fa-key" description={t("description")}>
        {t("title")}
      </GcsAcpTitle>

      {graceEnds && (
        <GcsCard style={{ padding: "14px 20px", borderColor: "var(--gcs-warn)" }} data-testid="gcs-license-grace" role="alert">
          {graceEnds.getTime() > Date.now() ? t("graceActive", { date: date(graceEnds.toISOString()) }) : t("graceEnded")}
        </GcsCard>
      )}

      <GcsCard style={{ padding: "8px 20px 12px" }}>
        {row(
          tu("license"),
          !result ? (
            <span style={{ color: "var(--gcs-muted)" }}>{tu("noLicense")}</span>
          ) : result.ok ? (
            <span>
              <GcsBadge tone="ok">{tu("licenseValid")}</GcsBadge> {result.license.licensee}
            </span>
          ) : (
            <GcsBadge tone="warn">{tu(`licenseErrors.${result.error}`)}</GcsBadge>
          ),
          "gcs-license-status",
        )}
        {token && row(t("key"), key ? <code>{maskLicenseKey(key)}</code> : <span style={{ color: "var(--gcs-muted)" }}>{t("tokenOnly")}</span>, "gcs-license-key")}
        {result?.ok && row(t("domains"), result.license.domains.join(", "), "gcs-license-domains")}
        {result?.ok && row(t("expiry"), result.license.expiresAt ? date(result.license.expiresAt) : tu("noExpiry"))}
        {result?.ok && row(tu("premium"), result.license.apps.length > 0 ? result.license.apps.map(appName).join(", ") : tu("noPremium"), "gcs-license-apps")}
        {result?.ok &&
          online &&
          online.status !== "disabled" &&
          row(
            tu("online.label"),
            <>
              {tu.has(`online.statuses.${online.status}`) ? tu(`online.statuses.${online.status}`) : online.status}
              {online.checkedAt ? ` · ${tu("online.checked", { time: format.dateTime(new Date(online.checkedAt), { dateStyle: "medium", timeStyle: "short" }) })}` : ""}
            </>,
            "gcs-license-online",
          )}
      </GcsCard>

      {canEdit && (
        <GcsCard style={{ padding: 20, maxWidth: 820 }} data-testid="gcs-license-change">
          <GcsActionForm action={changeLicenseAction} submitLabel={token ? t("change.submit") : t("change.submitFirst")} submitKind="save">
            <h2 style={{ margin: 0, fontSize: 16 }}>{token ? t("change.title") : t("change.titleFirst")}</h2>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
              {t("change.field")}
              <input className="gcs-input" name="key" required autoComplete="off" spellCheck={false} placeholder="GCS-XXXX-XXXX-XXXX" />
            </label>
            <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 13, lineHeight: 1.6 }}>{t("change.hint", { domain: domain || "—" })}</p>
          </GcsActionForm>
        </GcsCard>
      )}
    </div>
  );
}
