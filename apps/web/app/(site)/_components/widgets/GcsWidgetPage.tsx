import { GCS_WIDGET_ZONES, type GcsActor, type GcsWidgetPage as GcsWidgetPageKey, type GcsWidgetPlacementView, type GcsWidgetZone } from "@gcs/core";
import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { Fragment, type ReactNode } from "react";
import { currentActor } from "@/lib/actor";
import { viewerEditing } from "@/lib/appearance";
import { services } from "@/lib/services";
import { GcsPageEditor, type GcsPageEditorItem } from "./GcsPageEditor";
import { WIDGET_RENDERERS } from "./registry";

/** Randează un widget; o eroare într-un widget nu strică pagina (widget-ul lipsește, eroarea ajunge în log). */
async function renderPlacement(p: GcsWidgetPlacementView, actor: GcsActor): Promise<ReactNode> {
  const render = WIDGET_RENDERERS[p.type];
  if (!render) return null;
  try {
    return await render({ id: String(p.id), config: p.config, actor });
  } catch (error) {
    console.error(`[GCS] widget ${p.type} (#${p.id}):`, error);
    return null;
  }
}

/**
 * O pagină cu zone de widget-uri (specul etapei 5): sus, coloana din dreapta și jos, în jurul conținutului paginii.
 * Vizitatorii văd widget-urile vizibile grupurilor lor; adminii în modul „Editează pagina” primesc editorul.
 */
export async function GcsWidgetPage({ page, children }: { page: GcsWidgetPageKey; children: ReactNode }) {
  const [actor, editing] = await Promise.all([currentActor(), viewerEditing()]);
  if (editing.pageEditing) return <GcsPageEditorHost page={page} actor={actor}>{children}</GcsPageEditorHost>;

  const layout = await services().widgets.layout(page, actor);
  const renderZone = async (zone: GcsWidgetZone) => {
    const nodes = await Promise.all(layout[zone].map((p) => renderPlacement(p, actor)));
    return layout[zone].map((p, i) => ({ id: p.id, node: nodes[i] as ReactNode })).filter((x) => x.node !== null && x.node !== undefined);
  };
  const [top, sidebar, bottom] = await Promise.all([renderZone("top"), renderZone("sidebar"), renderZone("bottom")]);
  const zone = (items: { id: number; node: ReactNode }[]) => items.map((x) => <Fragment key={x.id}>{x.node}</Fragment>);
  return (
    <div className="gcs-widgetPage" data-page={page}>
      {top.length > 0 && (
        <div className="gcs-widgetZone gcs-widgetZone--top" data-zone="top">
          {zone(top)}
        </div>
      )}
      <div className="gcs-forumLayout">
        <div className="gcs-forumLayout__main gcs-widgetPage__content">{children}</div>
        {sidebar.length > 0 && (
          <aside className="gcs-forumSidebar gcs-widgetZone--sidebar" data-zone="sidebar">
            {zone(sidebar)}
          </aside>
        )}
      </div>
      {bottom.length > 0 && (
        <div className="gcs-widgetZone gcs-widgetZone--bottom" data-zone="bottom">
          {zone(bottom)}
        </div>
      )}
    </div>
  );
}

/** Datele editorului: toate widget-urile paginii (cu previzualizarea randată pe server), catalogul și grupurile. */
async function GcsPageEditorHost({ page, actor, children }: { page: GcsWidgetPageKey; actor: GcsActor; children: ReactNode }) {
  const { widgets, registry, db, chatQueries, apps } = services();
  const [t, tAll, layout, catalog, groups, enabled] = await Promise.all([
    getTranslations("pageEditor"),
    getTranslations(),
    widgets.layout(page, actor, { all: true }),
    widgets.catalog(page),
    db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    apps.enabledFilter(),
  ]);
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);
  const placements = GCS_WIDGET_ZONES.flatMap((z) => layout[z]);
  const previews = await Promise.all(placements.map((p) => renderPlacement(p, actor)));
  const channels = enabled("chat") ? await chatQueries.channels(actor) : [];

  const initial = Object.fromEntries(GCS_WIDGET_ZONES.map((z) => [z, [] as GcsPageEditorItem[]])) as Record<GcsWidgetZone, GcsPageEditorItem[]>;
  placements.forEach((p, i) => {
    initial[p.zone].push({ uid: `p${p.id}`, type: p.type, config: p.config, groups: p.groups, preview: previews[i] ?? null });
  });

  return (
    <GcsPageEditor
      page={page}
      initial={initial}
      catalog={catalog.map((c) => {
        const def = registry.widgetDef(c.key)?.def;
        return {
          key: c.key,
          label: label(c.labelKey),
          icon: <GcsIcon name={c.icon} />,
          zones: c.zones,
          defaultConfig: c.defaultConfig,
          fields: (def?.fields ?? []).map((f) => ({
            ...f,
            label: label(f.labelKey),
            options:
              f.type !== "select"
                ? undefined
                : f.optionsFrom === "chat.channels"
                  ? [{ value: "", label: t("defaultChannel") }, ...channels.map((c) => ({ value: c.key, label: c.name }))]
                  : (f.options ?? []).map((o) => ({ value: o.value, label: label(o.labelKey) })),
          })),
        };
      })}
      groups={groups}
      pageLabel={t(`pages.${page}`)}
    >
      {children}
    </GcsPageEditor>
  );
}
