import type { GcsStatTileView } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.stats"))("title") };
}

/** Culoarea unei plăci (doar un hex valid, ca stilul inline să nu primească altceva). */
const tone = (color: string | undefined): CSSProperties | undefined => (color && /^#[0-9a-f]{6}$/i.test(color) ? ({ "--gcs-tile": color } as CSSProperties) : undefined);

/**
 * ACP → Statistici → Prezentare generală (specul 2026-10-09-acp-navigatie-aplicatii §1.2): cifrele de acum ale fiecărei
 * aplicații active (plăcile din `GcsModule.stats`), grupate pe aplicație. Rapoartele pe perioade sunt paginile
 * `/admin/stats/<raport>` din aceeași zonă (graficul, comparația cu perioada anterioară, topurile, CSV).
 */
export default async function AcpStatsOverviewPage() {
  await requireAcpSection("stats.overview");
  const { stats, registry } = services();
  const [t, tAll, format, tiles] = await Promise.all([getTranslations("acp.stats"), getTranslations(), getFormatter(), stats.tiles()]);
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);

  const byModule = new Map<string, GcsStatTileView[]>();
  for (const tile of tiles) byModule.set(tile.module, [...(byModule.get(tile.module) ?? []), tile]);
  const appName = (module: string) => {
    const app = registry.module(module)?.app;
    return app ? label(app.labelKey) : label(`acp.stats.modules.${module}`);
  };
  const appIcon = (module: string) => registry.module(module)?.app?.icon ?? "fa-solid fa-comments";

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-chart-pie" description={t("description")}>
        {t("title")}
      </GcsAcpTitle>
      {byModule.size === 0 ? (
        <GcsCard style={{ padding: 24 }}>
          <p className="gcs-acpList__empty">
            <GcsIcon name="fa-solid fa-chart-pie" /> {t("empty")}
          </p>
        </GcsCard>
      ) : (
        <div className="gcs-acpStats" data-testid="gcs-acp-stats">
          {[...byModule].map(([module, list]) => (
            <GcsCard key={module} as="section" aria-labelledby={`gcs-stats-${module}`} data-testid={`gcs-acp-stats-${module}`}>
              <div className="gcs-acpWidget__header">
                <h2 id={`gcs-stats-${module}`} className="gcs-acpWidget__title">
                  <GcsAcpTitleIcon name={appIcon(module)} />
                  {appName(module)}
                </h2>
              </div>
              <ul className="gcs-acpTiles">
                {list.map((tile) => {
                  const body = (
                    <>
                      <span className="gcs-acpTile__icon" aria-hidden="true">
                        <GcsIcon name={tile.icon} />
                      </span>
                      <span className="gcs-acpTile__value gcs-display">{format.number(tile.value)}</span>
                      <span className="gcs-acpTile__label">{label(tile.labelKey)}</span>
                    </>
                  );
                  return (
                    <li key={tile.key} className="gcs-acpTile" style={tone(tile.color)} data-tile={tile.key}>
                      {tile.href ? (
                        <Link href={tile.href} className="gcs-acpTile__inner">
                          {body}
                        </Link>
                      ) : (
                        <div className="gcs-acpTile__inner">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </GcsCard>
          ))}
        </div>
      )}
    </>
  );
}
