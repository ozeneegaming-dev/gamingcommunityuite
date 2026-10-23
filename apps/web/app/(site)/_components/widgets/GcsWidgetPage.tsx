import { GCS_RICH_FIELDS, GCS_WIDGET_ZONES, type GcsActor, type GcsWidgetPage as GcsWidgetPageKey, type GcsWidgetPlacementView, type GcsWidgetZone } from "@gcs/core";
import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { currentActor } from "@/lib/actor";
import { viewerEditing } from "@/lib/appearance";
import { services } from "@/lib/services";
import { GcsPageEditor, type GcsPageEditorField, type GcsPageEditorItem } from "./GcsPageEditor";
import { isPluginWidget, renderPluginWidget } from "./GcsPluginWidget";
import { WIDGET_RENDERERS } from "./registry";

/** Randează un widget; o eroare într-un widget nu strică pagina (widget-ul lipsește, eroarea ajunge în log). */
async function renderPlacement(p: GcsWidgetPlacementView, actor: GcsActor, page: GcsWidgetPageKey): Promise<ReactNode> {
  const render = WIDGET_RENDERERS[p.type];
  if (!render && !isPluginWidget(p.type)) return null;
  try {
    // Widget-urile pluginurilor (etapa 6) se randează prin gazda pluginurilor.
    if (!render) return await renderPluginWidget(p, actor, page);
    return await render({ id: String(p.id), config: p.config, actor });
  } catch (error) {
    console.error(`[GCS] widget ${p.type} (#${p.id}):`, error);
    return null;
  }
}

/** Un widget randat separat (în propriul `Suspense`): pagina nu așteaptă după el, iar o eroare îl ascunde doar pe el. */
async function GcsWidgetSlot({ placement, actor, page }: { placement: GcsWidgetPlacementView; actor: GcsActor; page: GcsWidgetPageKey }) {
  return <>{await renderPlacement(placement, actor, page)}</>;
}

/** Locul widget-ului cât timp se încarcă (aceeași lățime, o înălțime apropiată, ca pagina să nu sară). */
function GcsWidgetSkeleton({ zone }: { zone: GcsWidgetZone }) {
  return <div className={`gcs-card gcs-widgetSkeleton gcs-widgetSkeleton--${zone}`} aria-hidden="true" />;
}

type GcsLayout = Record<GcsWidgetZone, GcsWidgetPlacementView[]>;

/**
 * Chat Pro: pe pagina principală, membrul alege unde stă chat-ul (preferința „Poziție”): primul în zona de sus sau
 * ultimul în zona de jos. Doar pentru un chat pus de admin sus sau jos (coloana laterală rămâne cum e).
 */
async function arrangeChat(layout: GcsLayout, actor: GcsActor): Promise<GcsLayout> {
  const { chatPro } = services();
  if (!actor.userId || !(await chatPro.canUse(actor))) return layout;
  const { position } = await chatPro.prefs(actor.userId);
  if (position === "auto") return layout;
  const isChat = (p: GcsWidgetPlacementView) => p.type === "chat.shoutbox";
  const moving = [...layout.top.filter(isChat), ...layout.bottom.filter(isChat)];
  if (moving.length === 0) return layout;
  const top = layout.top.filter((p) => !isChat(p));
  const bottom = layout.bottom.filter((p) => !isChat(p));
  return { ...layout, top: position === "top" ? [...moving, ...top] : top, bottom: position === "bottom" ? [...bottom, ...moving] : bottom };
}

/**
 * O pagină cu zone de widget-uri (specul etapei 5): sus, coloana din dreapta și jos, în jurul conținutului paginii.
 * Vizitatorii văd widget-urile vizibile grupurilor lor; adminii în modul „Editează pagina” primesc editorul.
 * Conținutul paginii pleacă imediat spre browser; fiecare widget sosește separat (streaming), cu un loc rezervat.
 */
export async function GcsWidgetPage({ page, children }: { page: GcsWidgetPageKey; children: ReactNode }) {
  const [actor, editing] = await Promise.all([currentActor(), viewerEditing()]);
  if (editing.pageEditing) return <GcsPageEditorHost page={page} actor={actor}>{children}</GcsPageEditorHost>;

  const base = await services().widgets.layout(page, actor);
  const layout = page === "index" ? await arrangeChat(base, actor) : base;
  const zone = (z: GcsWidgetZone) =>
    layout[z].map((p) => (
      <Suspense key={p.id} fallback={<GcsWidgetSkeleton zone={z} />}>
        <GcsWidgetSlot placement={p} actor={actor} page={page} />
      </Suspense>
    ));
  return (
    <div className="gcs-widgetPage" data-page={page}>
      {layout.top.length > 0 && (
        <div className="gcs-widgetZone gcs-widgetZone--top" data-zone="top">
          {zone("top")}
        </div>
      )}
      <div className="gcs-forumLayout">
        <div className="gcs-forumLayout__main gcs-widgetPage__content">{children}</div>
        {layout.sidebar.length > 0 && (
          <aside className="gcs-forumSidebar gcs-widgetZone--sidebar" data-zone="sidebar">
            {zone("sidebar")}
          </aside>
        )}
      </div>
      {layout.bottom.length > 0 && (
        <div className="gcs-widgetZone gcs-widgetZone--bottom" data-zone="bottom">
          {zone("bottom")}
        </div>
      )}
    </div>
  );
}

/** Favoritele adminului din `users.prefs.widgetFavorites` (lista „Widget-uri disponibile”). */
async function widgetFavorites(userId: string | null): Promise<string[]> {
  if (!userId) return [];
  const user = await services().db.user.findUnique({ where: { id: userId }, select: { prefs: true } });
  const prefs = (user?.prefs && typeof user.prefs === "object" ? user.prefs : {}) as Record<string, unknown>;
  return Array.isArray(prefs.widgetFavorites) ? prefs.widgetFavorites.filter((k): k is string => typeof k === "string") : [];
}

/**
 * Datele editorului: toate widget-urile paginii (cu previzualizarea randată pe server), catalogul (cu categoria și
 * descrierea fiecărui widget), favoritele adminului și grupurile.
 */
async function GcsPageEditorHost({ page, actor, children }: { page: GcsWidgetPageKey; actor: GcsActor; children: ReactNode }) {
  const { widgets, registry, db, chatQueries, apps } = services();
  const [t, tAll, layout, catalog, groups, enabled, favorites] = await Promise.all([
    getTranslations("pageEditor"),
    getTranslations(),
    widgets.layout(page, actor, { all: true }),
    widgets.catalog(page),
    db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    apps.enabledFilter(),
    widgetFavorites(actor.userId),
  ]);
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);
  /** Categoria = modulul widget-ului (eticheta din `pageEditor.categories`, altfel numele aplicației sau cheia). */
  const category = (module: string) => {
    const key = `pageEditor.categories.${module}`;
    if (tAll.has(key)) return tAll(key);
    const app = registry.all().find((m) => m.key === module)?.app;
    return app ? label(app.labelKey) : module;
  };
  const placements = GCS_WIDGET_ZONES.flatMap((z) => layout[z]);
  const previews = await Promise.all(placements.map((p) => renderPlacement(p, actor, page)));
  const channels = enabled("chat") ? await chatQueries.channels(actor) : [];
  // „Obiectivul lunii”: obiectivele de donații (gol = primul activ vizibil).
  const goals = enabled("vip") ? await services().donations.goals() : [];

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
          description: c.descriptionKey ? label(c.descriptionKey) : "",
          category: c.module,
          categoryLabel: category(c.module),
          icon: <GcsIcon name={c.icon} />,
          zones: c.zones,
          defaultConfig: c.defaultConfig,
          fields: (def?.fields ?? []).map((f): GcsPageEditorField => {
            const base = { key: f.key, label: label(f.labelKey) };
            switch (f.type) {
              case "number":
                return { ...base, type: "number", min: f.min, max: f.max };
              case "text":
              case "textarea":
                return { ...base, type: f.type, maxLength: f.maxLength };
              // Textul formatat: editorul primește nodurile și mărcile profilului (aceleași pe care le verifică serverul).
              case "richtext":
                return { ...base, type: "richtext", maxLength: f.maxLength, allow: GCS_RICH_FIELDS[f.profile] };
              case "select":
                return {
                  ...base,
                  type: "select",
                  options:
                    f.optionsFrom === "chat.channels"
                      ? [{ value: "", label: t("defaultChannel") }, ...channels.map((c) => ({ value: c.key, label: c.name }))]
                      : f.optionsFrom === "donations.goals"
                        ? [{ value: "", label: t("defaultGoal") }, ...goals.map((g) => ({ value: String(g.id), label: g.title }))]
                        : (f.options ?? []).map((o) => ({ value: o.value, label: label(o.labelKey) })),
                };
            }
          }),
        };
      })}
      groups={groups}
      favorites={favorites}
      pageLabel={t(`pages.${page}`)}
    >
      {children}
    </GcsPageEditor>
  );
}
