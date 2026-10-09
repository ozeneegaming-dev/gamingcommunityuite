import "server-only";
import type { GcsLegendGroup } from "@gcs/modules";
import type { ReactNode } from "react";
import { services } from "./services";

/**
 * Registrul legendei grupurilor (panoul de statistici și widget-ul „Legenda grupurilor”): pachetul standard are legenda
 * simplă (pastilele); o aplicație activă (ex. Grupuri Pro, premium) își înregistrează aici legenda ei, iar panoul o
 * folosește fără să știe de aplicație. Primul renderer al unei aplicații active câștigă.
 */
export type GcsLegendContext = { groups: GcsLegendGroup[]; place: "panel" | "widget" };
type Renderer = (ctx: GcsLegendContext) => Promise<ReactNode | null>;

const renderers: { app: string; render: Renderer }[] = [];

export function registerGroupLegend(app: string, render: Renderer): void {
  if (!renderers.some((r) => r.app === app)) renderers.push({ app, render });
}

/** Legenda unei aplicații active, sau `null` (legenda simplă). */
export async function renderGroupLegend(ctx: GcsLegendContext): Promise<ReactNode | null> {
  for (const r of renderers) {
    const on = await services()
      .apps.enabled(r.app)
      .catch(() => false);
    if (on) return r.render(ctx);
  }
  return null;
}