import * as z from "zod";
import { GCS_ACP_AREAS } from "../acp/areas";
import { GCS_FORUM_STYLE_CLASSES } from "../modules/forumSlots";
import { isPluginKey, PLUGIN_CAPABILITIES, PLUGIN_EVENTS, PLUGIN_FILTER_POINTS, PLUGIN_HOOK_POINTS, PLUGIN_MEDIA_CAPS, type GcsPluginCapability } from "./catalog";
import { isValidSemverRange, parseSemver } from "./semver";

/** O cheie locală (setare, permisiune, widget, job, intrare de meniu). */
const LOCAL_KEY = /^[a-z][a-zA-Z0-9_]{0,39}$/;
/** O iconiță Font Awesome Free după nume. */
const ICON = /^fa-(?:solid|regular|brands) fa-[a-z0-9-]{1,60}$/;
/** O cale de rută: `/`, `/stats`, `/item/:id` (segmente fixe sau parametri). */
const ROUTE = /^\/$|^(?:\/(?:[a-z0-9][a-z0-9_-]{0,39}|:[a-z][a-zA-Z0-9]{0,29})){1,6}$/;
/** O cheie de grup (`member`, `vip_gold`, `custom_12`). */
const GROUP_KEY = /^[a-z][a-z0-9_]{0,39}$/;

const localKey = z.string().regex(LOCAL_KEY, "invalid_key");
/**
 * O etichetă: o cheie din `lang/*.json` sau text simplu. Fără `{}` și `<>`: etichetele devin mesaje next-intl (ICU), iar
 * acolo acoladele și tagurile au sens special.
 */
const plainText = (max: number) => z.string().trim().min(1).max(max).refine((s) => !/[{}<>]/.test(s), "invalid_text");
const label = plainText(200);
const hint = z.string().trim().max(500).optional();
const icon = z.string().regex(ICON, "invalid_icon");
const route = z.string().regex(ROUTE, "invalid_route");
const priority = z.number().int().min(0).max(100).optional();

const textField = z.strictObject({
  type: z.enum(["text", "textarea"]),
  key: localKey,
  label,
  hint,
  default: z.string().max(5000).optional(),
  maxLength: z.number().int().min(1).max(20000).optional(),
});
const numberField = z.strictObject({
  type: z.literal("number"),
  key: localKey,
  label,
  hint,
  default: z.number().finite(),
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().positive().optional(),
  unit: z.string().max(40).optional(),
  /** „sau [ ] Nelimitat”: valoarea 0 înseamnă nelimitat. */
  unlimited: z.boolean().optional(),
});
const toggleField = z.strictObject({ type: z.literal("toggle"), key: localKey, label, hint, default: z.boolean().optional() });
const selectField = z.strictObject({
  type: z.literal("select"),
  key: localKey,
  label,
  hint,
  options: z.array(z.strictObject({ value: z.string().min(0).max(100), label })).min(1).max(50),
  default: z.string().max(100).optional(),
});
const secretField = z.strictObject({ type: z.literal("secret"), key: localKey, label, hint });
const settingField = z.discriminatedUnion("type", [textField, numberField, toggleField, selectField, secretField]);
export type GcsPluginSettingField = z.infer<typeof settingField>;

const widgetField = z.discriminatedUnion("type", [
  z.strictObject({ type: z.enum(["text", "textarea"]), key: localKey, label, maxLength: z.number().int().min(1).max(5000) }),
  z.strictObject({ type: z.literal("number"), key: localKey, label, min: z.number().int(), max: z.number().int() }),
  z.strictObject({ type: z.literal("select"), key: localKey, label, options: z.array(z.strictObject({ value: z.string().max(100), label })).min(1).max(50) }),
]);

/**
 * Forum v2: un câmp al unui tab din formularul forumului (`forumTabs`). Valorile le salvează nucleul, per forum; `css`
 * leagă valoarea de stilul rândului (o variabilă `--gcsp-*` / `--gcs-forum-*` sau o clasă `gcsp-*` / a nucleului), iar
 * `slot` pune un text direct într-un slot de listă (ca pastilă sau rând).
 */
const forumCssVar = z.string().regex(/^--(?:gcs-forum|gcsp)-[a-z0-9][a-z0-9-]{0,47}$/, "invalid_css_var");
const pluginCssClass = z.string().regex(/^gcsp-[a-z0-9][a-z0-9-]{0,47}$/, "invalid_css_class");
/** O clasă a pluginului (`gcsp-*`) sau un modificator documentat al nucleului (`GCS_FORUM_STYLE_CLASSES`). */
const forumCssClass = z.union([pluginCssClass, z.enum(GCS_FORUM_STYLE_CLASSES)]);
/** Prefixul unui select: al unei clase `gcsp-*` sau al unor modificatori ai nucleului (ex. `gcs-forumRow--image-` + `right`). */
const selectCssClass = z.union([
  pluginCssClass,
  z.string().refine((p) => /^gcs-[A-Za-z-]+-$/.test(p) && (GCS_FORUM_STYLE_CLASSES as readonly string[]).some((c) => c.startsWith(p) && c !== p), "invalid_css_class"),
]);
/** Legătura cu stilul a câmpurilor cu valoare (culoare, gradient, imagine): variabila și / sau clasa pusă când au valoare. */
const valueCss = z.strictObject({ var: forumCssVar.optional(), class: forumCssClass.optional() }).refine((c) => c.var !== undefined || c.class !== undefined, "required");
const forumTabField = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.enum(["text", "textarea"]),
    key: localKey,
    label,
    hint,
    default: z.string().max(2000).optional(),
    maxLength: z.number().int().min(1).max(5000).default(200),
    slot: z
      .strictObject({
        slot: z.enum(["forum.row.title", "forum.row.meta", "category.header", "widget.title"]),
        as: z.enum(["chip", "text"]).default("chip"),
        icon: icon.optional(),
        tone: z.enum(["accent", "neutral", "ok", "warn", "danger", "info"]).optional(),
        /** Cheile câmpurilor select din același tab care aleg tonul și poziția (`above`) pastilei. */
        toneFrom: localKey.optional(),
        placeFrom: localKey.optional(),
      })
      .optional(),
  }),
  z.strictObject({
    type: z.literal("number"),
    key: localKey,
    label,
    hint,
    default: z.number().finite().optional(),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive().optional(),
    css: z.strictObject({ var: forumCssVar, unit: z.enum(["px", "%", "deg", "s", ""]).default("") }).optional(),
  }),
  z.strictObject({ type: z.literal("toggle"), key: localKey, label, hint, default: z.boolean().optional(), css: z.strictObject({ class: forumCssClass }).optional() }),
  z.strictObject({
    type: z.literal("select"),
    key: localKey,
    label,
    hint,
    options: z.array(z.strictObject({ value: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/, "invalid_key"), label })).min(1).max(30).optional(),
    /** Opțiunile din site în locul celor fixe: grupurile, forumurile sau serverele de joc (aplicația Servere). */
    optionsFrom: z.enum(["groups", "forums", "servers"]).optional(),
    default: z.string().max(31).optional(),
    // La `select`, `class` e un prefix: clasa pusă e prefixul + valoarea aleasă (ex. `gcsp-style-` + `glow`).
    css: z.strictObject({ class: selectCssClass.optional(), var: forumCssVar.optional() }).optional(),
  }),
  z.strictObject({ type: z.literal("color"), key: localKey, label, hint, default: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "invalid_color").optional(), css: valueCss.optional() }),
  // Un gradient liniar din două culori (`linear-gradient(90deg, #RRGGBB, #RRGGBB)`).
  z.strictObject({
    type: z.literal("gradient"),
    key: localKey,
    label,
    hint,
    default: z.string().regex(/^linear-gradient\(\d{1,3}deg, #[0-9A-Fa-f]{6}, #[0-9A-Fa-f]{6}\)$/, "invalid_gradient").optional(),
    css: valueCss.optional(),
  }),
  z.strictObject({ type: z.literal("icon"), key: localKey, label, hint, default: icon.optional() }),
  // O imagine încărcată în stocarea platformei (recodată în WebP; SVG curățat); `css.var` primește `url("/files/<id>")`.
  z.strictObject({
    type: z.literal("image"),
    key: localKey,
    label,
    hint,
    maxKb: z.number().int().min(16).max(4096).default(512),
    maxSide: z.number().int().min(16).max(4096).default(1600),
    animated: z.boolean().default(false),
    css: valueCss.optional(),
  }),
]);
export type GcsPluginForumTabField = z.infer<typeof forumTabField>;

const json: z.ZodType<unknown> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string().max(5000), z.array(json).max(100), z.record(z.string().max(100), json)]));

/**
 * Un link care ar putea ieși din folderul lui: `..`, `\` sau forma lor codificată (`%2e`, `%2f`, `%5c`; browserul
 * tratează `%2e%2e` ca `..`). Verificăm și forma decodificată o dată, ca să prindem și codificarea dublă.
 */
function hasDotSegment(href: string): boolean {
  const unsafe = (s: string) => s.includes("..") || s.includes("\\") || /%(?:2e|2f|5c)/i.test(s);
  if (unsafe(href)) return true;
  try {
    return unsafe(decodeURIComponent(href));
  } catch {
    return true;
  }
}

const menuEntry = z.strictObject({ key: localKey, label, href: z.string().max(200), icon: icon.optional(), permission: localKey.optional() });

export const pluginManifestSchema = z.strictObject({
  $schema: z.string().max(300).optional(),
  manifestVersion: z.literal(1).optional(),
  key: z.string().refine(isPluginKey, "invalid_plugin_key"),
  name: plainText(80),
  version: z.string().refine((v) => parseSemver(v) !== null, "invalid_version"),
  author: z.union([z.string().trim().min(1).max(120), z.strictObject({ name: z.string().trim().min(1).max(120), url: z.url({ protocol: /^https?$/ }).max(300).optional() })]),
  description: z.string().trim().max(1000).default(""),
  icon: icon.default("fa-solid fa-puzzle-piece"),
  homepage: z.url({ protocol: /^https?$/ }).max(300).optional(),
  license: z.string().max(60).optional(),
  minGcs: z.string().refine((v) => parseSemver(v) !== null, "invalid_version").optional(),
  dependencies: z.record(z.string().refine(isPluginKey, "invalid_plugin_key"), z.string().refine(isValidSemverRange, "invalid_range")).default({}),
  capabilities: z.array(z.enum(PLUGIN_CAPABILITIES)).max(PLUGIN_CAPABILITIES.length).default([]),
  settings: z
    .strictObject({
      tabs: z.array(z.strictObject({ key: localKey, label, icon: icon.optional(), fields: z.array(settingField).min(1).max(50) })).min(1).max(10),
    })
    .optional(),
  permissions: z
    .array(
      z.strictObject({
        key: localKey,
        scope: z.enum(["group", "container"]),
        containerType: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "invalid_key").optional(),
        type: z.enum(["boolean", "number"]).default("boolean"),
        label,
        default: z.record(z.string().regex(GROUP_KEY, "invalid_key"), z.union([z.boolean(), z.number().int().min(-1)])).default({}),
      }),
    )
    .max(50)
    .default([]),
  widgets: z
    .array(
      z.strictObject({
        key: localKey,
        label,
        description: z.string().trim().max(300).optional(),
        icon: icon.default("fa-solid fa-puzzle-piece"),
        zones: z.array(z.enum(["top", "bottom", "sidebar"])).min(1).max(3).optional(),
        pages: z.array(z.enum(["index", "forum", "topic"])).min(1).max(3).optional(),
        fields: z.array(widgetField).max(20).default([]),
        defaultConfig: z.record(z.string(), json).default({}),
      }),
    )
    .max(20)
    .default([]),
  routes: z
    .strictObject({
      pages: z.array(z.strictObject({ path: route, title: label.optional(), permission: localKey.optional() })).max(30).default([]),
      /** `area` / `group`: zona și titlul grupului din navigația ACP (lipsă: zona Aplicații, sub numele pluginului). */
      acp: z.array(z.strictObject({ path: route, label, icon: icon.optional(), area: z.enum(GCS_ACP_AREAS).optional(), group: label.optional() })).max(20).default([]),
      api: z
        .array(
          z.strictObject({
            path: route,
            methods: z.array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])).min(1).max(5),
            permission: localKey.optional(),
            /** Rută a ACP-ului: poarta ACP (sesiune ACP, 2FA) și dreptul pe secțiunea `plugin.<cheie>`. */
            acp: z.enum(["view", "edit", "delete"]).optional(),
          }),
        )
        .max(40)
        .default([]),
    })
    .default({ pages: [], acp: [], api: [] }),
  events: z.array(z.enum(PLUGIN_EVENTS)).max(PLUGIN_EVENTS.length).default([]),
  filters: z.array(z.strictObject({ point: z.enum(PLUGIN_FILTER_POINTS), priority })).max(PLUGIN_FILTER_POINTS.length).default([]),
  hooks: z.array(z.strictObject({ point: z.enum(PLUGIN_HOOK_POINTS), priority })).max(PLUGIN_HOOK_POINTS.length).default([]),
  /**
   * Membri v2: cardurile și taburile pluginului pe fișa membrului din ACP și pe profilul public. Conținutul vine din
   * punctul `member.panel` (declarat în `hooks`); apar doar cât pluginul e pornit.
   */
  memberPanels: z
    .array(
      z.strictObject({
        key: localKey,
        label,
        icon: icon.default("fa-solid fa-puzzle-piece"),
        kind: z.enum(["card", "tab"]).default("card"),
        surfaces: z.array(z.enum(["acp", "profile"])).min(1).max(2),
        position: z.number().int().min(0).max(1000).default(100),
      }),
    )
    .max(10)
    .default([]),
  /**
   * Forum v2: taburile pluginului în ACP → Forumuri → Editează (ex. „Aspect”). Câmpurile le salvează nucleul, per forum
   * (pluginul le primește în `data` la punctele `forum.*`); `hook: true` adaugă sub câmpuri HTML-ul punctului
   * `forum.edit`. `types`: tipurile de noduri unde apare tabul (implicit toate).
   */
  forumTabs: z
    .array(
      z.strictObject({
        key: localKey,
        label,
        icon: icon.default("fa-solid fa-puzzle-piece"),
        position: z.number().int().min(0).max(1000).default(100),
        types: z.array(z.enum(["CATEGORY", "FORUM", "QA", "LINK", "PAGE"])).min(1).max(5).optional(),
        description: z.string().trim().max(300).optional(),
        fields: z.array(forumTabField).max(30).default([]),
        hook: z.boolean().default(false),
      }),
    )
    .max(5)
    .default([]),
  /**
   * Aspect forumuri (GCS ≥ 0.11.0): taburile pluginului în pagina de aspect a unui widget (ACP → Aspect → Widget-uri).
   * Aceleași câmpuri ca `forumTabs`, salvate de nucleu în configurarea amplasării; stilul benzii de titlu din `css`
   * (variabilele `--gcs-forum-*`, modificatorii `gcs-widget--*`), pastilele din câmpurile text cu slotul `widget.title`.
   */
  widgetTabs: z
    .array(
      z.strictObject({
        key: localKey,
        label,
        icon: icon.default("fa-solid fa-puzzle-piece"),
        position: z.number().int().min(0).max(1000).default(100),
        description: z.string().trim().max(300).optional(),
        fields: z.array(forumTabField).min(1).max(30),
      }),
    )
    .max(5)
    .default([]),
  jobs: z.array(z.strictObject({ key: localKey, everyMinutes: z.number().int().min(5).max(10080).optional(), label: label.optional() })).max(20).default([]),
  menus: z.strictObject({ site: z.array(menuEntry).max(10).default([]), user: z.array(menuEntry).max(10).default([]) }).default({ site: [], user: [] }),
  /** Fișierele media proprii (capabilitatea `media`): tipurile acceptate și limitele lor, sub plafoanele nucleului. */
  media: z
    .strictObject({
      image: z.strictObject({ maxMb: z.number().positive().max(PLUGIN_MEDIA_CAPS.image.maxMb), maxSide: z.number().int().min(64).max(PLUGIN_MEDIA_CAPS.image.maxSide).default(2048), animated: z.boolean().default(false) }).optional(),
      video: z.strictObject({ maxMb: z.number().positive().max(PLUGIN_MEDIA_CAPS.video.maxMb), maxSeconds: z.number().int().min(1).max(PLUGIN_MEDIA_CAPS.video.maxSeconds) }).optional(),
      audio: z.strictObject({ maxMb: z.number().positive().max(PLUGIN_MEDIA_CAPS.audio.maxMb) }).optional(),
      quotaMb: z.number().int().min(1).max(PLUGIN_MEDIA_CAPS.quotaMb),
    })
    .optional(),
  client: z
    .strictObject({
      styles: z.array(z.string().regex(/^assets\/[A-Za-z0-9._/-]+\.css$/, "invalid_asset")).max(10).default([]),
      scripts: z.array(z.string().regex(/^assets\/[A-Za-z0-9._/-]+\.js$/, "invalid_asset")).max(10).default([]),
    })
    .default({ styles: [], scripts: [] }),
});

export type GcsPluginManifest = z.infer<typeof pluginManifestSchema>;
export type GcsPluginManifestIssue = { path: string; code: string };

/** Ce capabilitate cere fiecare declarație din manifest. */
function requiredCapabilities(m: GcsPluginManifest): [GcsPluginCapability, string][] {
  const out: [GcsPluginCapability, string][] = [];
  if (m.settings) out.push(["settings", "settings"]);
  if (m.permissions.length) out.push(["permissions", "permissions"]);
  if (m.widgets.length) out.push(["widgets", "widgets"]);
  if (m.routes.pages.length) out.push(["pages", "routes.pages"]);
  if (m.routes.acp.length) out.push(["acp", "routes.acp"]);
  if (m.routes.api.length) out.push(["api", "routes.api"]);
  if (m.events.length) out.push(["events", "events"]);
  if (m.filters.length) out.push(["filters", "filters"]);
  if (m.hooks.length) out.push(["hooks", "hooks"]);
  if (m.jobs.length) out.push(["jobs", "jobs"]);
  if (m.menus.site.length || m.menus.user.length) out.push(["menus", "menus"]);
  if (m.client.styles.length) out.push(["client-css", "client.styles"]);
  if (m.client.scripts.length) out.push(["client-js", "client.scripts"]);
  if (m.media) out.push(["media", "media"]);
  return out;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => (seen.has(v) ? true : (seen.add(v), false)));
}

/** Verificările care leagă câmpurile între ele (capabilități, chei unice, valori implicite, linkuri). */
function crossCheck(m: GcsPluginManifest): GcsPluginManifestIssue[] {
  const issues: GcsPluginManifestIssue[] = [];
  const caps = new Set(m.capabilities);
  for (const [cap, path] of requiredCapabilities(m)) if (!caps.has(cap)) issues.push({ path, code: `missing_capability:${cap}` });
  if (m.dependencies[m.key]) issues.push({ path: "dependencies", code: "self_dependency" });
  if (caps.has("media") && !m.media) issues.push({ path: "media", code: "required" });
  if (m.media && !m.media.image && !m.media.video && !m.media.audio) issues.push({ path: "media", code: "required" });
  for (const r of m.routes.api) if (r.acp && !caps.has("acp")) issues.push({ path: `routes.api.${r.path}.acp`, code: "missing_capability:acp" });

  const fields = m.settings?.tabs.flatMap((t) => t.fields) ?? [];
  for (const d of duplicates(fields.map((f) => f.key))) issues.push({ path: `settings.${d}`, code: "duplicate_key" });
  for (const d of duplicates(m.settings?.tabs.map((t) => t.key) ?? [])) issues.push({ path: `settings.tabs.${d}`, code: "duplicate_key" });
  for (const f of fields) {
    if (f.type === "number") {
      if (f.min > f.max) issues.push({ path: `settings.${f.key}`, code: "invalid_range" });
      const inRange = f.default >= f.min && f.default <= f.max;
      if (!inRange && !(f.unlimited && f.default === 0)) issues.push({ path: `settings.${f.key}.default`, code: "out_of_range" });
    }
    if (f.type === "select" && f.default !== undefined && !f.options.some((o) => o.value === f.default)) {
      issues.push({ path: `settings.${f.key}.default`, code: "invalid_choice" });
    }
  }

  const permKeys = new Set(m.permissions.map((p) => p.key));
  for (const d of duplicates(m.permissions.map((p) => p.key))) issues.push({ path: `permissions.${d}`, code: "duplicate_key" });
  for (const p of m.permissions) {
    if (p.scope === "container" && !p.containerType) issues.push({ path: `permissions.${p.key}.containerType`, code: "required" });
    if (p.scope === "group" && p.containerType) issues.push({ path: `permissions.${p.key}.containerType`, code: "not_allowed" });
    if (p.scope === "container" && p.type === "number") issues.push({ path: `permissions.${p.key}.type`, code: "not_allowed" });
    for (const [group, value] of Object.entries(p.default)) {
      if (typeof value !== (p.type === "number" ? "number" : "boolean")) issues.push({ path: `permissions.${p.key}.default.${group}`, code: "invalid_type" });
    }
  }
  const permissionRef = (path: string, key: string | undefined) => {
    if (key !== undefined && !permKeys.has(key)) issues.push({ path, code: "unknown_permission" });
  };

  for (const d of duplicates(m.widgets.map((w) => w.key))) issues.push({ path: `widgets.${d}`, code: "duplicate_key" });
  for (const w of m.widgets) for (const d of duplicates(w.fields.map((f) => f.key))) issues.push({ path: `widgets.${w.key}.fields.${d}`, code: "duplicate_key" });
  for (const d of duplicates(m.routes.pages.map((r) => r.path))) issues.push({ path: `routes.pages.${d}`, code: "duplicate_key" });
  for (const d of duplicates(m.routes.acp.map((r) => r.path))) issues.push({ path: `routes.acp.${d}`, code: "duplicate_key" });
  for (const d of duplicates(m.routes.api.map((r) => r.path))) issues.push({ path: `routes.api.${d}`, code: "duplicate_key" });
  for (const r of m.routes.pages) permissionRef(`routes.pages.${r.path}.permission`, r.permission);
  for (const r of m.routes.api) permissionRef(`routes.api.${r.path}.permission`, r.permission);
  for (const d of duplicates(m.events)) issues.push({ path: `events.${d}`, code: "duplicate_key" });
  for (const d of duplicates(m.filters.map((f) => f.point))) issues.push({ path: `filters.${d}`, code: "duplicate_key" });
  for (const d of duplicates(m.hooks.map((h) => h.point))) issues.push({ path: `hooks.${d}`, code: "duplicate_key" });
  for (const d of duplicates(m.jobs.map((j) => j.key))) issues.push({ path: `jobs.${d}`, code: "duplicate_key" });
  for (const d of duplicates(m.memberPanels.map((p) => p.key))) issues.push({ path: `memberPanels.${d}`, code: "duplicate_key" });
  if (m.memberPanels.length > 0 && !m.hooks.some((h) => h.point === "member.panel")) issues.push({ path: "memberPanels", code: "missing_hook:member.panel" });
  // Forum v2: taburile din formularul forumului (punctele de extensie ale forumului cer capabilitatea `hooks`).
  if (m.forumTabs.length > 0 && !caps.has("hooks")) issues.push({ path: "forumTabs", code: "missing_capability:hooks" });
  for (const d of duplicates(m.forumTabs.map((t) => t.key))) issues.push({ path: `forumTabs.${d}`, code: "duplicate_key" });
  for (const d of duplicates(m.forumTabs.flatMap((t) => t.fields.map((f) => f.key)))) issues.push({ path: `forumTabs.fields.${d}`, code: "duplicate_key" });
  if (m.forumTabs.some((t) => t.hook) && !m.hooks.some((h) => h.point === "forum.edit")) issues.push({ path: "forumTabs", code: "missing_hook:forum.edit" });
  if (m.widgetTabs.length > 0 && !caps.has("hooks")) issues.push({ path: "widgetTabs", code: "missing_capability:hooks" });
  for (const d of duplicates(m.widgetTabs.map((t) => t.key))) issues.push({ path: `widgetTabs.${d}`, code: "duplicate_key" });
  for (const d of duplicates(m.widgetTabs.flatMap((t) => t.fields.map((f) => f.key)))) issues.push({ path: `widgetTabs.fields.${d}`, code: "duplicate_key" });
  for (const [area, tabs] of [["forumTabs", m.forumTabs], ["widgetTabs", m.widgetTabs]] as const) {
    for (const tab of tabs) {
      for (const f of tab.fields) {
        if ((f.type !== "text" && f.type !== "textarea") || !f.slot) continue;
        for (const ref of [f.slot.toneFrom, f.slot.placeFrom]) {
          if (ref !== undefined && !tab.fields.some((x) => x.key === ref && x.type === "select")) issues.push({ path: `${area}.${tab.key}.${f.key}.slot`, code: "unknown_field" });
        }
      }
    }
  }
  for (const tab of [...m.forumTabs, ...m.widgetTabs]) {
    for (const f of tab.fields) {
      if (f.type === "number") {
        if (f.min > f.max) issues.push({ path: `forumTabs.${tab.key}.${f.key}`, code: "invalid_range" });
        if (f.default !== undefined && (f.default < f.min || f.default > f.max)) issues.push({ path: `forumTabs.${tab.key}.${f.key}.default`, code: "out_of_range" });
      }
      if (f.type === "select" && !f.options === !f.optionsFrom) issues.push({ path: `forumTabs.${tab.key}.${f.key}.options`, code: f.options ? "not_allowed" : "required" });
      if (f.type === "select" && f.options && f.default !== undefined && !f.options.some((o) => o.value === f.default)) issues.push({ path: `forumTabs.${tab.key}.${f.key}.default`, code: "invalid_choice" });
    }
  }

  // Meniurile site-ului și ale userului duc doar spre paginile pluginului.
  const own = `/p/${m.key}`;
  for (const area of ["site", "user"] as const) {
    for (const d of duplicates(m.menus[area].map((e) => e.key))) issues.push({ path: `menus.${area}.${d}`, code: "duplicate_key" });
    for (const e of m.menus[area]) {
      const ok = (e.href === own || e.href.startsWith(`${own}/`) || e.href.startsWith(`${own}?`)) && /^[A-Za-z0-9._~/?=&%:-]+$/.test(e.href) && !hasDotSegment(e.href);
      if (!ok) issues.push({ path: `menus.${area}.${e.key}.href`, code: "external_link" });
      permissionRef(`menus.${area}.${e.key}.permission`, e.permission);
    }
  }
  return issues;
}

export type GcsManifestParse = { ok: true; manifest: GcsPluginManifest } | { ok: false; issues: GcsPluginManifestIssue[] };

/** Validează `plugin.json` (deja parsat din JSON): schema zod, apoi verificările încrucișate. */
export function parsePluginManifest(raw: unknown): GcsManifestParse {
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join(".") || "(root)", code: /^[a-z_:-]+$/.test(i.message) ? i.message : i.code })),
    };
  }
  const issues = crossCheck(parsed.data);
  return issues.length > 0 ? { ok: false, issues: issues.slice(0, 20) } : { ok: true, manifest: parsed.data };
}

/** Câmpurile setărilor, în ordinea tab-urilor. */
export function manifestSettingFields(m: GcsPluginManifest): GcsPluginSettingField[] {
  return m.settings?.tabs.flatMap((t) => t.fields) ?? [];
}

/** Valorile implicite ale setărilor (secretele pornesc goale). */
export function defaultPluginSettings(m: GcsPluginManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of manifestSettingFields(m)) {
    switch (f.type) {
      case "text":
      case "textarea":
        out[f.key] = f.default ?? "";
        break;
      case "number":
        out[f.key] = f.default;
        break;
      case "toggle":
        out[f.key] = f.default ?? false;
        break;
      case "select":
        out[f.key] = f.default ?? f.options[0]!.value;
        break;
      case "secret":
        out[f.key] = "";
        break;
    }
  }
  return out;
}

/**
 * Validează o valoare de setare după câmpul din manifest; întoarce valoarea normalizată sau codul erorii.
 * Pentru numerele cu „Nelimitat”, 0 înseamnă nelimitat.
 */
export function validatePluginSetting(f: GcsPluginSettingField, value: unknown): { ok: true; value: unknown } | { ok: false; code: string } {
  switch (f.type) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") return { ok: false, code: "invalid_type" };
      const max = f.maxLength ?? (f.type === "text" ? 200 : 5000);
      return value.length > max ? { ok: false, code: "too_long" } : { ok: true, value };
    }
    case "secret":
      return typeof value === "string" && value.length <= 2000 ? { ok: true, value } : { ok: false, code: "invalid_type" };
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, code: "invalid_type" };
      if (f.unlimited && value === 0) return { ok: true, value };
      return value < f.min || value > f.max ? { ok: false, code: "invalid_range" } : { ok: true, value };
    }
    case "toggle":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, code: "invalid_type" };
    case "select":
      return typeof value === "string" && f.options.some((o) => o.value === value) ? { ok: true, value } : { ok: false, code: "invalid_choice" };
  }
}
