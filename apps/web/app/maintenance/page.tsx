import { GcsButton, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("maintenance"))("title"), robots: { index: false } };
}

/** Pagina afișată (cu status 503, prin `proxy.ts`) cât timp site-ul e în mentenanță. */
export default async function MaintenancePage() {
  const t = await getTranslations("maintenance");
  const site = await services().settings.get<string>("site.name");
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <GcsCard as="section" style={{ maxWidth: 520, padding: "32px 36px", display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
        <span className="gcs-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: ".06em" }}>
          {site}
        </span>
        <h1 className="gcs-display" style={{ margin: 0, fontSize: 30, fontWeight: 700 }}>
          {t("title")}
        </h1>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 15, lineHeight: 1.6 }}>{t("body", { site })}</p>
        <GcsButton variant="ghost" asChild>
          <Link href="/login">{t("login")}</Link>
        </GcsButton>
      </GcsCard>
    </main>
  );
}
