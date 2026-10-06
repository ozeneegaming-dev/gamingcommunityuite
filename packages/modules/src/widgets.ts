import { fieldsConfig, type GcsWidgetDef, type GcsWidgetField } from "@gcs/core";
import { isGcsIcon } from "@gcs/ui/icon-registry";

const ALL_ZONES = ["top", "bottom", "sidebar"] as const;
const limitField = (max = 20): GcsWidgetField => ({ key: "limit", labelKey: "widgets.fields.limit", type: "number", min: 1, max });
/** Iconița din titlul widget-ului, pe amplasare (gol = iconița widget-ului); validată cu registrul Font Awesome. */
const iconField: GcsWidgetField = { key: "icon", labelKey: "widgets.fields.icon", type: "text", maxLength: 80 };

/**
 * Un widget cu config validat din câmpuri (vezi `fieldsConfig`). Implicit primește și câmpul `icon` (iconița din
 * titlu, suprascrisă pe amplasare); `iconOverride: false` îl omite (widget-urile fără titlu de card).
 */
export function widget(def: Omit<GcsWidgetDef, "config" | "zones"> & { zones?: GcsWidgetDef["zones"]; iconOverride?: boolean }): GcsWidgetDef {
  const { iconOverride = true, ...rest } = def;
  const fields = [...(rest.fields ?? []), ...(iconOverride ? [iconField] : [])];
  const defaultConfig = iconOverride ? { ...rest.defaultConfig, icon: "" } : rest.defaultConfig;
  const base = fieldsConfig(fields, defaultConfig);
  const config = iconOverride
    ? (raw: unknown) => {
        const out = base(raw);
        if (!out) return null;
        const icon = typeof out.icon === "string" ? out.icon.trim() : "";
        if (icon && !isGcsIcon(icon)) return null;
        return { ...out, icon };
      }
    : base;
  return { zones: ALL_ZONES, ...rest, fields, defaultConfig, config };
}

/** Widget-urile de bază ale nucleului: anunțul, „Cine e online” și membrii noi. */
export const coreWidgets: GcsWidgetDef[] = [
  widget({
    key: "core.announcement",
    labelKey: "widgets.core.announcement",
    icon: "fa-solid fa-bullhorn",
    // Titlul și textul goale = mesajul de bun venit implicit (tradus).
    defaultConfig: { title: "", body: "" },
    fields: [
      { key: "title", labelKey: "widgets.fields.title", type: "text", maxLength: 120 },
      { key: "body", labelKey: "widgets.fields.body", type: "textarea", maxLength: 5000 },
    ],
  }),
  widget({ key: "core.online", labelKey: "widgets.core.online", icon: "fa-solid fa-signal", defaultConfig: {} }),
  widget({ key: "core.statsPanel", labelKey: "widgets.core.statsPanel", icon: "fa-solid fa-rocket", zones: ["top", "bottom"], defaultConfig: {} }),
  widget({ key: "core.onlineDay", labelKey: "widgets.core.onlineDay", icon: "fa-solid fa-clock", defaultConfig: {} }),
  widget({ key: "core.groupLegend", labelKey: "widgets.core.groupLegend", icon: "fa-solid fa-users-rectangle", defaultConfig: {} }),
  widget({ key: "core.newMembers", labelKey: "widgets.core.newMembers", icon: "fa-solid fa-user-plus", defaultConfig: { limit: 5 }, fields: [limitField()] }),
];

/** Widget-urile forumurilor. */
export const forumWidgets: GcsWidgetDef[] = [
  widget({ key: "forums.stats", labelKey: "widgets.forums.stats", icon: "fa-solid fa-chart-simple", defaultConfig: {} }),
  widget({ key: "forums.recentTopics", labelKey: "widgets.forums.recentTopics", icon: "fa-solid fa-clock-rotate-left", defaultConfig: { limit: 6 }, fields: [limitField()] }),
  widget({ key: "forums.recentPosts", labelKey: "widgets.forums.recentPosts", icon: "fa-solid fa-comment", defaultConfig: { limit: 5 }, fields: [limitField()] }),
  widget({
    key: "forums.topPosters",
    labelKey: "widgets.forums.topPosters",
    icon: "fa-solid fa-trophy",
    defaultConfig: { period: "month", limit: 5 },
    fields: [
      {
        key: "period",
        labelKey: "widgets.fields.period",
        type: "select",
        options: [
          { value: "week", labelKey: "widgets.periods.week" },
          { value: "month", labelKey: "widgets.periods.month" },
          { value: "all", labelKey: "widgets.periods.all" },
        ],
      },
      limitField(),
    ],
  }),
  widget({ key: "forums.featuredTopics", labelKey: "widgets.forums.featuredTopics", icon: "fa-solid fa-star", defaultConfig: { limit: 5 }, fields: [limitField()] }),
];

/** Shoutbox-ul: o cameră de chat aleasă (gol = primul canal marcat „pe pagina principală”). */
export const chatWidgets: GcsWidgetDef[] = [
  widget({
    key: "chat.shoutbox",
    labelKey: "widgets.chat.shoutbox",
    icon: "fa-solid fa-comment-dots",
    // Shoutbox-ul își randează singur antetul (camera de chat), fără titlul comun al widget-urilor.
    iconOverride: false,
    defaultConfig: { channel: "" },
    fields: [{ key: "channel", labelKey: "widgets.fields.channel", type: "select", optionsFrom: "chat.channels" }],
  }),
];
