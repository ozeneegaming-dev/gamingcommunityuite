import { GcsBadge, GcsButton, GcsCard } from "@gcs/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsCategoryCard } from "./_components/forum/GcsCategoryCard";
import { GcsForumSidebar } from "./_components/forum/GcsForumSidebar";

/** Pagina principală a forumului (macheta Main): anunțul, categoriile cu forumurile și coloana din dreapta. */
export default async function HomePage() {
  const t = await getTranslations("forum");
  const { settings, forumQueries } = services();
  const actor = await currentActor();
  const [siteName, categories, stats, recent] = await Promise.all([
    settings.get<string>("site.name"),
    forumQueries.index(actor),
    forumQueries.stats(),
    forumQueries.recentTopics(actor, 6),
  ]);

  return (
    <>
      <GcsCard as="section" className="gcs-announcement">
        <div className="gcs-announcement__text">
          <GcsBadge tone="accent" style={{ alignSelf: "flex-start" }}>
            {t("announcement.badge")}
          </GcsBadge>
          <h1 className="gcs-display gcs-announcement__title">{t("announcement.title", { site: siteName })}</h1>
          <p className="gcs-announcement__body">{t("announcement.body")}</p>
        </div>
        {!actor.userId && (
          <GcsButton variant="primary" asChild>
            <Link href="/register">{t("announcement.cta")}</Link>
          </GcsButton>
        )}
      </GcsCard>

      <div className="gcs-forumLayout">
        <div className="gcs-forumLayout__main" data-testid="gcs-forum-index">
          {categories.length === 0 ? (
            <GcsCard style={{ padding: 24, color: "var(--gcs-muted)" }}>{t("emptyForums")}</GcsCard>
          ) : (
            categories.map((c) => <GcsCategoryCard key={c.id} category={c} />)
          )}
        </div>
        <GcsForumSidebar stats={stats} recent={recent} />
      </div>
    </>
  );
}
