/**
 * Pachetul unei teme (ACP → Aspect → Teme → Exportă / Importă): un singur fișier JSON cu numele, setările și fișierele
 * CSS ale temei, ca o temă făcută pe un site (sau livrată separat) să poată fi încărcată pe altul.
 *
 * Imaginile (logo-urile, favicon-ul, imaginea antetului) sunt fișiere ale site-ului sursă (`/files/<id>`) și nu există
 * pe alt site: nu intră în pachet, iar la import se ignoră (tema le primește apoi din editorul vizual).
 */
import { CUSTOM_CSS_FILE } from "./css";
import { CSS_FILE_NAME_RE, MAX_CSS_FILE, MAX_CSS_FILES } from "./files";
import { THEME_FIELDS, isPlainObject, themeSettingsErrors, withThemePath, type GcsDeepPartial, type GcsThemeSettings } from "./settings";

export const THEME_PACKAGE_FORMAT = "gcs-theme";
export const THEME_PACKAGE_VERSION = 1;
/** Mărimea maximă a fișierului încărcat (sub limita implicită de 1 MB a Server Actions). */
export const MAX_THEME_PACKAGE_BYTES = 900_000;
export const THEME_KEY_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export type GcsThemePackage = {
  format: typeof THEME_PACKAGE_FORMAT;
  version: typeof THEME_PACKAGE_VERSION;
  key: string;
  name: string;
  description?: string;
  author?: string;
  settings: GcsDeepPartial<GcsThemeSettings>;
  cssFiles: { name: string; content: string }[];
};

/** Căile setărilor care țin un fișier al site-ului (nu se mută între site-uri). */
const FILE_PATHS = Object.entries(THEME_FIELDS)
  .filter(([, f]) => f.kind === "file")
  .map(([path]) => path);

/** Setările fără imaginile site-ului (căile `file` devin `null`). */
export function portableThemeSettings<T extends object>(settings: T): T {
  let out = settings;
  for (const path of FILE_PATHS) {
    const [head] = path.split(".");
    if (isPlainObject((out as Record<string, unknown>)[head!])) out = withThemePath(out, path, null);
  }
  return out;
}

/** Pachetul unei teme (exportul). Fișierele CSS goale nu intră. */
export function buildThemePackage(theme: { key: string; name: string; settings: GcsThemeSettings; cssFiles: { name: string; content: string }[] }): GcsThemePackage {
  return {
    format: THEME_PACKAGE_FORMAT,
    version: THEME_PACKAGE_VERSION,
    key: theme.key,
    name: theme.name,
    settings: portableThemeSettings(structuredClone(theme.settings)),
    cssFiles: theme.cssFiles.filter((f) => f.content.trim()).map((f) => ({ name: f.name, content: f.content })),
  };
}

const optionalText = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);

/**
 * Citește (strict) un pachet de temă. Erorile sunt pe câmpuri, cu codurile din `errors.fields`; `package` = fișierul nu
 * e un pachet de temă GCS.
 */
export function parseThemePackage(raw: unknown): { ok: true; value: GcsThemePackage } | { ok: false; errors: Record<string, string> } {
  if (!isPlainObject(raw) || raw.format !== THEME_PACKAGE_FORMAT) return { ok: false, errors: { package: "invalid_theme_package" } };
  if (raw.version !== THEME_PACKAGE_VERSION) return { ok: false, errors: { version: "unsupported_theme_package" } };
  const errors: Record<string, string> = {};
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length < 1 || name.length > 40) errors.name = "invalid_length";
  if (typeof raw.key !== "string" || !THEME_KEY_RE.test(raw.key)) errors.key = "invalid_key";
  if (!optionalText(raw.description, 300)) errors.description = "too_long";
  if (!optionalText(raw.author, 80)) errors.author = "too_long";
  const settings = raw.settings ?? {};
  for (const [path, code] of Object.entries(themeSettingsErrors(settings))) errors[`settings.${path}`] = code;
  const files = raw.cssFiles ?? [];
  if (!Array.isArray(files)) errors.cssFiles = "invalid_type";
  else {
    if (files.length > MAX_CSS_FILES) errors.cssFiles = "too_many_files";
    const seen = new Set<string>();
    files.forEach((f: unknown, i) => {
      if (!isPlainObject(f) || typeof f.name !== "string" || typeof f.content !== "string") return void (errors[`cssFiles.${i}`] = "invalid_type");
      if (!CSS_FILE_NAME_RE.test(f.name)) errors[`cssFiles.${i}.name`] = "invalid_css_name";
      else if (seen.has(f.name)) errors[`cssFiles.${i}.name`] = "taken";
      seen.add(f.name);
      if (f.content.length > MAX_CSS_FILE) errors[`cssFiles.${i}.content`] = "too_long";
    });
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      format: THEME_PACKAGE_FORMAT,
      version: THEME_PACKAGE_VERSION,
      key: raw.key as string,
      name,
      ...(typeof raw.description === "string" ? { description: raw.description } : {}),
      ...(typeof raw.author === "string" ? { author: raw.author } : {}),
      settings: portableThemeSettings(settings as GcsDeepPartial<GcsThemeSettings>),
      cssFiles: (files as { name: string; content: string }[]).map((f) => ({ name: f.name, content: f.content })),
    },
  };
}

/** Fișierele pachetului cu `custom.css` primul (fișierul editorului vizual există mereu). */
export function themePackageFiles(pkg: Pick<GcsThemePackage, "cssFiles">): { name: string; content: string }[] {
  const custom = pkg.cssFiles.find((f) => f.name === CUSTOM_CSS_FILE) ?? { name: CUSTOM_CSS_FILE, content: "" };
  return [custom, ...pkg.cssFiles.filter((f) => f.name !== CUSTOM_CSS_FILE)];
}
