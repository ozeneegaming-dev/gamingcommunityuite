import { TEMPLATE_FILTERS, TEMPLATE_GROUP_ICONS, TEMPLATE_GROUPS, TEMPLATE_TAGS, TEMPLATES_ACP_SECTION, type GcsTemplateText } from "@gcs/core";
import { resolveIcon } from "@gcs/ui/icon-registry";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { THEME_PREVIEW_PARAM } from "@/lib/theme-preview";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsTemplateEditor, type GcsTemplateTreeItem } from "../_components/GcsTemplateEditor";
import { GcsThemePicker } from "../_components/GcsThemePicker";

/** Iconița Font Awesome rezolvată pe server (componenta client primește doar datele SVG). */
function iconDef(name: string) {
  const def = resolveIcon(name);
  return def ? { prefix: def.prefix, iconName: def.iconName, icon: def.icon } : null;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.templatesEditor"))("title") };
}

/**
 * ACP → Aspect → Șabloane (specul etapei 6, §3.3): arborele șabloanelor pe zone (cu căutare și marcajele „modificat”
 * / „necesită revizuire”), editorul de cod cu variabilele disponibile, previzualizarea pe date reale și istoricul.
 */
export default async function AcpTemplatesPage({ searchParams }: { searchParams: Promise<{ theme?: string; template?: string }> }) {
  const panel = await requireAcpSection(TEMPLATES_ACP_SECTION);
  const [t, sp, locale] = await Promise.all([getTranslations("acp.templatesEditor"), searchParams, getLocale()]);
  const text = (v: GcsTemplateText) => (locale === "ro" ? v.ro : v.en);
  const { themes, templates, acp } = services();
  const all = await themes.list();
  const theme = (sp.theme ? all.find((x) => x.key === sp.theme) : null) ?? all.find((x) => x.isDefault) ?? all[0];
  if (!theme) notFound();
  const [tree, canEdit] = await Promise.all([templates.tree(theme.key), acp.can(panel.actor, TEMPLATES_ACP_SECTION, "edit")]);
  const selectedKey = tree.find((e) => e.def.key === sp.template)?.def.key ?? tree[0]!.def.key;
  const detail = await templates.detail(theme.key, selectedKey);
  const items: GcsTemplateTreeItem[] = tree.map((e) => ({
    key: e.def.key,
    group: e.def.group,
    icon: iconDef(e.def.icon),
    title: text(e.def.title),
    status: e.status,
    partial: e.def.partial,
  }));
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-file-code" description={t("hint")} actions={<GcsThemePicker themes={all.map((x) => ({ key: x.key, name: x.name }))} current={theme.key} />}>
        {t("title")}
      </GcsAcpTitle>
      <GcsTemplateEditor
        key={`${theme.key}:${selectedKey}`}
        themeKey={theme.key}
        items={items}
        groups={TEMPLATE_GROUPS.map((g) => ({ key: g, icon: iconDef(TEMPLATE_GROUP_ICONS[g]), label: t(`groups.${g}`) }))}
        template={{
          key: detail.def.key,
          title: text(detail.def.title),
          description: text(detail.def.description),
          mode: detail.def.mode,
          partial: detail.def.partial,
          defaultSource: detail.def.source,
          variables: detail.def.variables.map((v) => ({ name: v.name, type: v.type, text: text(v.text) })),
          slots: detail.def.slots.map((s) => ({ name: s.name, required: s.required, text: text(s.text) })),
        }}
        detail={{ status: detail.status, override: detail.override, versions: detail.versions }}
        completions={{ tags: [...TEMPLATE_TAGS], filters: [...TEMPLATE_FILTERS] }}
        canEdit={canEdit}
        previewUrl={`/admin/template-preview?${THEME_PREVIEW_PARAM}=${encodeURIComponent(theme.key)}`}
      />
    </>
  );
}
