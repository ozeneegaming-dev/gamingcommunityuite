import "server-only";
import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { GcsLegendProBlock } from "@/app/(site)/_components/groups-pro/GcsLegendProView";
import { legendGroupCount, legendProCards } from "@/app/(site)/_components/groups-pro/legend-cards";
import { registerGroupLegend, type GcsLegendContext } from "./group-legend";
import { pillT } from "./group-pills";
import { services } from "./services";

/**
 * Legenda Grupuri Pro (aplicația premium), înregistrată în registrul legendei: în panoul de statistici înlocuiește tot
 * blocul (antetul „Legenda grupurilor” cu butonul de informații, numărul de grupuri și „Vezi toate grupurile”, apoi
 * cardurile categoriilor); în widget-ul separat doar cardurile și butonul (widget-ul are titlul lui). Coloanele,
 * numărătorile, grupurile goale și butonul urmează opțiunile din ACP → Membri → Legenda grupurilor.
 */
async function GcsLegendPro({ place, headingId }: GcsLegendContext) {
  const { groupsPro, groupDirectory } = services();
  const [legend, display, counts, t, tc, tp] = await Promise.all([
    groupsPro.legend(),
    groupsPro.display(),
    groupDirectory.counts(),
    getTranslations("groupsPro.legend"),
    getTranslations("groupsPro.category"),
    getTranslations("groups.pill"),
  ]);
  if (legend.length === 0) return null;
  const cards = legendProCards(legend, {
    categoryLabel: (c) => c.label || (tc.has(c.key as never) ? tc(c.key as never) : c.key),
    total: (count) => t("categoryTotal", { count }),
    linkedTotal: (count) => t("linkedTotal", { count }),
    pill: pillT(tp),
    counts,
    groupIcon: (name) => <GcsIcon name={name ?? "fa-solid fa-users"} />,
    categoryIcon: (name) => <GcsIcon name={name} />,
  });
  return (
    <GcsLegendProBlock
      place={place}
      {...(headingId ? { headingId } : {})}
      cards={cards}
      columns={display.columns}
      counts={{ members: display.memberCounts, online: display.onlineCounts }}
      seeAll={display.seeAll && display.groupsPage}
      labels={{
        title: t("title"),
        info: t("info"),
        groups: t("groups", { count: legendGroupCount(legend) }),
        seeAll: t("seeAll"),
        seeAllTip: t("seeAllTip"),
        linked: t("linked"),
        toggle: t("toggle", { name: "{name}" }),
      }}
    />
  );
}

registerGroupLegend("groups_pro", (ctx) => GcsLegendPro(ctx));
