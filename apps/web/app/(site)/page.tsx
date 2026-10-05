import { GcsBadge, GcsButton, GcsCard } from "@gcs/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

/** Pagina principală provizorie: anunțul din machetă; forumul vine în etapa 2. */
export default async function HomePage() {
  const t = await getTranslations("site.comingSoon");
  const siteName = await services().settings.get<string>("site.name");
  const actor = await currentActor();

  return (
    <GcsCard
      as="section"
      style={{
        padding: "28px 32px",
        display: "flex",
        flexWrap: "wrap",
        gap: 24,
        alignItems: "center",
        justifyContent: "space-between",
        background: "linear-gradient(120deg, #1A0F12 0%, #14161C 55%)",
        borderColor: "#3A1C22",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 420px" }}>
        <GcsBadge tone="accent" style={{ alignSelf: "flex-start" }}>
          {t("badge")}
        </GcsBadge>
        <h1 className="gcs-display" style={{ margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: ".02em" }}>
          {t("title", { site: siteName })}
        </h1>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 15, lineHeight: 1.6, maxWidth: 620 }}>{t("body")}</p>
      </div>
      {!actor.userId && (
        <GcsButton variant="primary" asChild>
          <Link href="/register">{t("cta")}</Link>
        </GcsButton>
      )}
    </GcsCard>
  );
}
