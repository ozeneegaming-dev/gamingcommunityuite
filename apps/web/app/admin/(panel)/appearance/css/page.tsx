import { CSS_ACP_SECTION } from "@gcs/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { THEME_PREVIEW_PARAM } from "@/lib/theme-preview";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsCssEditor } from "../_components/GcsCssEditor";
import { GcsThemePicker } from "../_components/GcsThemePicker";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.cssEditor"))("title") };
}

/**
 * ACP → Aspect → CSS (specul etapei 6, §3.3): fișierele CSS ale fiecărei teme (creare, redenumire, ștergere,
 * ordine), editorul de cod, previzualizarea live a site-ului cu CSS-ul nesalvat și istoricul fiecărui fișier.
 */
export default async function AcpCssPage({ searchParams }: { searchParams: Promise<{ theme?: string; file?: string }> }) {
  const panel = await requireAcpSection(CSS_ACP_SECTION);
  const [t, sp] = await Promise.all([getTranslations("acp.cssEditor"), searchParams]);
  const { themes, themeCss, acp } = services();
  const all = await themes.list();
  const theme = (sp.theme ? all.find((x) => x.key === sp.theme) : null) ?? all.find((x) => x.isDefault) ?? all[0];
  if (!theme) notFound();
  const [files, canEdit, canDelete] = await Promise.all([
    themeCss.files(theme.key),
    acp.can(panel.actor, CSS_ACP_SECTION, "edit"),
    acp.can(panel.actor, CSS_ACP_SECTION, "delete"),
  ]);
  const selected = files.find((f) => String(f.id) === sp.file) ?? files[0] ?? null;
  const history = selected ? await themeCss.history(theme.key, selected.id) : { versions: [], original: null };
  return (
    <>
      <GcsAcpTitle icon="fa-brands fa-css3-alt" description={t("hint")} actions={<GcsThemePicker themes={all.map((x) => ({ key: x.key, name: x.name }))} current={theme.key} />}>
        {t("title")}
      </GcsAcpTitle>
      <GcsCssEditor
        key={`${theme.key}:${selected?.id ?? 0}`}
        themeKey={theme.key}
        settings={theme.settings}
        files={files}
        selectedId={selected?.id ?? null}
        history={history}
        canEdit={canEdit}
        canDelete={canDelete}
        previewBase={`?${THEME_PREVIEW_PARAM}=${encodeURIComponent(theme.key)}`}
      />
    </>
  );
}
