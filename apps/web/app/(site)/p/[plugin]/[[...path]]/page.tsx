import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { cache } from "react";
import { currentActor } from "@/lib/actor";
import { pluginHost, pluginKeyParam, pluginQuery, safeModeActive } from "@/lib/plugins";

type Props = { params: Promise<{ plugin: string; path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Pagina pluginului, o singură dată per request (metadatele și pagina o folosesc amândouă). */
const renderPluginPage = cache(async (key: string, path: string, queryJson: string) => {
  const plugins = await pluginHost();
  const [actor, locale] = await Promise.all([currentActor(), getLocale()]);
  return plugins.renderPage(key, path, { actor, locale, query: JSON.parse(queryJson) as Record<string, string>, area: "site" });
});

async function load({ params, searchParams }: Props) {
  const { plugin, path } = await params;
  const key = pluginKeyParam(plugin);
  if (!key) notFound();
  if (await safeModeActive()) return { key, result: null };
  const query = JSON.stringify(pluginQuery(await searchParams));
  return { key, result: await renderPluginPage(key, `/${(path ?? []).map(decodeURIComponent).join("/")}`, query) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { result } = await load(props);
  return { title: result?.status === 200 ? result.title : undefined };
}

/**
 * `/p/<cheie>/…` (etapa 6): o pagină a unui plugin, randată pe server de plugin și trecută prin sanitizer, în layout-ul
 * site-ului. JS-ul pluginului se încarcă doar aici, și doar pentru pluginurile semnate.
 */
export default async function PluginSitePage(props: Props) {
  const { key, result } = await load(props);
  const t = await getTranslations("plugins.page");
  if (!result) {
    return (
      <GcsCard style={{ padding: 24 }} role="status" data-testid="gcs-plugin-safe-mode">
        <GcsIcon name="fa-solid fa-shield-halved" className="gcs-emptyIcon" />
        {t("safeMode")}
      </GcsCard>
    );
  }
  if (result.status === 404) notFound();
  if (result.status === 302) redirect(result.redirect);
  if (result.status !== 200) {
    return (
      <GcsCard style={{ padding: 24 }} role="alert" data-testid={result.status === 403 ? "gcs-plugin-forbidden" : "gcs-plugin-error"}>
        <GcsIcon name={result.status === 403 ? "fa-solid fa-lock" : "fa-solid fa-triangle-exclamation"} className="gcs-emptyIcon" />
        {result.status === 403 ? t("forbidden") : t("error")}
      </GcsCard>
    );
  }
  return (
    <>
      {result.styles.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="gcs-plugins" />
      ))}
      {result.scripts.map((src) => (
        <script key={src} src={src} async />
      ))}
      <header className="gcs-pageHeader">
        <h1 className="gcs-display gcs-pageHeader__title" data-testid="gcs-plugin-page-title">
          <GcsIcon name={result.icon} className="gcs-hIcon" />
          {result.title}
        </h1>
      </header>
      <GcsCard as="section" className="gcs-pluginPage" style={{ padding: 24 }} data-testid="gcs-plugin-page" data-plugin={key}>
        {/* HTML-ul pluginului, trecut prin sanitizer (listă albă) de gazda pluginurilor. */}
        <div dangerouslySetInnerHTML={{ __html: result.html }} />
      </GcsCard>
    </>
  );
}
