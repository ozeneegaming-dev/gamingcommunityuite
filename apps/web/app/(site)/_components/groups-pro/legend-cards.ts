import type { GcsLegendCount, GcsLegendProCategory, GcsLegendProGroup } from "@gcs/modules/groups-pro-legend";
import type { ReactNode } from "react";
import { groupPillText, type GcsGroupPillT } from "@/lib/group-pill-text";
import type { GcsLegendProCard, GcsLegendProRow } from "./GcsLegendProView";

/** Ce trebuie pentru cardurile legendei Pro: textele traduse, numărătorile reale (tooltip-ul) și iconițele desenate. */
export type GcsLegendCardsContext = {
  categoryLabel: (c: { key: string; label: string }) => string;
  total: (members: number) => string;
  linkedTotal: (members: number) => string;
  pill: GcsGroupPillT;
  /** Numărătorile grupurilor (tooltip-ul pastilei arată mereu numărătorile reale, cu membrii secundari). */
  counts: ReadonlyMap<number, GcsLegendCount>;
  groupIcon: (name: string | null) => ReactNode;
  categoryIcon: (name: string | undefined) => ReactNode;
};

/**
 * Cardurile legendei Pro din legenda construită (`buildLegend`): pe server (panoul de statistici, widget-ul) și în
 * browser (previzualizarea live din ACP → Membri → Legenda grupurilor), cu același rezultat.
 */
export function legendProCards(legend: GcsLegendProCategory[], ctx: GcsLegendCardsContext): GcsLegendProCard[] {
  const row = (g: Omit<GcsLegendProGroup, "children" | "childMembers">): GcsLegendProRow => {
    const text = groupPillText(g, ctx.counts.get(g.id) ?? g.count, ctx.pill);
    return {
      id: g.id,
      name: g.name,
      color: g.color,
      href: g.public ? `/members?group=${g.id}` : null,
      tooltip: text.tooltip,
      ariaLabel: text.ariaLabel,
      icon: ctx.groupIcon(g.icon),
      members: g.count.members,
      online: g.count.online,
    };
  };
  return legend.map((c) => ({
    key: c.key,
    label: ctx.categoryLabel(c),
    total: ctx.total(c.members),
    icon: c.icon ? ctx.categoryIcon(c.icon) : undefined,
    rows: c.groups.map((g) => ({ ...row(g), children: g.children.map(row), linkedTotal: ctx.linkedTotal(g.childMembers) })),
  }));
}

/** Câte grupuri arată legenda (rândurile și grupurile legate). */
export const legendGroupCount = (legend: GcsLegendProCategory[]) => legend.reduce((s, c) => s + c.groups.reduce((n, g) => n + 1 + g.children.length, 0), 0);
