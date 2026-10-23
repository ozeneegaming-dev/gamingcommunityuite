import type { GcsForumSlotBundle, GcsIndexCategory, GcsSlotNodeRef } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumListSlots, GcsSlotStyles } from "@/lib/forum-slots";
import { services } from "@/lib/services";
import { GcsWidgetPage } from "../widgets/GcsWidgetPage";
import { GcsCategoryCard } from "./GcsCategoryCard";

/** Nodurile indexului (categoriile și forumurile lor) pentru sloturile extensiilor. */
export function indexSlotNodes(categories: GcsIndexCategory[]): GcsSlotNodeRef[] {
  return categories.flatMap((c) => [
    { id: c.id, type: "CATEGORY" as const, parentId: null, name: c.name, slug: c.slug },
    ...c.forums.map((f) => ({ id: f.id, type: f.type, parentId: c.id, name: f.name, slug: f.slug })),
  ]);
}

/** Pluginurile care au pus ceva într-o listă de sloturi (foile lor de stil intră în pagină). */
export const slotPlugins = (bundles: Map<number, GcsForumSlotBundle>) => [...new Set([...bundles.values()].flatMap((b) => b.plugins))];

/**
 * Indexul forumului (macheta Main): categoriile cu forumurile, iar în jur widget-urile paginii (anunțul, shoutbox-ul,
 * statisticile, „Cine e online”…), aranjate de admin din „Editează pagina”. Pe `/` sau, când aplicația de pornire e alta,
 * pe `/forum`. Extensiile (Forum v2) își pun conținutul și stilul în rânduri și în benzile categoriilor.
 */
export async function GcsForumIndex() {
  const t = await getTranslations("forum");
  const categories = await services().forumQueries.index(await currentActor());
  const slots = await forumListSlots("index", indexSlotNodes(categories));
  return (
    <GcsWidgetPage page="index">
      <GcsSlotStyles plugins={slotPlugins(slots)} />
      <div className="gcs-forumIndex" data-testid="gcs-forum-index">
        {categories.length === 0 ? (
          <GcsCard style={{ padding: 24, color: "var(--gcs-muted)" }}>
            <GcsIcon name="fa-regular fa-folder-open" className="gcs-emptyIcon" />
            {t("emptyForums")}
          </GcsCard>
        ) : (
          categories.map((c) => <GcsCategoryCard key={c.id} category={c} slots={slots} />)
        )}
      </div>
    </GcsWidgetPage>
  );
}
