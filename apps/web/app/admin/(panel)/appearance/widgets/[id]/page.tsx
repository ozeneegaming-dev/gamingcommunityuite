import { DEFAULT_THEME_TOGGLE, WIDGETS_ACP_SECTION } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { forumExtOptions } from "@/lib/forum-ext-options";
import { safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsAspectPreview } from "../../../_components/GcsAspectPreview";
import { GcsExtFields } from "../../../_components/GcsExtFields";
import { saveWidgetAspect } from "./actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.aspect"))("widget.title") };
}

type Translate = Awaited<ReturnType<typeof getTranslations>>;
const label = (t: Translate, key: string) => (t.has(key as never) ? t(key as never) : key);

/**
 * Aspectul unui widget (Aspect forumuri; ACP → Aspect → Widget-uri → widget): taburile contribuite de extensii (ex.
 * „Aspect”: iconița, titlul colorat, eticheta, fundalul cu voal), salvate în amplasare, cu previzualizarea live.
 */
export default async function AcpWidgetAspectPage({ params, searchParams }: Props) {
  await requireAcpSection(WIDGETS_ACP_SECTION);
  const id = Number((await params).id);
  const { widgets, registry } = services();
  const placement = Number.isSafeInteger(id) ? await widgets.placement(id) : null;
  if (!placement) notFound();
  const [t, tp, tAll] = await Promise.all([getTranslations("acp.aspect"), getTranslations("pageEditor"), getTranslations()]);
  const plugins = !(await safeModeActive());
  const tabs = await widgets.editTabs(placement.config, { plugins });
  const sp = await searchParams;
  const view = tabs.find((x) => `${x.extension}:${x.tab.key}` === sp.tab) ?? tabs[0];
  const def = registry.widgetDef(placement.type)?.def;
  const name = def ? label(tAll, def.labelKey) : placement.type;

  return (
    <>
      <GcsAcpTitle icon={def && isGcsIcon(def.icon) ? def.icon : "fa-solid fa-table-cells-large"}>{t("widget.heading", { name })}</GcsAcpTitle>
      <p style={{ margin: 0, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link href="/admin/appearance/widgets" className="gcs-acpBack">
          <GcsIcon name="fa-solid fa-arrow-left" />
          {t("widget.back")}
        </Link>
        <span className="gcs-muted">
          {tp(`pages.${placement.page}`)} · {tp(`zones.${placement.zone}`)}
        </span>
      </p>
      {!view ? (
        <GcsCard style={{ padding: 16 }}>
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("widget.none")}
          </p>
        </GcsCard>
      ) : (
        <>
          {tabs.length > 1 && (
            <nav className="gcs-tabs gcs-forumTabs" aria-label={t("widget.title")}>
              {tabs.map((x) => (
                <Link
                  key={`${x.extension}:${x.tab.key}`}
                  href={`/admin/appearance/widgets/${placement.id}?tab=${encodeURIComponent(`${x.extension}:${x.tab.key}`)}`}
                  className={`gcs-tab${x === view ? " gcs-tab--active" : ""}`}
                  aria-current={x === view ? "page" : undefined}
                >
                  <GcsIcon name={isGcsIcon(x.tab.icon) ? x.tab.icon : "fa-solid fa-puzzle-piece"} className="gcs-tab__icon" /> {label(tAll, x.tab.labelKey)}
                </Link>
              ))}
            </nav>
          )}
          <GcsCard as="section" aria-label={label(tAll, view.tab.labelKey)} style={{ padding: 16, maxWidth: 760 }} data-testid={`gcs-widget-ext-${view.extension}-${view.tab.key}`} data-aspect-card="">
            {view.tab.descriptionKey && <p className="gcs-muted" style={{ marginTop: 0 }}>{label(tAll, view.tab.descriptionKey)}</p>}
            <GcsActionForm action={saveWidgetAspect.bind(null, placement.id, view.extension, view.tab.key)} submitLabel={t("widget.save")} submitKind="save">
              <GcsExtFields fields={view.tab.fields ?? []} values={view.values} options={await forumExtOptions(view.tab.fields ?? [])} upload={{ scope: "widget", id: placement.id, extension: view.extension, tab: view.tab.key }} />
            </GcsActionForm>
            <GcsAspectPreview
              base={`/aspect-preview?scope=widget&id=${placement.id}&ext=${encodeURIComponent(view.extension)}&tab=${encodeURIComponent(view.tab.key)}`}
              themes={{ dark: DEFAULT_THEME_TOGGLE.dark, light: DEFAULT_THEME_TOGGLE.light }}
              labels={{ title: t("preview.title"), dark: t("preview.dark"), light: t("preview.light"), unread: t("preview.unread"), hint: t("preview.hint") }}
            />
          </GcsCard>
        </>
      )}
    </>
  );
}
