import "server-only";
import type { GcsLegendProGroup } from "@gcs/modules";
import { GcsTooltip } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { GcsLegendProView, type GcsLegendProCard, type GcsLegendProRow } from "@/app/(site)/_components/groups-pro/GcsLegendProView";
import { registerGroupLegend, type GcsLegendContext } from "./group-legend";
import { groupPillText } from "./group-pill-text";
import { pillT } from "./group-pills";
import { services } from "./services";

/**
 * Legenda Grupuri Pro (aplicația premium), înregistrată în registrul legendei: în panoul de statistici înlocuiește tot
 * blocul (antetul „Legenda grupurilor” cu butonul de informații, numărul de grupuri și „Vezi toate grupurile”, apoi
 * cardurile categoriilor); în widget-ul separat doar cardurile și butonul (widget-ul are titlul lui).
 */
async function GcsLegendPro({ place, headingId }: GcsLegendContext) {
  const [legend, t, tc, tp] = await Promise.all([
    services().groupsPro.legend(),
    getTranslations("groupsPro.legend"),
    getTranslations("groupsPro.category"),
    getTranslations("groups.pill"),
  ]);
  if (legend.length === 0) return null;
  const row = (g: Omit<GcsLegendProGroup, "children" | "childMembers">): GcsLegendProRow => {
    const text = groupPillText(g, g.count, pillT(tp));
    return {
      id: g.id,
      name: g.name,
      color: g.color,
      href: g.public ? `/members?group=${g.id}` : null,
      tooltip: text.tooltip,
      ariaLabel: text.ariaLabel,
      icon: <GcsIcon name={g.icon ?? "fa-solid fa-users"} />,
      members: g.count.members,
      online: g.count.online,
    };
  };
  const cards: GcsLegendProCard[] = legend.map((c) => ({
    key: c.key,
    label: c.label || (tc.has(c.key as never) ? tc(c.key as never) : c.key),
    total: t("categoryTotal", { count: c.members }),
    rows: c.groups.map((g) => ({ ...row(g), children: g.children.map(row), linkedTotal: t("linkedTotal", { count: g.childMembers }) })),
  }));
  const groupCount = legend.reduce((s, c) => s + c.groups.reduce((n, g) => n + 1 + g.children.length, 0), 0);
  const view = <GcsLegendProView cards={cards} labels={{ linked: t("linked"), toggle: t("toggle", { name: "{name}" }) }} />;
  const seeAll = (
    <GcsTooltip content={t("seeAllTip")}>
      <a href="/members/groups" className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-legendPro__seeAll" data-testid="gcs-legend-pro-all">
        {t("seeAll")}
        <GcsIcon name="fa-solid fa-chevron-right" />
      </a>
    </GcsTooltip>
  );
  if (place === "widget") {
    return (
      <div className="gcs-legendPro__widget">
        {view}
        <div className="gcs-legendPro__widgetFoot">{seeAll}</div>
      </div>
    );
  }
  return (
    <section className="gcs-legendBlock gcs-legendBlock--pro" aria-labelledby={headingId}>
      <div className="gcs-legendPro__head">
        <span className="gcs-legendPro__headIcon" aria-hidden="true">
          <GcsIcon name="fa-solid fa-users" />
        </span>
        <h3 id={headingId} className="gcs-legendPro__heading">
          {t("title")}
        </h3>
        <GcsTooltip content={t("info")}>
          <button type="button" className="gcs-legendPro__info" aria-label={t("info")}>
            <GcsIcon name="fa-solid fa-info" />
          </button>
        </GcsTooltip>
        <span className="gcs-legendPro__groupCount" data-testid="gcs-legend-pro-count">
          {t("groups", { count: groupCount })}
        </span>
        {seeAll}
      </div>
      {view}
    </section>
  );
}

registerGroupLegend("groups_pro", (ctx) => GcsLegendPro(ctx));
