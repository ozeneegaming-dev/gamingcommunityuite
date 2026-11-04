import type { GcsActor } from "@gcs/core";
import { analyticsTags, loadAnalyticsConfig } from "@gcs/modules";
import { cookies } from "next/headers";
import Script from "next/script";
import { COOKIE_NOTICE_COOKIE } from "@/lib/legal-consent";
import { services } from "@/lib/services";

/**
 * Scriptul de analiză a traficului (ACP › Integrări): Google Analytics 4, Plausible sau Umami. Nu se încarcă pentru
 * staff (dacă așa e setat) și, cu „după banda de cookie-uri”, doar după „Am înțeles” (cookie-ul benzii).
 */
export async function GcsAnalytics({ actor }: { actor: GcsActor }) {
  const { settings, permissions } = services();
  const cfg = await loadAnalyticsConfig(settings);
  const tags = analyticsTags(cfg);
  if (!tags) return null;
  if (cfg.afterCookieNotice && (await cookies()).get(COOKIE_NOTICE_COOKIE)?.value !== "1") return null;
  if (cfg.skipStaff && actor.userId && (await permissions.can(actor, "acp.access"))) return null;
  return (
    <>
      <Script id="gcs-analytics" src={tags.src} strategy="afterInteractive" {...tags.attrs} />
      {tags.inline && (
        <Script id="gcs-analytics-init" strategy="afterInteractive">
          {tags.inline}
        </Script>
      )}
    </>
  );
}
