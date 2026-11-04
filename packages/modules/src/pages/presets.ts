import type { GcsPagesFieldType } from "./fields";

/**
 * Șabloanele gata ale bazelor de date (specul 2026-11-03-pagini §3.2). Textele (numele, câmpurile, opțiunile,
 * categoriile) sunt chei de traducere `pages.presets.<șablon>.*`: site-ul le traduce în limba lui la creare, iar
 * adminul le poate schimba apoi ca pe orice bază de date.
 */
export const PAGES_PRESETS = ["guides", "rules", "configs", "recruitment", "blank"] as const;
export type GcsPagesPreset = (typeof PAGES_PRESETS)[number];

type PresetField = { key: string; type: GcsPagesFieldType; required?: boolean; options?: number; listed?: boolean; filter?: boolean; help?: boolean };

export type GcsPagesPresetDef = {
  key: GcsPagesPreset;
  icon: string;
  /** Cheia propusă a bazei de date (și slug-ul paginii ei). */
  slug: string;
  listLayout: "list" | "grid" | "table";
  sort: "newest" | "updated" | "title" | "rating" | "views" | "comments";
  comments: boolean;
  ratings: boolean;
  submissions: boolean;
  approval: boolean;
  fields: PresetField[];
  /** Numărul categoriilor (`categories.<i>`) și iconițele lor. */
  categories: string[];
};

export const PAGES_PRESET_DEFS: Record<GcsPagesPreset, GcsPagesPresetDef> = {
  guides: {
    key: "guides",
    icon: "fa-solid fa-book-open",
    slug: "ghiduri",
    listLayout: "grid",
    sort: "newest",
    comments: true,
    ratings: true,
    submissions: true,
    approval: true,
    fields: [
      { key: "game", type: "select", options: 6, listed: true, filter: true },
      { key: "difficulty", type: "select", options: 3, listed: true, filter: true },
      { key: "minutes", type: "number", listed: true, help: true },
      { key: "video", type: "url", help: true },
    ],
    categories: ["fa-solid fa-seedling", "fa-solid fa-graduation-cap", "fa-solid fa-server"],
  },
  rules: {
    key: "rules",
    icon: "fa-solid fa-scale-balanced",
    slug: "regulamente",
    listLayout: "list",
    sort: "title",
    comments: false,
    ratings: false,
    submissions: false,
    approval: true,
    fields: [
      { key: "server", type: "server", listed: true, filter: true, help: true },
      { key: "game", type: "select", options: 6, listed: true, filter: true },
      { key: "applies", type: "select", options: 3, listed: true },
      { key: "updated", type: "date", listed: true },
    ],
    categories: ["fa-solid fa-gavel", "fa-solid fa-crown", "fa-solid fa-shield-halved"],
  },
  configs: {
    key: "configs",
    icon: "fa-solid fa-sliders",
    slug: "configuri",
    listLayout: "grid",
    sort: "rating",
    comments: true,
    ratings: true,
    submissions: true,
    approval: true,
    fields: [
      { key: "game", type: "select", required: true, options: 6, listed: true, filter: true },
      { key: "kind", type: "select", options: 4, listed: true, filter: true },
      { key: "config", type: "code", help: true },
      { key: "file", type: "file", help: true },
      { key: "resolution", type: "text", listed: true },
    ],
    categories: ["fa-solid fa-user", "fa-solid fa-server", "fa-solid fa-crosshairs"],
  },
  recruitment: {
    key: "recruitment",
    icon: "fa-solid fa-user-plus",
    slug: "recrutari",
    listLayout: "list",
    sort: "newest",
    comments: true,
    ratings: false,
    submissions: false,
    approval: true,
    fields: [
      { key: "status", type: "select", required: true, options: 2, listed: true, filter: true },
      { key: "slots", type: "number", listed: true },
      { key: "group", type: "text", listed: true, help: true },
      { key: "requirements", type: "textarea", help: true },
      { key: "apply", type: "url", help: true },
    ],
    categories: ["fa-solid fa-user-shield", "fa-solid fa-server", "fa-solid fa-people-group"],
  },
  blank: {
    key: "blank",
    icon: "fa-solid fa-database",
    slug: "baza",
    listLayout: "list",
    sort: "newest",
    comments: true,
    ratings: false,
    submissions: false,
    approval: true,
    fields: [],
    categories: [],
  },
};

/**
 * Datele unei baze de date dintr-un șablon, cu textele traduse de `t` (cheile relative la `pages.presets.<șablon>`):
 * `name`, `description`, `record`, `fields.<cheie>.label` / `.help` / `.options.<i>`, `categories.<i>.name` / `.description`.
 */
export function presetData(key: GcsPagesPreset, t: (k: string) => string) {
  const def = PAGES_PRESET_DEFS[key];
  return {
    icon: def.icon,
    slug: def.slug,
    name: t("name"),
    description: t("description"),
    recordLabel: t("record"),
    listLayout: def.listLayout,
    sort: def.sort,
    comments: def.comments,
    ratings: def.ratings,
    submissions: def.submissions,
    approval: def.approval,
    fields: def.fields.map((f) => ({
      key: f.key,
      label: t(`fields.${f.key}.label`),
      type: f.type,
      required: f.required === true,
      help: f.help ? t(`fields.${f.key}.help`) : "",
      options: Array.from({ length: f.options ?? 0 }, (_, i) => t(`fields.${f.key}.options.${i}`)),
      listed: f.listed === true,
      filter: f.filter === true,
    })),
    categories: def.categories.map((icon, i) => ({ icon, name: t(`categories.${i}.name`), description: t(`categories.${i}.description`) })),
  };
}
