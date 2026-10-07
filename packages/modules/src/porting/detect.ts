import { GcsPluginPackageError } from "@gcs/core";
import type { GcsPortArchive } from "./archive";
import { addonRoot, readAddonJson } from "./formats/addonJson";
import { appRoot, readAppJson } from "./formats/appJson";
import { readPluginXml } from "./formats/pluginXml";
import { boundNote, keyPart } from "./text";
import type { GcsPortAnalysis, GcsPortSource } from "./types";

const isPluginXml = (data: Buffer) => /^(?:\uFEFF)?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<plugin\b/.test(data.subarray(0, 4096).toString("utf8"));

/**
 * Recunoaște formatul sursei după fișierele ei și o citește (doar ca text): `addon.json` → `addon-json`,
 * `data/application.json` → `app-json`, un XML cu rădăcina `<plugin>` → `plugin-xml` (și într-un `.zip`).
 */
export function readPortSource(archive: GcsPortArchive): GcsPortSource {
  const source = readFormat(archive);
  // Metadatele ajung în analiză, raport și ACP: text pe un rând, plafonat (o descriere de câțiva MB nu trece mai departe).
  const one = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
  const m = source.meta;
  source.meta = {
    id: one(m.id, 200),
    name: one(m.name, 200) || "Plugin",
    version: one(m.version, 50) || "1.0.0",
    author: one(m.author, 200),
    // Doar adrese http(s): un `javascript:` din sursă nu ajunge niciodată un link în ACP.
    url: m.url && /^https?:\/\/[^\s]+$/i.test(one(m.url, 300)) ? one(m.url, 300) : null,
    description: one(m.description, 2000),
    icon: m.icon ? one(m.icon, 80) : null,
  };
  source.notes = source.notes.slice(0, 200).map(boundNote);
  return source;
}

function readFormat(archive: GcsPortArchive): GcsPortSource {
  const { files } = archive;
  const addon = addonRoot(files);
  if (addon !== null) return readAddonJson(files, addon);
  const app = appRoot(files);
  if (app !== null) {
    // Căile devin relative la folderul aplicației; fișierele din afara lui (rare) nu fac parte din aplicație.
    const relative = new Map<string, Buffer>();
    for (const [path, data] of files) if (path.startsWith(app)) relative.set(path.slice(app.length), data);
    const source = readAppJson(relative);
    if (relative.size < files.size) source.notes.push({ code: "files_outside_root", params: { count: String(files.size - relative.size) } });
    return source;
  }
  const xml = [...files].filter(([path, data]) => /\.xml$/i.test(path) && isPluginXml(data));
  if (xml.length === 1) {
    const [path, data] = xml[0]!;
    const source = readPluginXml(path, data);
    // Celelalte fișiere din arhivă (documentație, imagini) merg tot în `ORIGINAL/`.
    for (const [p, d] of files) if (p !== path && !source.files.has(p)) source.files.set(p, d);
    return source;
  }
  throw new GcsPluginPackageError("unknown_format");
}

/** Cheia propusă pentru plugin: `vendor.nume` din autor / id-ul sursei (fiecare parte ≤ 24 de caractere). */
export function suggestPluginKey(source: GcsPortSource): string {
  const { meta } = source;
  if (source.format === "addon-json" && meta.id.includes("/")) {
    const [vendor, name] = meta.id.split("/");
    return `${keyPart(vendor!)}.${keyPart(name!)}`;
  }
  const vendor = meta.author ? keyPart(meta.author.split(/[,(<]/)[0]!) : "ported";
  return `${vendor}.${keyPart(source.format === "app-json" ? meta.id : meta.name)}`;
}

/** Analiza de dinaintea confirmării: metadatele, licența și numerele pe tipuri (fără cod). */
export function analyzePortSource(source: GcsPortSource): GcsPortAnalysis {
  return {
    format: source.format,
    meta: source.meta,
    license: source.license,
    suggestedKey: suggestPluginKey(source),
    counts: {
      files: source.files.size,
      settings: source.settings.length,
      permissions: source.permissions.length,
      routes: source.routes.length,
      phrases: source.phrases.size,
      tables: source.tables.length,
      templates: source.templates.length,
      styles: source.styles.length,
      tasks: source.tasks.length,
      widgets: source.widgets.length,
      php: source.code.filter((c) => c.kind !== "javascript").length,
      javascript: source.code.filter((c) => c.kind === "javascript").length,
    },
    notes: source.notes.slice(0, 50),
  };
}
