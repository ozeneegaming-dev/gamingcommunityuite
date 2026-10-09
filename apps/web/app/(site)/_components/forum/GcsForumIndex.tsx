import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsWidgetPage } from "../widgets/GcsWidgetPage";
import { GcsCategoryCard } from "./GcsCategoryCard";

/**
 * Indexul forumului (macheta Main): categoriile cu forumurile, iar în jur widget-urile paginii (anunțul, shoutbox-ul,
 * statisticile, „Cine e online”…), aranjate de admin din „Editează pagina”. Pe `/` sau, când aplicația de pornire e alta,
 * pe `/forum`.
 */
export async function GcsForumIndex() {
  const t = await getTranslations("forum");
  const categories = await services().forumQueries.index(await currentActor());
  return (
    <GcsWidgetPage page="index">
      <div className="gcs-forumIndex" data-testid="gcs-forum-index">
        {categories.length === 0 ? (
          <GcsCard style={{ padding: 24, color: "var(--gcs-muted)" }}>
            <GcsIcon name="fa-regular fa-folder-open" className="gcs-emptyIcon" />
            {t("emptyForums")}
          </GcsCard>
        ) : (
          categories.map((c) => <GcsCategoryCard key={c.id} category={c} />)
        )}
      </div>
    </GcsWidgetPage>
  );
}
