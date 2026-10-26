import { normalizeHost } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("linkPage"))("title"), robots: { index: false } };
}

export const dynamic = "force-dynamic";

/**
 * Pagina dinaintea unui link extern (anti-phishing). Un domeniu suspect primește avertizarea roșie; altfel, doar
 * anunțul că membrul părăsește site-ul. Nu redirecționează singură (adresa nu devine un redirect deschis).
 */
export default async function LinkPage({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const { u } = await searchParams;
  const t = await getTranslations("linkPage");
  let url: URL | null = null;
  try {
    url = u && /^https?:\/\//i.test(u) ? new URL(u) : null;
  } catch {
    url = null;
  }
  const host = url ? normalizeHost(url.hostname) : null;
  const danger = url ? await services().antispam.isPhishingUrl(url.href) : false;

  return (
    <GcsCard style={{ padding: 24, maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }} data-testid="gcs-link-page" data-danger={danger ? "1" : "0"}>
      <h1 style={{ margin: 0, fontSize: 22 }}>{danger ? t("dangerTitle") : t("title")}</h1>
      {!url || !host ? (
        <p style={{ margin: 0 }}>{t("invalid")}</p>
      ) : danger ? (
        <>
          <p role="alert" className="gcs-notice gcs-notice--error" style={{ margin: 0 }}>
            {t("dangerBody", { domain: host })}
          </p>
          <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("dangerHint")}</p>
        </>
      ) : (
        <p style={{ margin: 0 }}>{t("body", { domain: host })}</p>
      )}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/" className="gcs-btn gcs-btn--primary">
          {t("back")}
        </Link>
        {url && host && (
          <a href={url.href} rel="nofollow noopener noreferrer" style={{ fontSize: 14, color: danger ? "var(--gcs-danger, #e5484d)" : undefined }} data-testid="gcs-link-continue">
            {danger ? t("continueDanger", { domain: host }) : t("continue", { domain: host })}
          </a>
        )}
      </div>
    </GcsCard>
  );
}
