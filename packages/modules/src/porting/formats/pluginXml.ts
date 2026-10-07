/**
 * Formatul `plugin-xml`: un plugin într-un singur fișier XML, cu rădăcina `<plugin name version_human author website>`
 * și secțiunile `<hooks>` (cod PHP), `<settings>` + `<settingsCode>`, `<lang>`, `<htmlFiles>`, `<cssFiles>`, `<jsFiles>`,
 * `<resourcesFiles>` (fișiere în base64), `<versions>` (codul de instalare), `<tasks>`, `<widgets>`.
 * Fișierele încorporate devin fișiere virtuale (`hooks/x.php`, `html/x.phtml`…), copiate în `ORIGINAL/`.
 */
import { GcsPluginPackageError } from "@gcs/core";
import { PORT_SOURCE_LIMITS } from "../archive";
import type { GcsPortCodeKind, GcsPortSource } from "../types";
import { codeFiles, emptySource, isoMinutes, templateHeader } from "./common";
import { scanFormFields } from "./php";
import { childText, childrenNamed, childNamed, parseXml, type GcsXmlElement } from "../xml";

/** Un nume de fișier încorporat, redus la segmente sigure (`[A-Za-z0-9._-]`). */
function safeName(raw: string, fallback: string): string {
  const name = raw
    .split(/[\\/]/)
    .pop()!
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return name || fallback;
}

/** Conținutul base64 al unui fișier încorporat, cu mărimea verificată înainte de decodare. */
function decode(text: string, path: string): Buffer {
  const clean = text.replace(/\s+/g, "");
  if ((clean.length * 3) / 4 > PORT_SOURCE_LIMITS.maxFileBytes) throw new GcsPluginPackageError("file_too_large", { path, max: String(PORT_SOURCE_LIMITS.maxFileBytes) });
  return /^[A-Za-z0-9+/]*={0,2}$/.test(clean) ? Buffer.from(clean, "base64") : Buffer.from(text, "utf8");
}

function classify(path: string): GcsPortCodeKind {
  if (path.startsWith("hooks/")) return "hook";
  if (path === "settings.php") return "settings_form";
  if (path.startsWith("setup/") || path === "uninstall.php") return "setup";
  if (path.startsWith("tasks/")) return "task";
  if (path.startsWith("widgets/")) return "widget";
  return "other";
}

/** Citește pluginul dintr-un fișier XML (`fileName` e calea lui în arhivă). */
export function readPluginXml(fileName: string, data: Buffer): GcsPortSource {
  let root: GcsXmlElement | null;
  try {
    root = parseXml(data.toString("utf8"));
  } catch {
    root = null;
  }
  if (!root || root.name !== "plugin") throw new GcsPluginPackageError("unknown_format");

  // Fișierele virtuale: XML-ul original plus tot ce e încorporat în el.
  const files = new Map<string, Buffer>([[fileName, data]]);
  let total = data.length;
  const add = (path: string, content: Buffer) => {
    let unique = path;
    for (let n = 2; files.has(unique); n++) unique = path.replace(/(\.[^./]+)?$/, `_${n}$1`);
    total += content.length;
    if (total > PORT_SOURCE_LIMITS.maxTotalBytes) throw new GcsPluginPackageError("total_too_large", { max: String(PORT_SOURCE_LIMITS.maxTotalBytes) });
    if (files.size >= PORT_SOURCE_LIMITS.maxFiles) throw new GcsPluginPackageError("too_many_files", { max: String(PORT_SOURCE_LIMITS.maxFiles) });
    files.set(unique, content);
    return unique;
  };

  const name = root.attrs.name || "Plugin";
  const source = emptySource("plugin-xml", files, {
    id: name,
    name,
    version: root.attrs.version_human || "1.0.0",
    author: root.attrs.author || "",
    url: root.attrs.website || null,
    description: "",
    icon: null,
  });

  for (const h of childrenNamed(childNamed(root, "hooks"), "hook")) add(`hooks/${safeName(h.attrs.filename || h.attrs.class || "hook", "hook")}.php`, Buffer.from(h.text, "utf8"));
  const settingsCode = childNamed(root, "settingscode")?.text ?? "";
  if (settingsCode.trim()) add("settings.php", Buffer.from(settingsCode, "utf8"));
  const uninstall = childNamed(root, "uninstallcode")?.text ?? "";
  if (uninstall.trim()) add("uninstall.php", Buffer.from(uninstall, "utf8"));
  for (const v of childrenNamed(childNamed(root, "versions"), "version")) if (v.text.trim()) add(`setup/${safeName(v.attrs.long || v.attrs.human || "version", "version")}.php`, Buffer.from(v.text, "utf8"));

  const embedded: [string, string, string][] = [
    ["htmlfiles", "html", "html"],
    ["cssfiles", "css", "css"],
    ["jsfiles", "js", "js"],
    ["resourcesfiles", "resources", "resources"],
  ];
  for (const [section, tag, dir] of embedded) {
    for (const f of childrenNamed(childNamed(root, section), tag)) {
      const path = `${dir}/${safeName(f.attrs.filename || "file", "file")}`;
      const content = decode(f.text, path);
      const stored = add(path, content);
      if (dir === "html") {
        const { params, body } = templateHeader(content.toString("utf8"));
        source.templates.push({ name: `plugins/${stored.slice(5).replace(/\.[^.]+$/, "")}`, area: "site", syntax: "brace", params, body, origin: stored });
      }
      if (dir === "css") source.styles.push({ name: stored.slice(4), body: content.toString("utf8"), origin: stored, syntax: "brace" });
    }
  }
  for (const t of childrenNamed(childNamed(root, "tasks"), "task")) {
    const key = t.attrs.key;
    if (!key) continue;
    source.tasks.push({ key, everyMinutes: isoMinutes(t.attrs.frequency ?? ""), origin: fileName });
    if (t.text.trim()) add(`tasks/${safeName(key, "task")}.php`, decode(t.text, `tasks/${key}.php`));
  }
  for (const w of childrenNamed(childNamed(root, "widgets"), "widget")) {
    const key = w.attrs.key;
    if (!key) continue;
    source.widgets.push({ key, labelPhrase: `block_${key}`, origin: fileName });
    if (w.text.trim()) add(`widgets/${safeName(key, "widget")}.php`, decode(w.text, `widgets/${key}.php`));
  }

  for (const w of childrenNamed(childNamed(root, "lang"), "word")) if (w.attrs.key) source.phrases.set(w.attrs.key, w.text);

  const forms = new Map(scanFormFields(settingsCode).map((f) => [f.key, f]));
  for (const s of childrenNamed(childNamed(root, "settings"), "setting")) {
    const key = childText(s, "key");
    if (!key) continue;
    const form = forms.get(key);
    source.settings.push({
      key,
      type: form?.type ?? "unknown",
      default: childText(s, "default"),
      ...(form?.options ? { options: form.options } : {}),
      ...(form?.min !== undefined ? { min: form.min } : {}),
      ...(form?.max !== undefined ? { max: form.max } : {}),
      labelPhrase: key,
      hintPhrase: `${key}_desc`,
    });
  }

  // Licența se caută și în fișierele încorporate (antetele PHP/JS).
  source.license = emptySource("plugin-xml", files, source.meta).license;
  source.code = codeFiles(files, classify);
  return source;
}
