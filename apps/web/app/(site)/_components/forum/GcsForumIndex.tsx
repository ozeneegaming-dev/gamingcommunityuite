import type { GcsForumSlotBundle, GcsIndexCategory, GcsSlotNodeRef } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumListSlots, GcsSlotStyles } from "@/lib/forum-slots";
import { services } from "@/lib/services";
import { FORUM_VIEW_COOKIE, FORUM_VIEWS } from "@/lib/view-cookies";
import { GcsWidgetPage } from "../widgets/GcsWidgetPage";
import { GcsCategoryCard } from "./GcsCategoryCard";
import { GcsViewToggle } from "./GcsViewToggle";

/** Nodurile indexului (categoriile și forumurile lor) pentru sloturile extensiilor. */
export function indexSlotNodes(categories: GcsIndexCategory[]): GcsSlotNodeRef[] {
  return categories.flatMap((c) => [
    { id: c.id, type: "CATEGORY" as const, parentId: null, name: c.name, slug: c.slug },
    ...c.forums.map((f) => ({ id: f.id, type: f.type, parentId: c.id, name: f.name, slug: f.slug, children: f.subforums.map((s) => ({ id: s.id, type: "FORUM" as const, name: s.name, slug: s.slug })) })),
  ]);
}

/** Pluginurile care au pus ceva într-o listă de sloturi (foile lor de stil intră în pagină). */
export const slotPlugins = (bundles: Map<number, GcsForumSlotBundle>) => [...new Set([...bundles.values()].flatMap((b) => b.plugins))];

/**
 * Indexul forumului (macheta Main): categoriile cu forumurile, iar în jur widget-urile paginii (anunțul, shoutbox-ul,
 * statisticile, „Cine e online”…), aranjate de admin din „Editează pagina”. Pe `/` sau, când aplicația de pornire e alta,
 * pe `/forum`. Extensiile (Forum v2) își pun conținutul și stilul în rânduri și în benzile categoriilor.
 * Vederea (Forum v2): forumurile pe rânduri sau în grilă, alegerea membrului (cookie), altfel cea implicită din setări.
 * În grilă, forumurile sunt carduri cu zona de imagine (din ACP sau din ultima postare, din cache).
 */
export async function GcsForumIndex() {
  const t = await getTranslations("forum");
  const { forumQueries, settings } = services();
  const [actor, defaultView, jar] = await Promise.all([currentActor(), settings.get<string>("forums.forum_view"), cookies()]);
  const chosen = jar.get(FORUM_VIEW_COOKIE)?.value;
  const view: (typeof FORUM_VIEWS)[number] = chosen === "rows" || chosen === "grid" ? chosen : defaultView === "grid" ? "grid" : "rows";
  const categories = await forumQueries.index(actor, { previews: view === "grid" });
  const slots = await forumListSlots("index", indexSlotNodes(categories));
  return (
    <GcsWidgetPage page="index">
      <GcsSlotStyles plugins={slotPlugins(slots)} />
      <div className="gcs-forumIndex" data-view={view} data-testid="gcs-forum-index">
        {categories.length > 0 && (
          <div className="gcs-forumIndex__tools">
            <GcsViewToggle cookie={FORUM_VIEW_COOKIE} value={view} options={FORUM_VIEWS} labels={{ rows: t("listViews.rows"), grid: t("listViews.grid") }} label={t("listViews.forumsLabel")} />
          </div>
        )}
        {categories.length === 0 ? (
          <GcsCard style={{ padding: 24, color: "var(--gcs-muted)" }}>
            <GcsIcon name="fa-regular fa-folder-open" className="gcs-emptyIcon" />
            {t("emptyForums")}
          </GcsCard>
        ) : (
          categories.map((c) => <GcsCategoryCard key={c.id} category={c} slots={slots} view={view} />)
        )}
      </div>
    </GcsWidgetPage>
  );
}
