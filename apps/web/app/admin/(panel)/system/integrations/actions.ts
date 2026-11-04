"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { ANALYTICS_SETTING, analyticsConfigError, DEFAULT_ANALYTICS, INTEGRATIONS_ACP_SECTION, type GcsAnalyticsConfig } from "@gcs/modules";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const ERROR_FIELD: Record<string, string> = { invalid_ga4: "ga4Id", invalid_domain: "plausibleDomain", invalid_uuid: "umamiId", invalid_url: "plausibleSrc" };

/** Analiza traficului: furnizorul, ID-urile lui și cui nu i se încarcă scriptul. */
export async function saveAnalytics(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(INTEGRATIONS_ACP_SECTION, "edit", async (actor) => {
    const provider = field(fd, "provider");
    const value: GcsAnalyticsConfig = {
      provider: provider === "ga4" || provider === "plausible" || provider === "umami" ? provider : "none",
      ga4Id: field(fd, "ga4Id").trim().toUpperCase(),
      plausibleDomain: field(fd, "plausibleDomain").trim().toLowerCase(),
      plausibleSrc: field(fd, "plausibleSrc").trim() || DEFAULT_ANALYTICS.plausibleSrc,
      umamiId: field(fd, "umamiId").trim().toLowerCase(),
      umamiSrc: field(fd, "umamiSrc").trim() || DEFAULT_ANALYTICS.umamiSrc,
      skipStaff: field(fd, "skipStaff") === "on",
      afterCookieNotice: field(fd, "afterCookieNotice") === "on",
    };
    const error = analyticsConfigError(value);
    if (error) throw new GcsValidationError({ [ERROR_FIELD[error] ?? "provider"]: error });
    await services().settings.set(ANALYTICS_SETTING, value, actor);
    return null;
  });
}
