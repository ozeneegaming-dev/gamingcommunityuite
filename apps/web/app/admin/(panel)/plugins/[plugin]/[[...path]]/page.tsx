import { pluginAcpSection } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { cache } from "react";
import { requireAcpSection } from "@/lib/acp";
import { pluginHost, pluginKeyParam, pluginQuery, safeModeActive } from "@/lib/plugins";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";

type Props = { params: Promise<{ plugin: string; path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const renderAcpPage = cache(async (key: string, path: string, queryJson: string) => {
  const panel = await requireAcpSection(pluginAcpSection(key));
  const plugins = await pluginHost();
  return plugins.renderPage(key, path, { actor: panel.actor, locale: await getLocale(), query: JSON.parse(queryJson) as Record<string, string>, area: "acp" });
});

async function load({ params, searchParams }: Props) {
  const { plugin, path } = await params;
  const key = pluginKeyParam(plugin);
  if (!key) notFound();
  // Modul sigur (spec §3.5): codul și CSS-ul pluginului nu rulează nici în ACP; dreptul ACP se verifică totuși.
  if (await safeModeActive()) {
    await requireAcpSection(pluginAcpSection(key));
    return { key, result: null };
  }
  return { key, result: await renderAcpPage(key, `/${(path ?? []).map(decodeURIComponent).join("/")}`, JSON.stringify(pluginQuery(await searchParams))) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { result } = await load(props);
  return { title: result?.status === 200 ? result.title : undefined };
}

/**
 * `/admin/plugins/<cheie>/…` (etapa 6): paginile ACP ale unui plugin, cu dreptul ACP `plugin.<cheie>` (rolurile ACP).
 * Doar HTML sanitizat, fără scripturi; formularele trimit doar spre rutele API ale pluginului (cele ACP cer poarta ACP).
 */
export default async function AcpPluginPage(props: Props) {
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
      <GcsCard style={{ padding: 24 }} role="alert" data-testid="gcs-acp-plugin-error">
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
      <GcsAcpTitle icon={result.icon}>{result.title}</GcsAcpTitle>
      <GcsCard as="section" className="gcs-pluginPage" style={{ padding: 20 }} data-testid="gcs-acp-plugin-page" data-plugin={key}>
        {/* HTML-ul pluginului, trecut prin sanitizer (listă albă) de gazda pluginurilor. */}
        <div dangerouslySetInnerHTML={{ __html: result.html }} />
      </GcsCard>
    </>
  );
}
