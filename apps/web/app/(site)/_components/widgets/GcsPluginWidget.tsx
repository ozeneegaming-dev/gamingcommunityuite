import type { GcsActor, GcsWidgetPlacementView } from "@gcs/core";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { pluginHost, safeModeActive } from "@/lib/plugins";
import { GcsWidgetTitle, widgetIcon } from "./GcsWidgetTitle";

/** Tipurile de widget ale pluginurilor: `plugin.<vendor>.<nume>.<widget>`. */
export const isPluginWidget = (type: string) => type.startsWith("plugin.");

/**
 * Un widget de plugin (etapa 6): HTML-ul randat de plugin pe server, deja sanitizat și închis în containerul pluginului,
 * în cardul comun al widget-urilor (titlul și iconița din manifest). CSS-ul pluginului se încarcă doar unde apare.
 * În modul sigur (Root Admin, `?safe=1`) sau dacă pluginul nu răspunde, widget-ul lipsește.
 */
export async function renderPluginWidget(p: GcsWidgetPlacementView, actor: GcsActor, page: string): Promise<ReactNode> {
  if (await safeModeActive()) return null;
  const [plugins, locale] = await Promise.all([pluginHost(), getLocale()]);
  const out = await plugins.renderWidget(p.type, { config: p.config, actor, locale, page, zone: p.zone });
  if (!out?.html) return null;
  const headingId = `gcs-widget-${p.id}`;
  return (
    <section className="gcs-card gcs-sideCard gcs-widget gcs-pluginWidget" aria-labelledby={headingId} data-widget={p.type} data-testid="gcs-plugin-widget">
      {out.styles.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="gcs-plugins" />
      ))}
      <GcsWidgetTitle id={headingId} icon={widgetIcon(p.type, p.config)}>
        {plugins.widgetTitle(p.type, locale) ?? p.type}
      </GcsWidgetTitle>
      {/* HTML-ul pluginului, trecut prin sanitizer (listă albă) de gazda pluginurilor. */}
      <div className="gcs-pluginWidget__body" dangerouslySetInnerHTML={{ __html: out.html }} />
    </section>
  );
}
