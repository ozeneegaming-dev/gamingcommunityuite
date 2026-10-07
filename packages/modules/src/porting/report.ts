/**
 * Raportul portării: procentul estimat de muncă automată, echivalentul GCS al fiecărui fișier de portat manual și
 * `PORTING.md` (în română sau engleză). Textele sursei (nume, căi) ajung în Markdown doar escapate.
 */
import type { GcsPortCodeKind, GcsPortManualItem, GcsPortNote, GcsPortReport } from "./types";

export type GcsPortLocale = "ro" | "en";

const SUGGESTIONS: Record<GcsPortLocale, Record<GcsPortCodeKind, string>> = {
  ro: {
    controller: "pagină pe site (`routes.pages` + `pages` în server.mjs); datele din `ctx.api` și `ctx.db`",
    acp_controller: "pagină ACP (`routes.acp` + `acp`); configurarea prin setările generate din manifest",
    api_controller: "rută API (`routes.api` + `api`), JSON, cu permisiunile pluginului",
    model: "tabel în migrație + funcții de acces cu `ctx.db.query` / `ctx.db.execute`",
    service: "funcții în server.mjs (sau `server/*.mjs`), apelate din pagini, evenimente și joburi",
    extension: "extinderea unei clase a platformei sursă → eveniment (`events`), filtrul `post.before_save` sau un punct de extensie",
    hook: "hook → punct de extensie (`postbit.after_fields`), widget sau filtrul `post.before_save`",
    listener: "listener → evenimentele GCS (`events`: `post.created`, `user.registered`…)",
    setup: "instalare / actualizare → migrațiile SQL din `migrations/` (schema pluginului)",
    task: "task programat → job (`jobs`, `everyMinutes`)",
    widget: "widget → `widgets` (HTML sanitizat, randat pe server)",
    settings_form: "formularul de setări e generat din manifest; rămân doar validările speciale",
    javascript: "JavaScript client → `client-js` (doar pentru pluginuri semnate) sau înlocuit cu HTML/CSS",
    other: "de analizat: cod fără echivalent direct",
  },
  en: {
    controller: "site page (`routes.pages` + `pages` in server.mjs); data from `ctx.api` and `ctx.db`",
    acp_controller: "ACP page (`routes.acp` + `acp`); configuration through the settings generated from the manifest",
    api_controller: "API route (`routes.api` + `api`), JSON, with the plugin's permissions",
    model: "table in the migration + access functions with `ctx.db.query` / `ctx.db.execute`",
    service: "functions in server.mjs (or `server/*.mjs`), called from pages, events and jobs",
    extension: "extension of a source platform class → event (`events`), the `post.before_save` filter or an extension point",
    hook: "hook → extension point (`postbit.after_fields`), widget or the `post.before_save` filter",
    listener: "listener → GCS events (`events`: `post.created`, `user.registered`…)",
    setup: "install / upgrade → SQL migrations in `migrations/` (the plugin's schema)",
    task: "scheduled task → job (`jobs`, `everyMinutes`)",
    widget: "widget → `widgets` (sanitized HTML, rendered on the server)",
    settings_form: "the settings form is generated from the manifest; only special validations remain",
    javascript: "client JavaScript → `client-js` (signed plugins only) or replaced with HTML/CSS",
    other: "to review: code without a direct equivalent",
  },
};

export const portSuggestion = (kind: GcsPortCodeKind, locale: GcsPortLocale) => SUGGESTIONS[locale][kind];

/** Lucrul manual: fișierele de cod, cu echivalentul GCS recomandat (codul de instalare primul, apoi după cale). */
export function manualItems(code: { path: string; kind: GcsPortCodeKind; lines: number }[], locale: GcsPortLocale): GcsPortManualItem[] {
  return code.map((c) => ({ ...c, suggestion: portSuggestion(c.kind, locale) }));
}

/** Unitățile de lucru (estimare): ce s-a convertit vs. ce rămâne. */
export function automatedPercent(auto: number, manual: number): number {
  if (auto + manual <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * auto) / (auto + manual))));
}

const NOTES: Record<GcsPortLocale, Record<string, string>> = {
  ro: {
    invalid_file: "Fișier ilizibil (JSON/XML invalid): {path}",
    files_outside_root: "{count} fișiere din afara folderului aplicației au fost ignorate",
    column_type_unknown: "Tipul coloanei {table}.{column} ({type}) a devenit text",
    fulltext_index: "Indexul fulltext {table}.{index} nu s-a convertit (căutarea se portează separat)",
    table_rejected: "Tabelul {table} a fost respins de verificarea SQL ({issue})",
    phrases_dropped: "{count} fraze peste limita fișierului de limbă au rămas doar în ORIGINAL/",
    settings_unknown: "{count} setări cu tip necunoscut au devenit câmpuri text",
    templates_skipped: "{count} șabloane nu s-au convertit (limita de mărime)",
    css_dropped: "{rules} reguli și {declarations} declarații CSS nesigure sau LESS au fost scoase",
    css_file_rejected: "{count} fișiere CSS nu s-au putut citi",
    html_dropped: "Din șabloane au fost scoase: {scripts} scripturi, {styles} blocuri de stil, {inline} atribute style, {handlers} handlere on*",
    forms: "{count} câmpuri de formular din șabloane: formularele nu sunt permise în HTML-ul pluginului (setări sau rute API)",
    limit: "Limita manifestului: doar primele {max} intrări de tip {what} au fost păstrate",
    gpl: "Licență GPL: codul GPL nu poate intra într-o distribuție GCS închisă; păstrează licența și sursele dacă redistribui pluginul",
  },
  en: {
    invalid_file: "Unreadable file (invalid JSON/XML): {path}",
    files_outside_root: "{count} files outside the application folder were ignored",
    column_type_unknown: "Column type {table}.{column} ({type}) became text",
    fulltext_index: "Fulltext index {table}.{index} was not converted (search is ported separately)",
    table_rejected: "Table {table} was rejected by the SQL check ({issue})",
    phrases_dropped: "{count} phrases over the language file limit stayed only in ORIGINAL/",
    settings_unknown: "{count} settings with an unknown type became text fields",
    templates_skipped: "{count} templates were not converted (size limit)",
    css_dropped: "{rules} unsafe or LESS CSS rules and {declarations} declarations were removed",
    css_file_rejected: "{count} CSS files could not be read",
    html_dropped: "Removed from templates: {scripts} scripts, {styles} style blocks, {inline} style attributes, {handlers} on* handlers",
    forms: "{count} form fields in templates: forms are not allowed in plugin HTML (use settings or API routes)",
    limit: "Manifest limit: only the first {max} {what} entries were kept",
    gpl: "GPL license: GPL code cannot go into a closed GCS distribution; keep the license and sources if you redistribute the plugin",
  },
};

/** Textul unei note (pentru `PORTING.md`). */
export function noteText(note: GcsPortNote, locale: GcsPortLocale): string {
  const template = NOTES[locale][note.code] ?? note.code;
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => note.params?.[k] ?? "");
}

/** O celulă de tabel Markdown: fără rânduri noi, `|` escapat, plafonată. */
const cell = (s: string, max = 200) => {
  const one = s.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").replace(/</g, "&lt;");
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};
const inline = (s: string) => cell(s).replace(/`/g, "'");

const L = {
  ro: {
    title: "Portarea",
    format: "Formatul sursei",
    formats: { "app-json": "aplicație cu `data/application.json`", "plugin-xml": "plugin într-un fișier XML", "addon-json": "add-on cu `addon.json` și `_data/`" },
    version: "Versiunea",
    author: "Autorul",
    rights: "Confirmarea dreptului",
    basis: { author: "sunt autorul pluginului", consent: "am acordul scris al autorului", license: "licența permite modificarea și folosirea" },
    noRights: "fără confirmare (doar analiză)",
    license: "Licența detectată",
    none: "nedetectată",
    estimate: "Estimare: {percent}% din muncă s-a făcut automat",
    converted: "Ce s-a convertit",
    area: "Tip",
    auto: "Automat",
    manual: "Manual",
    areas: {
      manifest: "Manifestul",
      settings: "Setările",
      permissions: "Permisiunile",
      routes: "Rutele și meniurile",
      phrases: "Frazele",
      schema: "Tabelele (migrația)",
      templates: "Șabloanele",
      styles: "CSS-ul",
      tasks: "Task-urile (joburi)",
      widgets: "Widget-urile",
      code: "Codul PHP",
      javascript: "JavaScript-ul",
    },
    todo: "Rămâne de portat",
    file: "Fișier (în ORIGINAL/)",
    kind: "Tip",
    lines: "Rânduri",
    equivalent: "Echivalentul GCS",
    notes: "Avertismente",
    next: "Pașii următori",
    steps: [
      "Completează locurile `TODO(portare)` din `{key}/server.mjs` ({todos}): datele paginilor, logica din șabloane, joburile.",
      "Portează fișierele din tabelul de mai sus (sursele sunt în `ORIGINAL/`, doar ca text).",
      "Traduce `lang/ro.json` (pornește cu textul sursei) și verifică migrația `migrations/001_init.sql`.",
      "Împachetează folderul (`packPlugin` din `@gcs/plugin-sdk`) și instalează-l din ACP → Sistem → Aplicații și pluginuri. Pluginul nu se activează automat.",
    ],
  },
  en: {
    title: "Porting",
    format: "Source format",
    formats: { "app-json": "application with `data/application.json`", "plugin-xml": "plugin in a single XML file", "addon-json": "add-on with `addon.json` and `_data/`" },
    version: "Version",
    author: "Author",
    rights: "Rights confirmation",
    basis: { author: "I am the plugin's author", consent: "I have the author's written consent", license: "the license allows modification and use" },
    noRights: "not confirmed (analysis only)",
    license: "Detected license",
    none: "not detected",
    estimate: "Estimate: {percent}% of the work was done automatically",
    converted: "What was converted",
    area: "Type",
    auto: "Automatic",
    manual: "Manual",
    areas: {
      manifest: "Manifest",
      settings: "Settings",
      permissions: "Permissions",
      routes: "Routes and menus",
      phrases: "Phrases",
      schema: "Tables (migration)",
      templates: "Templates",
      styles: "CSS",
      tasks: "Tasks (jobs)",
      widgets: "Widgets",
      code: "PHP code",
      javascript: "JavaScript",
    },
    todo: "Left to port",
    file: "File (in ORIGINAL/)",
    kind: "Type",
    lines: "Lines",
    equivalent: "GCS equivalent",
    notes: "Warnings",
    next: "Next steps",
    steps: [
      "Fill in the `TODO(portare)` places in `{key}/server.mjs` ({todos}): page data, template logic, jobs.",
      "Port the files in the table above (the sources are in `ORIGINAL/`, as text only).",
      "Translate `lang/ro.json` (it starts with the source text) and review the `migrations/001_init.sql` migration.",
      "Pack the folder (`packPlugin` from `@gcs/plugin-sdk`) and install it from ACP → System → Applications and plugins. The plugin is not enabled automatically.",
    ],
  },
} as const;

/** `PORTING.md`: raportul pentru dezvoltator. */
export function portingMarkdown(report: GcsPortReport, locale: GcsPortLocale): string {
  const t = L[locale];
  const fill = (s: string, params: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => params[k] ?? "");
  const lines: string[] = [];
  lines.push(`# ${t.title}: ${inline(report.source.name)} → \`${report.plugin.key}\``, "");
  lines.push(`- ${t.format}: ${t.formats[report.format]}`);
  lines.push(`- ${t.version}: ${inline(report.source.version)} → ${report.plugin.version}`);
  if (report.source.author) lines.push(`- ${t.author}: ${inline(report.source.author)}`);
  lines.push(`- ${t.rights}: ${report.rights ? `${t.basis[report.rights.basis]} (${report.rights.confirmedAt})` : t.noRights}`);
  lines.push(`- ${t.license}: ${report.license.spdx ? inline(report.license.spdx) : t.none}${report.license.gpl ? " — **GPL**" : ""}`);
  lines.push("", `**${fill(t.estimate, { percent: String(report.automatedPercent) })}**`, "");
  lines.push(`## ${t.converted}`, "", `| ${t.area} | ${t.auto} | ${t.manual} |`, "| --- | ---: | ---: |");
  for (const a of report.areas) lines.push(`| ${t.areas[a.area]} | ${a.auto} | ${a.manual} |`);
  lines.push("", `## ${t.todo}`, "", `| ${t.file} | ${t.kind} | ${t.lines} | ${t.equivalent} |`, "| --- | --- | ---: | --- |");
  for (const m of report.manual) lines.push(`| \`${inline(m.path)}\` | ${m.kind} | ${m.lines} | ${cell(m.suggestion, 400)} |`);
  if (report.notes.length) {
    lines.push("", `## ${t.notes}`, "");
    for (const n of report.notes) lines.push(`- ${cell(noteText(n, locale), 400)}`);
  }
  lines.push("", `## ${t.next}`, "");
  t.steps.forEach((s, i) => lines.push(`${i + 1}. ${fill(s, { key: report.plugin.key, todos: String(report.todos) })}`));
  return `${lines.join("\n")}\n`;
}
