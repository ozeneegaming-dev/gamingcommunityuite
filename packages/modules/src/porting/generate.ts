/**
 * Generatorul: o sursă citită (`GcsPortSource`) → pluginul GCS (manifest, `server.mjs`, texte, migrație, CSS), pachetul
 * instalabil (validat cu aceleași reguli ca la instalare), raportul și arhiva rezultatului (folderul pluginului,
 * pachetul, `ORIGINAL/`, `PORTING.md`, `report.json`). Nimic din sursă nu se execută.
 */
import { GCS_PLATFORM_VERSION, GcsValidationError, isPluginKey, langFileError, validatePluginPackage, type GcsPluginManifest } from "@gcs/core";
import { packPlugin } from "@gcs/plugin-sdk/pack";
import { writeZip } from "@gcs/plugin-sdk/zip";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { convertStyles } from "./convert/css";
import { convertPhrases } from "./convert/phrases";
import { convertSchema } from "./convert/schema";
import { emitTemplate, parseTemplate, TEMPLATE_RUNTIME, type GcsTplNode, type GcsTplStats } from "./convert/template";
import { automatedPercent, manualItems, portingMarkdown, type GcsPortLocale } from "./report";
import { boundNote, commentText, htmlToText, labelText, localKey, toSemver, uniqueKeys } from "./text";
import type { GcsPortArea, GcsPortNote, GcsPortReport, GcsPortRightsBasis, GcsPortSource } from "./types";

export type GcsPortOptions = {
  /** Cheia pluginului (`vendor.nume`), propusă de analiză sau aleasă de admin. */
  key: string;
  rights: { basis: GcsPortRightsBasis; confirmedAt: Date } | null;
  locale?: GcsPortLocale;
};

export type GcsPortOutput = {
  report: GcsPortReport;
  manifest: GcsPluginManifest | Record<string, unknown>;
  /** Fișierele pachetului (cale → conținut). */
  pluginFiles: Map<string, Buffer>;
  /** Pachetul instalabil (`<cheie>-<versiune>.zip`). */
  packageZip: Buffer;
  /** Arhiva rezultatului, de descărcat din ACP. */
  resultZip: Buffer;
};

/** Cât cod de șabloane intră cel mult în `server.mjs` (un fișier de pachet are cel mult 4 MB). */
const MAX_TEMPLATE_CODE = 3 * 1024 * 1024;
const MAX_TEMPLATES = 300;
/** Un șablon sursă mai mare rămâne manual (mărimea mărginește și timpul conversiei). */
const MAX_TEMPLATE_SOURCE = 256 * 1024;

const ROUTE_RE = /^\/$|^(?:\/(?:[a-z0-9][a-z0-9_-]{0,39}|:[a-z][a-zA-Z0-9]{0,29})){1,6}$/;
const lit = (s: string) => JSON.stringify(s);
/** O etichetă din manifest: cheia frazei, dacă fraza există, altfel textul cheii sursei, „omenizat”. */
const humanize = (key: string) => labelText(key.replace(/^.*[.:/]/, "").replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"), 200) || "Item";

/** Toate cheile de fraze folosite de un arbore de șablon. */
function phraseRefs(nodes: GcsTplNode[], out: string[]): void {
  for (const n of nodes) {
    if (n.t === "phrase") out.push(n.key);
    else if (n.t === "if") {
      for (const b of n.branches) phraseRefs(b.body, out);
      if (n.otherwise) phraseRefs(n.otherwise, out);
    } else if (n.t === "for") phraseRefs(n.body, out);
  }
}

const OWN_TEXTS = {
  en: { pending: "This page was ported automatically; its content comes after the manual porting.", job: "Scheduled task (to be ported)" },
  ro: { pending: "Pagina a fost portată automat; conținutul ei vine după portarea manuală.", job: "Task programat (de portat)" },
};

/** Convertește sursa într-un plugin GCS. Aruncă `GcsValidationError` doar pentru o cheie invalidă. */
export function convertPortSource(source: GcsPortSource, opts: GcsPortOptions): GcsPortOutput {
  const key = opts.key.trim();
  if (!isPluginKey(key)) throw new GcsValidationError({ key: "invalid" });
  const locale = opts.locale ?? "ro";
  const notes: GcsPortNote[] = [...source.notes];
  const version = toSemver(source.meta.version);
  const capabilities = new Set<string>();

  // ─── Șabloanele (întâi: frazele folosite de ele au prioritate în fișierul de limbă) ───
  const parsed: { name: string; area: string; params: string[]; origin: string; nodes: GcsTplNode[]; stats: GcsTplStats }[] = [];
  for (const t of source.templates.slice(0, MAX_TEMPLATES)) {
    if (t.body.length > MAX_TEMPLATE_SOURCE) continue;
    const type = t.name.includes(":") ? t.name.split(":")[0]! : "public";
    const { nodes, stats } = parseTemplate(t.body, t.syntax, type);
    parsed.push({ name: t.name, area: t.area, params: t.params, origin: t.origin, nodes, stats });
  }
  const used: string[] = [];
  for (const p of parsed) phraseRefs(p.nodes, used);
  for (const s of source.settings) {
    if (s.labelPhrase) used.push(s.labelPhrase);
    if (s.hintPhrase) used.push(s.hintPhrase);
    for (const o of s.options ?? []) used.push(o.label);
    if (s.group) used.push(`option_group.${s.group}`);
  }
  for (const p of source.permissions) if (p.labelPhrase) used.push(p.labelPhrase);
  for (const r of source.routes) if (r.labelPhrase) used.push(r.labelPhrase);
  for (const m of source.menus) if (m.labelPhrase) used.push(m.labelPhrase);
  for (const w of source.widgets) if (w.labelPhrase) used.push(w.labelPhrase);
  const phrases = convertPhrases(source.phrases, used);
  if (phrases.dropped) notes.push({ code: "phrases_dropped", params: { count: String(phrases.dropped) } });
  const label = (phrase: string | undefined, fallback: string) => (phrase ? phrases.keyOf(phrase) : null) ?? humanize(fallback);

  // ─── Setările ───
  const settingKeys = new Map<string, string>();
  let unknownSettings = 0;
  const fieldsByGroup = new Map<string, Record<string, unknown>[]>();
  const settingNames = uniqueKeys(source.settings.map((s) => localKey(s.key)));
  source.settings.slice(0, 450).forEach((s, i) => {
    const k = settingNames[i]!;
    settingKeys.set(s.key, k);
    const field: Record<string, unknown> = { key: k, label: label(s.labelPhrase, s.key) };
    const hint = s.hintPhrase ? phrases.keyOf(s.hintPhrase) : null;
    if (hint) field.hint = hint;
    const raw = s.default.trim();
    let type = s.type;
    if (type === "unknown") {
      unknownSettings++;
      type = "text";
    }
    if (type === "toggle") Object.assign(field, { type: "toggle", default: /^(?:1|true|on|yes)$/i.test(raw) });
    else if (type === "number") {
      const n = Number(raw);
      const value = Number.isFinite(n) ? n : 0;
      const unlimited = value === -1;
      const min = Math.min(s.min ?? 0, unlimited ? 0 : value);
      const max = Math.max(s.max ?? Math.max(1000, value * 10), min, unlimited ? 0 : value);
      Object.assign(field, { type: "number", default: unlimited ? 0 : value, min, max, ...(unlimited ? { unlimited: true } : {}) });
    } else if (type === "select" && s.options?.length) {
      const seen = new Set<string>();
      const options = s.options
        .filter((o) => o.value.length <= 100 && !seen.has(o.value) && (seen.add(o.value), true))
        .slice(0, 50)
        .map((o) => ({ value: o.value, label: phrases.keyOf(o.label) ?? (labelText(o.label, 200) || o.value || "-") }));
      Object.assign(field, { type: "select", options, default: options.some((o) => o.value === raw) ? raw : options[0]!.value });
    } else {
      const long = type === "textarea" || raw.length > 200 || raw.includes("\n");
      Object.assign(field, { type: long ? "textarea" : "text", default: raw.slice(0, 5000), ...(long ? { maxLength: Math.max(5000, Math.min(raw.length, 20000)) } : {}) });
    }
    const group = s.group ?? "general";
    if (!fieldsByGroup.has(group)) fieldsByGroup.set(group, []);
    fieldsByGroup.get(group)!.push(field);
  });
  if (unknownSettings) notes.push({ code: "settings_unknown", params: { count: String(unknownSettings) } });
  const tabs: Record<string, unknown>[] = [];
  const tabKeys = uniqueKeys([...fieldsByGroup.keys()].map((g) => localKey(g)));
  [...fieldsByGroup.entries()].forEach(([group, fields], gi) => {
    for (let i = 0; i < fields.length; i += 50) {
      const tabKey = i === 0 ? tabKeys[gi]! : `${tabKeys[gi]!.slice(0, 36)}_${i / 50 + 1}`;
      tabs.push({ key: tabKey, label: group === "general" ? "General" : label(`option_group.${group}`, group), fields: fields.slice(i, i + 50) });
    }
  });
  if (tabs.length > 10) {
    notes.push({ code: "limit", params: { max: "10", what: "settings.tabs" } });
    tabs.length = 10;
  }

  // ─── Permisiunile ───
  const permNames = uniqueKeys(source.permissions.map((p) => localKey(p.key)));
  const permissions = source.permissions.slice(0, 50).map((p, i) => ({
    key: permNames[i]!,
    scope: "group",
    type: p.type,
    label: label(p.labelPhrase, p.key),
    default: p.type === "number" ? { root_admin: -1, admin: -1 } : { root_admin: true, admin: true },
  }));
  if (source.permissions.length > 50) notes.push({ code: "limit", params: { max: "50", what: "permissions" } });

  // ─── Rutele, meniurile, joburile, widget-urile ───
  const routes = { pages: [] as Record<string, unknown>[], acp: [] as Record<string, unknown>[], api: [] as Record<string, unknown>[] };
  const handlers = { pages: [] as string[], acp: [] as string[], api: [] as string[] };
  const seenRoutes = { site: new Set<string>(), acp: new Set<string>(), api: new Set<string>() };
  const limits = { site: 30, acp: 20, api: 30 };
  const templateFns = new Map<string, string>();
  parsed.forEach((p, i) => templateFns.set(p.name, `tpl${i + 1}`));
  for (const r of source.routes) {
    if (!ROUTE_RE.test(r.path) || seenRoutes[r.area].has(r.path)) continue;
    if (seenRoutes[r.area].size >= limits[r.area]) {
      notes.push({ code: "limit", params: { max: String(limits[r.area]), what: `routes.${r.area}` } });
      continue;
    }
    seenRoutes[r.area].add(r.path);
    const view = r.controller ? source.views.get(r.controller) : undefined;
    const fn = view ? templateFns.get(view) : undefined;
    const todo = `// TODO(portare): ${commentText(`${r.controller ?? r.origin}: datele paginii (ctx.api, ctx.db) și logica controllerului`)}`;
    if (r.area === "api") {
      routes.api.push({ path: r.path, methods: ["GET"] });
      handlers.api.push(`    ${lit(r.path)}: async () => {\n      ${todo}\n      return { status: 501, body: { error: "not_ported" } };\n    },`);
      continue;
    }
    const titleKey = r.labelPhrase ? phrases.keyOf(r.labelPhrase) : null;
    const body = fn ? `${fn}(data, ctx)` : `'<p class="gcs-muted">' + ctx.escape(ctx.t("port.pending")) + "</p>"`;
    const handler = `    ${lit(r.path)}: async (input, ctx) => {\n      ${todo}\n      const data = scope(Object.create(null), "params", input.params);\n      return { title: ${titleKey ? `ctx.t(${lit(titleKey)})` : `ctx.t("name")`}, html: '<div class="gcsp-port">' + ${body} + "</div>" };\n    },`;
    if (r.area === "site") {
      routes.pages.push({ path: r.path, ...(titleKey ? { title: titleKey } : {}) });
      handlers.pages.push(handler);
    } else {
      routes.acp.push({ path: r.path, label: titleKey ?? humanize(r.path.split("/").filter(Boolean).pop() ?? "admin"), icon: "fa-solid fa-puzzle-piece" });
      handlers.acp.push(handler);
    }
  }
  if (routes.pages.length) capabilities.add("pages");
  if (routes.acp.length) capabilities.add("acp");
  if (routes.api.length) capabilities.add("api");

  const menuSite: Record<string, unknown>[] = [];
  const menuKeys = uniqueKeys(source.menus.map((m) => localKey(m.key)));
  source.menus.forEach((m, i) => {
    const target = m.route.includes(":") ? (seenRoutes.site.has("/") ? "/" : null) : seenRoutes.site.has(m.route) ? m.route : null;
    if (target === null || menuSite.length >= 10) return;
    menuSite.push({ key: menuKeys[i]!, label: label(m.labelPhrase, m.key), href: target === "/" ? `/p/${key}` : `/p/${key}${target}`, icon: "fa-solid fa-puzzle-piece" });
  });
  if (menuSite.length) capabilities.add("menus");

  const jobNames = uniqueKeys(source.tasks.map((t) => localKey(t.key)));
  const jobs = source.tasks.slice(0, 20).map((t, i) => ({ key: jobNames[i]!, everyMinutes: t.everyMinutes, label: "port.job" }));
  const jobHandlers = source.tasks
    .slice(0, 20)
    .map((t, i) => `    ${lit(jobNames[i]!)}: async (_data, ctx) => {\n      // TODO(portare): ${commentText(`task-ul ${t.key} (${t.origin})`)}\n      ctx.log.info(${lit(`TODO(portare): ${t.key}`)});\n    },`);
  if (jobs.length) capabilities.add("jobs");

  const widgetNames = uniqueKeys(source.widgets.map((w) => localKey(w.key)));
  const widgets = source.widgets.slice(0, 20).map((w, i) => ({ key: widgetNames[i]!, label: label(w.labelPhrase, w.key), icon: "fa-solid fa-puzzle-piece", zones: ["sidebar", "top", "bottom"] }));
  const widgetHandlers = source.widgets.slice(0, 20).map((w, i) => {
    const fn = templateFns.get(`front/widgets/${w.key}`) ?? templateFns.get(`public:widget_${w.key}`);
    const html = fn ? `${fn}(Object.create(null), ctx)` : `'<p class="gcs-muted">' + ctx.escape(ctx.t("port.pending")) + "</p>"`;
    return `    ${lit(widgetNames[i]!)}: async (_input, ctx) => {\n      // TODO(portare): ${commentText(`widgetul ${w.key} (${w.origin})`)}\n      return '<div class="gcsp-port">' + ${html} + "</div>";\n    },`;
  });
  if (widgets.length) capabilities.add("widgets");

  // ─── Schema și CSS ───
  const schema = convertSchema(source.tables, key);
  notes.push(...schema.notes);
  if (schema.sql) capabilities.add("db");
  const styles = convertStyles(source.styles, key);
  if (styles.stats.rules || styles.stats.declarations) notes.push({ code: "css_dropped", params: { rules: String(styles.stats.rules), declarations: String(styles.stats.declarations) } });
  if (styles.stats.files) notes.push({ code: "css_file_rejected", params: { count: String(styles.stats.files) } });
  if (styles.css) capabilities.add("client-css");
  if (tabs.length) capabilities.add("settings");
  if (permissions.length) capabilities.add("permissions");

  // ─── Funcțiile șabloanelor ───
  const templateCode: string[] = [];
  let codeSize = 0;
  let skippedTemplates = source.templates.length - parsed.length;
  let convertedTemplates = 0;
  const dropped = { scripts: 0, styles: 0, inline: 0, handlers: 0, forms: 0 };
  const emitCtx = {
    phrase: (k: string) => phrases.keyOf(k),
    setting: (k: string) => settingKeys.get(k) ?? null,
    template: (name: string) => templateFns.get(name) ?? null,
  };
  for (const p of parsed) {
    const body = emitTemplate(p.nodes, emitCtx);
    const header = [`/** ${commentText(`${p.name} (${p.origin})`).replace(/\*/g, "")}${p.params.length ? ` · parametri: ${commentText(p.params.join(", ")).replace(/\*/g, "")}` : ""} */`];
    if (p.stats.dropped.forms) header.push(`// TODO(portare): ${p.stats.dropped.forms} câmpuri de formular scoase (formularele nu sunt permise în HTML-ul pluginului).`);
    const fn = `${header.join("\n")}\nfunction ${templateFns.get(p.name)}(d0, ctx) {\n  const h = [];\n${body}\n  return h.join("");\n}`;
    if (codeSize + fn.length > MAX_TEMPLATE_CODE) {
      skippedTemplates++;
      templateCode.push(`function ${templateFns.get(p.name)}() {\n  // TODO(portare): ${commentText(`șablonul ${p.name} nu a încăput în server.mjs`)}\n  return "";\n}`);
      continue;
    }
    codeSize += fn.length;
    templateCode.push(fn);
    convertedTemplates++;
    dropped.scripts += p.stats.dropped.scripts;
    dropped.styles += p.stats.dropped.styles;
    dropped.inline += p.stats.dropped.inlineStyles;
    dropped.handlers += p.stats.dropped.handlers;
    dropped.forms += p.stats.dropped.forms;
  }
  if (skippedTemplates) notes.push({ code: "templates_skipped", params: { count: String(skippedTemplates) } });
  if (dropped.scripts || dropped.styles || dropped.inline || dropped.handlers) {
    notes.push({ code: "html_dropped", params: { scripts: String(dropped.scripts), styles: String(dropped.styles), inline: String(dropped.inline), handlers: String(dropped.handlers) } });
  }
  if (dropped.forms) notes.push({ code: "forms", params: { count: String(dropped.forms) } });
  if (source.license.gpl) notes.push({ code: "gpl" });

  // ─── Manifestul ───
  const meta = source.meta;
  const authorName = labelText(meta.author, 120) || "Unknown";
  const url = meta.url && URL.canParse(meta.url) && /^https?:$/.test(new URL(meta.url).protocol) && meta.url.length <= 300 ? meta.url : null;
  const iconName = meta.icon ? `fa-solid ${meta.icon.replace(/^fa-(?:solid|regular|brands)\s+/, "").trim()}` : null;
  const manifest: Record<string, unknown> = {
    manifestVersion: 1,
    key,
    name: labelText(meta.name, 80) || key,
    version,
    author: url ? { name: authorName, url } : authorName,
    description: htmlToText(meta.description).slice(0, 1000),
    icon: iconName && /^fa-solid fa-[a-z0-9-]{1,60}$/.test(iconName) && isGcsIcon(iconName) ? iconName : "fa-solid fa-puzzle-piece",
    ...(source.license.spdx && /^[A-Za-z0-9.+-]{1,60}$/.test(source.license.spdx) ? { license: source.license.spdx } : {}),
    minGcs: GCS_PLATFORM_VERSION,
    capabilities: [...capabilities].sort(),
    ...(tabs.length ? { settings: { tabs } } : {}),
    permissions,
    widgets,
    routes,
    jobs,
    menus: { site: menuSite, user: [] },
    client: { styles: styles.css ? ["assets/style.css"] : [], scripts: [] },
  };

  // ─── Textele ───
  const lang = (loc: "en" | "ro") => ({ name: manifest.name as string, port: OWN_TEXTS[loc], src: phrases.entries });
  for (const loc of ["en", "ro"] as const) {
    const issue = langFileError(lang(loc));
    if (issue) throw new Error(`lang_${issue}`);
  }

  // ─── server.mjs ───
  const section = (name: string, list: string[]) => (list.length ? `  ${name}: {\n${list.join("\n")}\n  },` : "");
  const server = [
    `// ${commentText(`Plugin generat de asistentul de portare GCS din „${meta.name}” (${source.format}, versiunea ${meta.version}).`, 300)}`,
    "// Scheletul: paginile și widget-urile randează șabloanele convertite cu date goale; codul sursei e în ORIGINAL/,",
    "// iar fiecare loc de completat are un comentariu TODO (portare). Vezi PORTING.md.",
    "",
    TEMPLATE_RUNTIME,
    templateCode.join("\n\n"),
    "",
    "export default {",
    [section("pages", handlers.pages), section("acp", handlers.acp), section("api", handlers.api), section("widgets", widgetHandlers), section("jobs", jobHandlers)].filter(Boolean).join("\n"),
    "};",
    "",
  ].join("\n");
  const todos = server.match(/\/\/ TODO\(portare\):/g)?.length ?? 0;

  // ─── Pachetul ───
  const pluginFiles = new Map<string, Buffer>();
  pluginFiles.set("plugin.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  pluginFiles.set("server.mjs", Buffer.from(server));
  pluginFiles.set("lang/en.json", Buffer.from(`${JSON.stringify(lang("en"), null, 2)}\n`));
  pluginFiles.set("lang/ro.json", Buffer.from(`${JSON.stringify(lang("ro"), null, 2)}\n`));
  if (schema.sql) pluginFiles.set("migrations/001_init.sql", Buffer.from(schema.sql));
  if (styles.css) pluginFiles.set("assets/style.css", Buffer.from(styles.css));
  const licenseFile = source.license.files.find((f) => /(?:^|\/)(?:license|licence|copying)(?:\.(?:md|txt))?$/i.test(f));
  const licenseData = licenseFile ? source.files.get(licenseFile) : undefined;
  if (licenseData && licenseData.length <= 200_000 && Buffer.from(licenseData.toString("utf8"), "utf8").equals(licenseData)) pluginFiles.set("LICENSE.txt", licenseData);
  pluginFiles.set(
    "README.md",
    Buffer.from(
      `# ${labelText(meta.name, 80) || key}\n\n${
        locale === "ro"
          ? `Plugin generat de asistentul de portare GCS (\`${source.format}\`). Nu e gata de producție: vezi PORTING.md din arhiva rezultatului.`
          : `Plugin generated by the GCS porting assistant (\`${source.format}\`). Not production ready: see PORTING.md in the result archive.`
      }\n`,
    ),
  );
  const packageZip = packPlugin(pluginFiles);
  const validation = validatePluginPackage(packageZip, { installed: [], trustedKeys: new Map() });

  // ─── Raportul ───
  const php = source.code.filter((c) => c.kind !== "javascript");
  const js = source.code.filter((c) => c.kind === "javascript");
  const area = (a: GcsPortArea, auto: number, manual: number) => ({ area: a, auto, manual });
  const areas = [
    area("manifest", 1, 0),
    area("settings", tabs.reduce((n, t) => n + (t.fields as unknown[]).length, 0) - unknownSettings, unknownSettings),
    area("permissions", permissions.length, 0),
    area("routes", routes.pages.length + routes.acp.length + routes.api.length + menuSite.length, source.routes.filter((r) => r.controller).length),
    area("phrases", Object.keys(phrases.entries).length, phrases.dropped),
    area("schema", schema.tables.length, schema.skipped.length),
    area("templates", convertedTemplates, skippedTemplates),
    area("styles", styles.css ? source.styles.length - styles.stats.files : 0, styles.stats.files),
    area("tasks", jobs.length, 0),
    area("widgets", widgets.length, 0),
    area("code", 0, php.length),
    area("javascript", 0, js.length),
  ];
  const autoUnits =
    2 +
    areas[1]!.auto +
    permissions.length +
    areas[3]!.auto +
    Object.keys(phrases.entries).length * 0.05 +
    schema.tables.length * 3 +
    areas[6]!.auto * 3 +
    areas[7]!.auto * 2 +
    (jobs.length + widgets.length) * 0.5;
  const manualUnits =
    unknownSettings +
    schema.skipped.length * 3 +
    skippedTemplates * 3 +
    todos * 0.5 +
    styles.stats.rules * 0.1 +
    php.reduce((n, c) => n + Math.max(1, c.lines / 25), 0) +
    js.reduce((n, c) => n + Math.max(1, c.lines / 40), 0);
  const fileName = `${key}-${version}.zip`;
  const report: GcsPortReport = {
    format: source.format,
    source: meta,
    plugin: { key, name: manifest.name as string, version, fileName },
    rights: opts.rights ? { basis: opts.rights.basis, confirmedAt: opts.rights.confirmedAt.toISOString() } : null,
    license: source.license,
    automatedPercent: automatedPercent(autoUnits, manualUnits),
    areas,
    manual: manualItems(source.code, locale),
    todos,
    notes: notes.slice(0, 200).map(boundNote),
    validation: { ok: validation.report.ok, checks: validation.report.checks },
  };

  // ─── Arhiva rezultatului ───
  const entries = [
    ...[...pluginFiles].map(([path, data]) => ({ name: `${key}/${path}`, data, mode: 0o100644 })),
    { name: fileName, data: packageZip, mode: 0o100644 },
    ...[...source.files].map(([path, data]) => ({ name: `ORIGINAL/${path}`, data, mode: 0o100644 })),
    { name: "PORTING.md", data: portingMarkdown(report, locale), mode: 0o100644 },
    { name: "report.json", data: `${JSON.stringify(report, null, 2)}\n`, mode: 0o100644 },
  ];
  const resultZip = writeZip(entries);
  return { report, manifest: validation.report.manifest ?? manifest, pluginFiles, packageZip, resultZip };
}
