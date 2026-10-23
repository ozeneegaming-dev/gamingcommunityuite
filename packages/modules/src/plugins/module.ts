import {
  fieldsConfig,
  pluginAcpSection,
  pluginRegistryKey,
  type GcsForumExtension,
  type GcsForumExtField,
  type GcsModule,
  type GcsPluginForumTabField,
  type GcsPluginManifest,
  type GcsWidgetDef,
  type GcsWidgetField,
} from "@gcs/core";
import { isGcsIcon } from "@gcs/ui/icon-registry";

/** Spațiul de nume al textelor pluginurilor în mesajele next-intl: `pluginText.<vendor>.<nume>.<cheie>`. */
export const PLUGIN_TEXT_NAMESPACE = "pluginText";
const FALLBACK_ICON = "fa-solid fa-puzzle-piece";
const ALL_ZONES = ["top", "bottom", "sidebar"] as const;

export type GcsPluginLangs = Record<string, Record<string, unknown>>;

function lookup(lang: unknown, key: string): string | undefined {
  let node = lang;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function deepMerge(...sources: (Record<string, unknown> | undefined)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      const prev = out[k];
      out[k] = v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object" ? deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>) : v;
    }
  }
  return out;
}

/**
 * Textele unui plugin: etichetele din manifest sunt chei din `lang/*.json` sau text simplu. Ambele devin chei next-intl
 * (`pluginText.<vendor>.<nume>.<cheie>`, respectiv `…._lit.lN`), ca paginile existente (grupuri, editorul de pagină,
 * meniul ACP) să le afișeze fără cod special.
 */
export class GcsPluginTexts {
  private readonly literals = new Map<string, string>();
  readonly namespace: string;

  constructor(
    readonly key: string,
    private readonly manifest: GcsPluginManifest,
    private readonly langs: GcsPluginLangs,
  ) {
    this.namespace = `${PLUGIN_TEXT_NAMESPACE}.${key}`;
  }

  private isKey(label: string): boolean {
    return /^[A-Za-z0-9_.-]+$/.test(label) && Object.values(this.langs).some((lang) => lookup(lang, label) !== undefined);
  }

  /** Cheia next-intl a unei etichete din manifest. */
  labelKey(label: string): string {
    if (this.isKey(label)) return `${this.namespace}.${label}`;
    let id = this.literals.get(label);
    if (!id) {
      id = `l${this.literals.size}`;
      this.literals.set(label, id);
    }
    return `${this.namespace}._lit.${id}`;
  }

  /** Cheia numelui pluginului (`name` din `lang`, altfel numele din manifest). */
  get nameKey(): string {
    return `${this.namespace}._name`;
  }

  /** Textul unei etichete în limba cerută (engleza, apoi româna, apoi eticheta). */
  text(label: string, locale: string): string {
    if (!this.isKey(label)) return label;
    return lookup(this.langs[locale], label) ?? lookup(this.langs.en, label) ?? lookup(this.langs.ro, label) ?? label;
  }

  /** Mesajele pentru o limbă: textele pluginului (cu engleza și româna ca rezervă), numele și etichetele literale. */
  messages(locale: string): Record<string, unknown> {
    const merged = deepMerge(this.langs.ro, this.langs.en, this.langs[locale]);
    const name = lookup(merged, "name") ?? this.manifest.name;
    return { ...merged, _name: name, _lit: Object.fromEntries([...this.literals].map(([text, id]) => [id, text])) };
  }

  /** Limbile disponibile (pentru firul pluginului). */
  get raw(): GcsPluginLangs {
    return this.langs;
  }
}

/** Valorile implicite ale câmpurilor unui widget (cele lipsă din `defaultConfig`). */
function widgetDefaults(fields: GcsWidgetField[], given: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...given };
  for (const f of fields) {
    if (f.key in out) continue;
    out[f.key] = f.type === "number" ? f.min : f.type === "select" ? (f.options?.[0]?.value ?? "") : "";
  }
  return out;
}

/** Iconița validată cu registrul Font Awesome (una necunoscută devine iconița implicită a pluginurilor). */
export const pluginIcon = (name: string | undefined) => (name && isGcsIcon(name) ? name : FALLBACK_ICON);

/**
 * Punțile spre firul pluginului pentru punctele forumului (Forum v2): gazda le dă la încărcare; fără ele (ex. în
 * testele manifestului), extensia are doar taburile și stilul declarat pe câmpuri.
 */
export type GcsPluginForumBridge = Pick<GcsForumExtension, "list" | "forumPage" | "topicBar">;

/** Câmpurile unui tab al pluginului (`forumTabs[].fields`) ca acelea ale unei extensii de forum (etichete next-intl). */
function forumTabFields(fields: GcsPluginForumTabField[], texts: GcsPluginTexts): GcsForumExtField[] {
  return fields.map((f): GcsForumExtField => {
    const base = { key: f.key, labelKey: texts.labelKey(f.label), ...(f.hint ? { hintKey: texts.labelKey(f.hint) } : {}) };
    switch (f.type) {
      case "text":
      case "textarea":
        return { ...base, type: f.type, maxLength: f.maxLength, ...(f.default !== undefined ? { default: f.default } : {}), ...(f.slot ? { slot: f.slot } : {}) };
      case "number":
        return {
          ...base,
          type: "number",
          min: f.min,
          max: f.max,
          ...(f.step !== undefined ? { step: f.step } : {}),
          ...(f.default !== undefined ? { default: f.default } : {}),
          ...(f.css ? { style: { var: f.css.var, unit: f.css.unit } } : {}),
        };
      case "toggle":
        return { ...base, type: "toggle", ...(f.default !== undefined ? { default: f.default } : {}), ...(f.css ? { style: { class: f.css.class } } : {}) };
      case "select":
        return {
          ...base,
          type: "select",
          options: f.options.map((o) => ({ value: o.value, labelKey: texts.labelKey(o.label) })),
          ...(f.default !== undefined ? { default: f.default } : {}),
          ...(f.css ? { style: { ...(f.css.class ? { class: f.css.class } : {}), ...(f.css.var ? { var: f.css.var } : {}) } } : {}),
        };
      case "color":
        return { ...base, type: "color", ...(f.default !== undefined ? { default: f.default.toUpperCase() } : {}), ...(f.css ? { style: { var: f.css.var } } : {}) };
      case "icon":
        return { ...base, type: "icon", ...(f.default !== undefined ? { default: f.default } : {}) };
    }
  });
}

/**
 * Extensia de forum a unui plugin (Forum v2): taburile din `forumTabs` (câmpuri salvate de nucleu) și punctele
 * `forum.list` / `forum.page` / `topic.bar` declarate în `hooks`, prin puntea gazdei. `null` = pluginul nu extinde forumul.
 */
export function pluginForumExtension(key: string, manifest: GcsPluginManifest, texts: GcsPluginTexts, bridge?: GcsPluginForumBridge): GcsForumExtension | null {
  const points = new Set(manifest.hooks.map((h) => h.point));
  const usesForum = manifest.forumTabs.length > 0 || points.has("forum.list") || points.has("forum.page") || points.has("topic.bar");
  if (!usesForum) return null;
  const ext: GcsForumExtension = {
    key: pluginRegistryKey(key),
    position: Math.min(...manifest.hooks.filter((h) => h.point.startsWith("forum.") || h.point === "topic.bar").map((h) => h.priority ?? 100), 100) + 100,
    plugin: key,
    tabs: manifest.forumTabs.map((t) => ({
      key: t.key,
      labelKey: texts.labelKey(t.label),
      icon: pluginIcon(t.icon),
      position: t.position,
      ...(t.description ? { descriptionKey: texts.labelKey(t.description) } : {}),
      ...(t.types ? { types: t.types } : {}),
      fields: forumTabFields(t.fields, texts),
      ...(t.hook ? { pluginHook: true } : {}),
    })),
  };
  if (bridge?.list && points.has("forum.list")) ext.list = bridge.list;
  if (bridge?.forumPage && points.has("forum.page")) ext.forumPage = bridge.forumPage;
  if (bridge?.topicBar && points.has("topic.bar")) ext.topicBar = bridge.topicBar;
  return ext;
}

/**
 * Modulul GCS al unui plugin încărcat: permisiunile (`plugin.<cheie>.<perm>`), widget-urile (`plugin.<cheie>.<widget>`)
 * și paginile ACP fără parametri în meniul ACP (secțiunea `plugin.<cheie>`). Intră în registry cât timp pluginul e activ.
 */
export function pluginModule(key: string, manifest: GcsPluginManifest, texts: GcsPluginTexts, bridge?: GcsPluginForumBridge): GcsModule {
  const forumExtension = pluginForumExtension(key, manifest, texts, bridge);
  const base = pluginRegistryKey(key);
  const widgets: GcsWidgetDef[] = manifest.widgets.map((w) => {
    const fields: GcsWidgetField[] = w.fields.map((f) =>
      f.type === "select"
        ? { key: f.key, labelKey: texts.labelKey(f.label), type: "select", options: f.options.map((o) => ({ value: o.value, labelKey: texts.labelKey(o.label) })) }
        : f.type === "number"
          ? { key: f.key, labelKey: texts.labelKey(f.label), type: "number", min: f.min, max: f.max }
          : { key: f.key, labelKey: texts.labelKey(f.label), type: f.type, maxLength: f.maxLength },
    );
    const defaultConfig = widgetDefaults(fields, w.defaultConfig);
    const def: GcsWidgetDef = {
      key: `${base}.${w.key}`,
      labelKey: texts.labelKey(w.label),
      icon: pluginIcon(w.icon),
      zones: w.zones ?? ALL_ZONES,
      defaultConfig,
      fields,
      config: fieldsConfig(fields, defaultConfig),
    };
    if (w.description) def.descriptionKey = texts.labelKey(w.description);
    if (w.pages) def.pages = w.pages;
    return def;
  });

  const acpItems = manifest.routes.acp
    .filter((r) => !r.path.includes(":"))
    .map((r) => ({
      key: `${base}.acp${r.path === "/" ? "" : r.path.replace(/\//g, ".")}`,
      labelKey: texts.labelKey(r.label),
      href: `/admin/plugins/${key}${r.path === "/" ? "" : r.path}`,
      section: pluginAcpSection(key),
      icon: pluginIcon(r.icon ?? manifest.icon),
      // Navigația ACP: implicit zona Aplicații, sub numele pluginului; manifestul poate alege altă zonă / alt grup.
      ...(r.area ? { area: r.area } : {}),
      ...(r.group ? { group: texts.labelKey(r.group) } : {}),
    }));

  return {
    key: base,
    settings: [],
    eventListeners: [],
    permissions: manifest.permissions.map((p) => ({
      key: `${base}.${p.key}`,
      scope: p.scope,
      ...(p.containerType ? { containerType: p.containerType } : {}),
      labelKey: texts.labelKey(p.label),
      default: p.default,
    })),
    acpMenu: acpItems.length > 0 ? [{ app: "system", area: "apps", title: texts.nameKey, icon: pluginIcon(manifest.icon), items: acpItems }] : [],
    widgets,
    ...(forumExtension ? { forumExtensions: [forumExtension] } : {}),
    // Aplicația pluginului (ACP → Aplicații): rutele lui (accesul pe grup le închide) și paginile fără parametri ca secțiuni.
    app: {
      optional: false,
      labelKey: texts.nameKey,
      icon: pluginIcon(manifest.icon),
      routes: [`/p/${key}`, `/api/plugins/${key}`],
      sections: manifest.routes.pages
        .filter((r) => !r.path.includes(":"))
        .map((r) => ({
          key: r.path,
          labelKey: r.title ? texts.labelKey(r.title) : texts.nameKey,
          icon: pluginIcon(manifest.icon),
          href: `/p/${key}${r.path === "/" ? "" : r.path}`,
          ...(r.permission ? { permission: `${base}.${r.permission}` } : {}),
        })),
    },
  };
}
