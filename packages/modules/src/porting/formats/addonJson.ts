/**
 * Formatul `addon-json`: un add-on `.zip` cu `addon.json` și folderul `_data/` (`options.xml`, `option_groups.xml`,
 * `phrases.xml`, `permissions.xml`, `routes.xml`, `admin_navigation.xml`, `navigation.xml`, `templates.xml`,
 * `cron.xml`, `widget_definitions.xml`, `class_extensions.xml`, `code_event_listeners.xml`) și clasele PHP
 * (`Pub/Controller`, `Admin/Controller`, `Entity`, `Repository`, `Service`, `Setup.php`…).
 * Arhivele de distribuție pun add-on-ul sub `upload/src/addons/<Vendor>/<Nume>/`; restul (`upload/js/…`) intră la
 * fișierele de portat manual.
 */
import type { GcsPortCodeKind, GcsPortSetting, GcsPortSource } from "../types";
import { clampMinutes, codeFiles, emptySource, isObject, jsonOf, str, textOf, xmlOf } from "./common";
import { routeSegment } from "./appJson";
import { scanCreateTables, scanTemplateRefs } from "./php";
import { childNamed, childText, childrenNamed, descendants } from "../xml";

/** Folderul add-on-ului în arhivă: cel mai scurt prefix care conține `addon.json`. */
export function addonRoot(files: Map<string, Buffer>): string | null {
  const roots = [...files.keys()].filter((p) => /(?:^|\/)addon\.json$/.test(p)).map((p) => p.slice(0, -"addon.json".length));
  // Un `addon.json` cu `_data/` alături e add-on-ul; altfel primul găsit.
  const withData = roots.filter((r) => [...files.keys()].some((p) => p.startsWith(`${r}_data/`)));
  return (withData.length ? withData : roots).sort((a, b) => a.length - b.length)[0] ?? null;
}

function classify(path: string): GcsPortCodeKind {
  if (/(?:^|\/)Pub\/Controller\//.test(path)) return "controller";
  if (/(?:^|\/)Admin\/Controller\//.test(path)) return "acp_controller";
  if (/(?:^|\/)Api\/Controller\//.test(path)) return "api_controller";
  if (/(?:^|\/)(?:Entity|Finder|Repository)\//.test(path)) return "model";
  if (/(?:^|\/)Service\//.test(path)) return "service";
  if (/(?:^|\/)Cron\//.test(path)) return "task";
  if (/(?:^|\/)Widget\//.test(path)) return "widget";
  if (/(?:^|\/)Listener(?:\.php$|\/)/.test(path)) return "listener";
  if (/(?:^|\/)Setup(?:\.php$|\/)/.test(path)) return "setup";
  if (/(?:^|\/)Option\//.test(path)) return "settings_form";
  return "other";
}

/** Fișierul unei clase din add-on (`Vendor\Nume\Pub\Controller\Page` → `<root>Pub/Controller/Page.php`). */
function classFile(root: string, className: string): string {
  const parts = className.replace(/^\\/, "").split("\\");
  return `${root}${parts.slice(2).join("/")}.php`;
}

/** Calea GCS a unei rute (`my-page` + `:int<id>/` → `/my-page/:id`). */
function routePath(prefix: string, sub: string, format: string): string {
  const segments = [routeSegment(prefix), sub ? routeSegment(sub) : null].filter(Boolean) as string[];
  for (const m of format.matchAll(/:(?:\+?[a-z_-]+)?<([A-Za-z_]\w*)(?:,[^>]*)?>/g)) {
    if (segments.length < 6) segments.push(`:${m[1]!.replace(/_(\w)/g, (_x, c: string) => c.toUpperCase()).slice(0, 30)}`);
  }
  return segments.length ? `/${segments.join("/")}` : "/";
}

/** Parametrii unui câmp (`min=0\nmax=100`, `1={phrase:x}`). */
function formatParams(raw: string): [string, string][] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const eq = l.indexOf("=");
      return eq === -1 ? [l, ""] : [l.slice(0, eq).trim(), l.slice(eq + 1).trim()];
    });
}

const EDIT_FORMATS: Record<string, GcsPortSetting["type"]> = { onoff: "toggle", spinbox: "number", textbox: "text", radio: "select", select: "select" };

/** Citește un add-on `addon-json` (căile rămân cele din arhivă; `root` e folderul add-on-ului). */
export function readAddonJson(files: Map<string, Buffer>, root: string): GcsPortSource {
  const notes: GcsPortSource["notes"] = [];
  const manifest = jsonOf(files, `${root}addon.json`, notes);
  const info = isObject(manifest) ? manifest : {};
  const parts = root.replace(/\/$/, "").split("/");
  const id = parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : parts[parts.length - 1] || str(info.title) || "addon";
  const source = emptySource("addon-json", files, {
    id,
    name: str(info.title) || id,
    version: str(info.version_string) || "1.0.0",
    author: str(info.dev),
    url: str(info.dev_url) || null,
    description: str(info.description),
    icon: str(info.icon) || null,
  });
  source.notes.push(...notes);
  const data = (name: string) => xmlOf(files, `${root}_data/${name}`, source.notes);

  const phrases = data("phrases.xml");
  if (phrases) for (const p of descendants(phrases, "phrase")) if (p.attrs.title) source.phrases.set(p.attrs.title, p.text);

  // Setările: tipul din `edit_format`, grupul (tab-ul) din `relation`.
  const options = data("options.xml");
  for (const o of childrenNamed(options, "option")) {
    const key = o.attrs.option_id;
    if (!key) continue;
    const params = formatParams(childText(o, "edit_format_params"));
    let type = EDIT_FORMATS[o.attrs.edit_format ?? ""] ?? "unknown";
    if (o.attrs.data_type === "boolean" && type === "unknown") type = "toggle";
    if (type === "text" && params.some(([k, v]) => k === "rows" && Number(v) > 1)) type = "textarea";
    const setting: GcsPortSetting = { key, type, default: childText(o, "default_value"), labelPhrase: `option.${key}`, hintPhrase: `option_explain.${key}` };
    if (type === "number") {
      for (const [k, v] of params) {
        if (k === "min" && /^-?\d+$/.test(v)) setting.min = Number(v);
        if (k === "max" && /^-?\d+$/.test(v)) setting.max = Number(v);
      }
    }
    if (type === "select") {
      const opts = params.filter(([k]) => k !== "" && !["min", "max", "step", "rows", "class"].includes(k));
      if (opts.length > 0) setting.options = opts.slice(0, 50).map(([value, label]) => ({ value, label: /^\{phrase:([\w.]+)\}$/.exec(label)?.[1] ?? label }));
      else setting.type = "unknown";
    }
    const relation = childNamed(o, "relation");
    if (relation?.attrs.group_id) setting.group = relation.attrs.group_id;
    source.settings.push(setting);
  }

  // Permisiunile de grup: `permission_group_id` + `permission_id`, steag (boolean) sau număr.
  const permissions = data("permissions.xml");
  if (permissions) {
    for (const p of descendants(permissions, "permission")) {
      const group = p.attrs.permission_group_id;
      const pid = p.attrs.permission_id;
      if (!group || !pid) continue;
      source.permissions.push({ key: `${group}_${pid}`, type: p.attrs.permission_type === "integer" ? "number" : "boolean", labelPhrase: `permission.${group}_${pid}`, group });
    }
  }

  // Rutele (site, ACP, API), cu eticheta din meniul ACP (`admin_navigation.xml`) când linkul e același.
  const nav = data("admin_navigation.xml");
  const acpLabels = new Map<string, string>();
  for (const n of childrenNamed(nav, "navigation")) if (n.attrs.link && n.attrs.navigation_id) acpLabels.set(n.attrs.link.split("/")[0]!, `admin_navigation.${n.attrs.navigation_id}`);
  const routes = data("routes.xml");
  for (const r of childrenNamed(routes, "route")) {
    const type = r.attrs.route_type;
    const prefix = r.attrs.route_prefix ?? "";
    if (!type || !prefix) continue;
    const area = type === "admin" ? "acp" : type === "api" ? "api" : type === "public" ? "site" : null;
    if (!area) continue;
    const controller = r.attrs.controller ? classFile(root, r.attrs.controller.replace(":", `\\${area === "acp" ? "Admin" : area === "api" ? "Api" : "Pub"}\\Controller\\`)) : undefined;
    const label = area === "acp" ? acpLabels.get(prefix) : undefined;
    source.routes.push({
      area,
      path: routePath(prefix, r.attrs.sub_name ?? "", r.attrs.format ?? ""),
      origin: `_data/routes.xml: ${type}/${prefix}${r.attrs.sub_name ? `/${r.attrs.sub_name}` : ""}`,
      ...(controller && files.has(controller) ? { controller } : {}),
      ...(label ? { labelPhrase: label } : {}),
    });
  }

  // Navigarea site-ului: `{{ link('prefix') }}` → ruta pluginului cu același prefix.
  const publicNav = data("navigation.xml");
  for (const n of childrenNamed(publicNav, "navigation")) {
    const link = /link\(\s*\\?['"]([\w/-]+)\\?['"]/.exec(n.text)?.[1];
    const route = link ? source.routes.find((r) => r.area === "site" && r.path.split("/")[1] === routeSegment(link.split("/")[0]!)) : undefined;
    if (route && n.attrs.navigation_id) source.menus.push({ area: "site", key: n.attrs.navigation_id, route: route.path, labelPhrase: `nav.${n.attrs.navigation_id}` });
  }

  // Șabloanele (și CSS/LESS-ul, care sunt tot șabloane, cu extensia în titlu).
  const templates = data("templates.xml");
  for (const t of childrenNamed(templates, "template")) {
    const title = t.attrs.title;
    const type = t.attrs.type || "public";
    if (!title) continue;
    if (/\.(?:css|less)$/i.test(title)) {
      if (type !== "admin") source.styles.push({ name: title, body: t.text, origin: "_data/templates.xml", syntax: "tag" });
      continue;
    }
    source.templates.push({
      name: `${type}:${title}`,
      area: type === "admin" ? "acp" : type === "public" ? "site" : type === "email" ? "email" : "other",
      syntax: "tag",
      params: [],
      body: t.text,
      origin: "_data/templates.xml",
    });
  }
  for (const route of source.routes) {
    if (!route.controller) continue;
    const php = textOf(files, route.controller);
    const prefix = route.area === "acp" ? "admin" : "public";
    const ref = php
      ? scanTemplateRefs(php)
          .map((r) => (r.includes(":") ? r : `${prefix}:${r}`))
          .find((r) => source.templates.some((t) => t.name === r))
      : undefined;
    if (ref) source.views.set(route.controller, ref);
  }

  // Task-urile programate: regulile de rulare (JSON) aproximate în minute.
  const cron = data("cron.xml");
  for (const e of childrenNamed(cron, "entry")) {
    if (!e.attrs.entry_id) continue;
    let minutes = 1440;
    try {
      const rules = JSON.parse(e.text || "{}") as { minutes?: number[]; hours?: number[] };
      const everyHour = Array.isArray(rules.hours) && rules.hours.includes(-1);
      const mins = Array.isArray(rules.minutes) ? rules.minutes : [];
      if (everyHour) minutes = mins.includes(-1) ? 5 : mins.length > 1 ? Math.max(5, Math.floor(60 / mins.length)) : 60;
      else if (Array.isArray(rules.hours) && rules.hours.length > 1) minutes = Math.floor(1440 / rules.hours.length);
    } catch {
      source.notes.push({ code: "invalid_file", params: { path: `${root}_data/cron.xml` } });
    }
    source.tasks.push({ key: e.attrs.entry_id, everyMinutes: clampMinutes(minutes), origin: "_data/cron.xml" });
  }
  const widgets = data("widget_definitions.xml");
  for (const w of childrenNamed(widgets, "widget_definition")) {
    if (w.attrs.definition_id) source.widgets.push({ key: w.attrs.definition_id, labelPhrase: `widget_def.${w.attrs.definition_id}`, origin: "_data/widget_definitions.xml" });
  }

  // Schema: tabelele create în `Setup.php` (sau în `Setup/`), citite ca text.
  for (const [path, buf] of files) {
    if (!path.startsWith(root) || !/(?:^|\/)Setup(?:\.php$|\/.+\.php$)/.test(path.slice(root.length))) continue;
    for (const table of scanCreateTables(buf.toString("utf8"), path.slice(root.length))) if (!source.tables.some((t) => t.name === table.name)) source.tables.push(table);
  }

  // Extensiile de clase și listenerii au fișierele lor, care altfel ar părea „alte” clase.
  const kinds = new Map<string, GcsPortCodeKind>();
  for (const e of descendants(data("class_extensions.xml") ?? { name: "", attrs: {}, children: [], text: "" }, "extension")) if (e.attrs.to_class) kinds.set(classFile(root, e.attrs.to_class), "extension");
  for (const l of descendants(data("code_event_listeners.xml") ?? { name: "", attrs: {}, children: [], text: "" }, "listener")) if (l.attrs.callback_class) kinds.set(classFile(root, l.attrs.callback_class), "listener");
  source.code = codeFiles(files, (p) => classify(p.startsWith(root) ? p.slice(root.length) : p), kinds);
  return source;
}
