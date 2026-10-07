/**
 * Formatul `app-json`: o aplicație exportată ca `.tar`, cu datele în `data/` (`application.json`, `versions.json`,
 * `settings.json`, `modules.json`, `acpmenu.json`, `furl.json`, `schema.json`, `lang.xml`, `theme.xml`, `tasks.json`,
 * `widgets.json`) și codul în `modules/`, `sources/`, `extensions/`, `hooks/`, `tasks/`, `widgets/`, `setup/`.
 * Fișierele din `dev/` (șabloane `.phtml`, CSS, `lang.php`) se folosesc când lipsesc cele din `data/`.
 */
import type { GcsPortCodeKind, GcsPortColumn, GcsPortIndex, GcsPortRoute, GcsPortSource, GcsPortTemplate } from "../types";
import { codeFiles, emptySource, isObject, isoMinutes, jsonOf, str, templateHeader, textOf, xmlOf } from "./common";
import { scanFormFields, scanLangArray, scanTemplateRefs } from "./php";
import { childrenNamed, descendants } from "../xml";

/** Folderul aplicației în arhivă (`""` sau `nume/`), după `data/application.json`. */
export function appRoot(files: Map<string, Buffer>): string | null {
  const roots = [...files.keys()].filter((p) => /(?:^|\/)data\/application\.json$/.test(p)).map((p) => p.slice(0, -"data/application.json".length));
  return roots.sort((a, b) => a.length - b.length)[0] ?? null;
}

function classify(path: string): GcsPortCodeKind {
  if (/^modules\/front\//.test(path)) return "controller";
  if (/^modules\/admin\//.test(path)) return "acp_controller";
  if (/^api\//.test(path)) return "api_controller";
  if (/^sources\//.test(path)) return "model";
  if (/^extensions\//.test(path)) return "extension";
  if (/^hooks\//.test(path)) return "hook";
  if (/^listeners\//.test(path)) return "listener";
  if (/^setup\//.test(path) || /^Application\.php$/.test(path)) return "setup";
  if (/^tasks\//.test(path)) return "task";
  if (/^widgets\//.test(path)) return "widget";
  if (/^(?:dev\/js|interface)\//.test(path)) return "javascript";
  return "other";
}

/** Un segment de rută GCS (`[a-z0-9][a-z0-9_-]{0,39}`) dintr-un text oarecare. */
export function routeSegment(s: string): string | null {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 40);
  return /^[a-z0-9]/.test(out) ? out : null;
}

/** Adresa „prietenoasă” (`view/{#id}-{?}`) ca rută GCS (`/view/:id`). */
function friendlyPath(friendly: string): string {
  const segments: string[] = [];
  let params = 0;
  for (const raw of friendly.split("/")) {
    const param = /\{[#@]([A-Za-z_]\w*)\}/.exec(raw);
    if (param) {
      segments.push(`:${param[1]!.replace(/_(\w)/g, (_m, c: string) => c.toUpperCase()).slice(0, 30)}`);
      params++;
      continue;
    }
    const seg = routeSegment(raw.replace(/\{[^}]*\}/g, ""));
    if (seg) segments.push(seg);
    if (segments.length >= 6 || params > 3) break;
  }
  return segments.length ? `/${segments.slice(0, 6).join("/")}` : "/";
}

const parseQuery = (real: string) => Object.fromEntries(real.split("&").map((p) => p.split("=") as [string, string]));

/** Coloanele și indexurile din `schema.json`. */
function readSchema(raw: unknown, source: GcsPortSource): void {
  if (!isObject(raw)) return;
  for (const [tableName, def] of Object.entries(raw)) {
    if (!isObject(def) || !isObject(def.columns)) continue;
    const columns: GcsPortColumn[] = [];
    for (const [colName, c] of Object.entries(def.columns)) {
      if (!isObject(c)) continue;
      const column: GcsPortColumn = {
        name: str(c.name) || colName,
        type: str(c.type).toLowerCase() || "text",
        nullable: c.allow_null === true || c.allow_null === 1 || c.allow_null === "1",
        unsigned: c.unsigned === true || c.unsigned === 1,
        autoIncrement: c.auto_increment === true || c.auto_increment === 1,
      };
      if (typeof c.length === "number" || /^\d+$/.test(str(c.length))) column.length = Number(c.length);
      if (typeof c.decimals === "number" || /^\d+$/.test(str(c.decimals))) column.decimals = Number(c.decimals);
      if (Array.isArray(c.values)) column.values = c.values.map(str).slice(0, 100);
      if (c.default !== undefined && !(c.default === null && !column.nullable)) column.default = c.default === null ? null : typeof c.default === "number" ? c.default : str(c.default);
      columns.push(column);
    }
    const indexes: GcsPortIndex[] = [];
    if (isObject(def.indexes)) {
      for (const [indexName, idx] of Object.entries(def.indexes)) {
        if (!isObject(idx) || !Array.isArray(idx.columns)) continue;
        const type = str(idx.type).toLowerCase();
        const kind = type === "primary" ? "primary" : type === "unique" ? "unique" : type === "fulltext" ? "fulltext" : "key";
        indexes.push({ kind, name: str(idx.name) || indexName, columns: idx.columns.map(str).filter(Boolean) });
      }
    }
    if (columns.length > 0) source.tables.push({ name: str(def.name) || tableName, columns, indexes, origin: "data/schema.json" });
  }
}

/** Citește o aplicație `app-json`. `files` sunt deja relative la folderul aplicației. */
export function readAppJson(files: Map<string, Buffer>): GcsPortSource {
  const notes: GcsPortSource["notes"] = [];
  const app = jsonOf(files, "data/application.json", notes);
  const info = isObject(app) ? app : {};
  const versions = jsonOf(files, "data/versions.json", notes);
  let version = str(info.app_version) || str(info.version);
  if (isObject(versions)) {
    const last = Object.entries(versions).sort((a, b) => Number(a[0]) - Number(b[0])).pop();
    if (last) version = str(last[1]) || version;
  }
  const dir = str(info.app_directory) || str(info.directory) || "app";
  const source = emptySource("app-json", files, {
    id: dir,
    name: str(info.application_title) || str(info.app_title) || dir,
    version: version || "1.0.0",
    author: str(info.app_author) || str(info.author),
    url: str(info.app_website) || null,
    description: str(info.app_description) || str(info.description),
    icon: null,
  });
  source.notes.push(...notes);

  // Frazele: `data/lang.xml` (sau `dev/lang.php`, dacă lipsește).
  const lang = xmlOf(files, "data/lang.xml", source.notes);
  if (lang) {
    for (const w of descendants(lang, "word")) if (w.attrs.key) source.phrases.set(w.attrs.key, w.text);
  } else {
    const php = textOf(files, "dev/lang.php");
    if (php) source.phrases = scanLangArray(php);
  }
  const title = source.phrases.get(`__app_${dir}`);
  if (title && !str(info.application_title)) source.meta.name = title;

  // Setările: cheile și valorile implicite din `settings.json`; tipul din formularele PHP (citite ca text).
  const forms = new Map<string, ReturnType<typeof scanFormFields>[number]>();
  for (const [path, data] of files) if (/\.php$/.test(path)) for (const f of scanFormFields(data.toString("utf8"))) if (!forms.has(f.key)) forms.set(f.key, f);
  const settings = jsonOf(files, "data/settings.json", source.notes);
  if (Array.isArray(settings)) {
    for (const s of settings) {
      if (!isObject(s) || !str(s.key)) continue;
      const key = str(s.key);
      const form = forms.get(key);
      source.settings.push({
        key,
        type: form?.type ?? "unknown",
        default: str(s.default),
        ...(form?.options ? { options: form.options } : {}),
        ...(form?.min !== undefined ? { min: form.min } : {}),
        ...(form?.max !== undefined ? { max: form.max } : {}),
        labelPhrase: key,
        hintPhrase: `${key}_desc`,
      });
    }
  }

  // Rutele site-ului: `furl.json` (adresele prietenoase), altfel controllerele din `modules/front/`.
  const controllerOf = (real: string): string | undefined => {
    const q = parseQuery(real);
    return q.module && q.controller ? `modules/front/${q.module}/${q.controller}.php` : undefined;
  };
  const furl = jsonOf(files, "data/furl.json", source.notes);
  const routes: GcsPortRoute[] = [];
  if (isObject(furl) && isObject(furl.pages)) {
    for (const [name, page] of Object.entries(furl.pages)) {
      if (!isObject(page)) continue;
      const controller = controllerOf(str(page.real));
      routes.push({ area: "site", path: friendlyPath(str(page.friendly)), origin: `data/furl.json: ${name}`, ...(controller && files.has(controller) ? { controller } : {}) });
    }
  }
  if (routes.length === 0) {
    for (const path of [...files.keys()].sort()) {
      const m = /^modules\/front\/([^/]+)\/([^/]+)\.php$/.exec(path);
      if (!m) continue;
      const segments = [routeSegment(m[1]!), routeSegment(m[2]!)].filter(Boolean);
      routes.push({ area: "site", path: `/${segments.join("/")}`, origin: path, controller: path });
    }
  }
  // Paginile ACP: meniul ACP (`acpmenu.json`), cu eticheta din frazele `menu__<app>_<modul>_<cheie>`.
  const acpmenu = jsonOf(files, "data/acpmenu.json", source.notes);
  if (isObject(acpmenu)) {
    for (const [module, entries] of Object.entries(acpmenu)) {
      if (!isObject(entries)) continue;
      for (const [key, entry] of Object.entries(entries)) {
        if (!isObject(entry)) continue;
        const controllerName = str(entry.controller) || key;
        const segments = [routeSegment(module), routeSegment(controllerName)].filter(Boolean);
        const controller = `modules/admin/${module}/${controllerName}.php`;
        routes.push({
          area: "acp",
          path: `/${segments.join("/")}`,
          origin: `data/acpmenu.json: ${module}.${key}`,
          labelPhrase: `menu__${dir}_${module}_${key}`,
          ...(files.has(controller) ? { controller } : {}),
        });
      }
    }
  }
  source.routes = routes;
  const firstSite = routes.find((r) => r.area === "site");
  if (firstSite) source.menus.push({ area: "site", key: "main", route: firstSite.path, labelPhrase: `__app_${dir}` });

  readSchema(jsonOf(files, "data/schema.json", source.notes), source);

  // Șabloanele și CSS-ul: `data/theme.xml`; altfel `dev/html/**.phtml` și `dev/css/**.css`.
  const theme = xmlOf(files, "data/theme.xml", source.notes);
  if (theme) {
    for (const t of childrenNamed(theme, "template")) {
      const location = t.attrs.template_location || "front";
      const name = `${location}/${t.attrs.template_group || "global"}/${t.attrs.template_name || "template"}`;
      source.templates.push({
        name,
        area: location === "admin" ? "acp" : location === "front" || location === "global" ? "site" : "other",
        syntax: "brace",
        params: [...(t.attrs.template_data ?? "").matchAll(/\$([A-Za-z_]\w*)/g)].map((m) => m[1]!),
        body: t.text,
        origin: "data/theme.xml",
      });
    }
    for (const c of childrenNamed(theme, "css")) {
      if ((c.attrs.css_location || "front") === "admin") continue;
      source.styles.push({ name: c.attrs.css_name || "style.css", body: c.text, origin: "data/theme.xml", syntax: "brace" });
    }
  } else {
    for (const [path, data] of files) {
      const html = /^dev\/html\/([^/]+)\/([^/]+)\/([^/]+)\.phtml$/.exec(path);
      if (html) {
        const { params, body } = templateHeader(data.toString("utf8"));
        const template: GcsPortTemplate = { name: `${html[1]}/${html[2]}/${html[3]}`, area: html[1] === "admin" ? "acp" : "site", syntax: "brace", params, body, origin: path };
        source.templates.push(template);
      }
      if (/^dev\/css\/(?!admin\/).+\.css$/.test(path)) source.styles.push({ name: path.split("/").pop()!, body: data.toString("utf8"), origin: path, syntax: "brace" });
    }
  }

  // Legătura controller → șablon (primul `getTemplate(…)->nume(` din fiecare controller).
  for (const route of routes) {
    if (!route.controller) continue;
    const php = textOf(files, route.controller);
    const ref = php ? scanTemplateRefs(php).find((r) => source.templates.some((t) => t.name === r)) : undefined;
    if (ref) source.views.set(route.controller, ref);
  }

  const tasks = jsonOf(files, "data/tasks.json", source.notes);
  if (isObject(tasks)) for (const [key, freq] of Object.entries(tasks)) source.tasks.push({ key, everyMinutes: isoMinutes(str(freq)), origin: "data/tasks.json" });
  const widgets = jsonOf(files, "data/widgets.json", source.notes);
  if (isObject(widgets)) for (const key of Object.keys(widgets)) source.widgets.push({ key, labelPhrase: `block_${key}`, origin: "data/widgets.json" });

  // Controllerele ACP care construiesc formularul setărilor: formularul e generat din manifest, rămân doar validările.
  const settingKeys = new Set(source.settings.map((s) => s.key));
  const kinds = new Map<string, GcsPortCodeKind>();
  for (const [path, data] of files) {
    if (/^modules\/admin\/.+\.php$/.test(path) && scanFormFields(data.toString("utf8")).some((f) => settingKeys.has(f.key))) kinds.set(path, "settings_form");
  }
  source.code = codeFiles(files, classify, kinds);
  return source;
}
