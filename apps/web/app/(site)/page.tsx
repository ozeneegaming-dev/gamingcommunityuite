import { GcsCard } from "@gcs/ui";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsCategoryCard } from "./_components/forum/GcsCategoryCard";
import { GcsWidgetPage } from "./_components/widgets/GcsWidgetPage";

/**
 * Pagina principală a forumului (macheta Main): categoriile cu forumurile, iar în jur widget-urile paginii (anunțul,
 * shoutbox-ul, statisticile, „Cine e online”…), aranjate de admin din „Editează pagina”.
 */
export default async function HomePage() {
  const t = await getTranslations("forum");
  const categories = await services().forumQueries.index(await currentActor());
  return (
    <GcsWidgetPage page="index">
      <div className="gcs-forumIndex" data-testid="gcs-forum-index">
        {categories.length === 0 ? (
          <GcsCard style={{ padding: 24, color: "var(--gcs-muted)" }}>{t("emptyForums")}</GcsCard>
        ) : (
          categories.map((c) => <GcsCategoryCard key={c.id} category={c} />)
        )}
      </div>
    </GcsWidgetPage>
  );
}
