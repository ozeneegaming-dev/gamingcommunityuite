import { createHash, type KeyObject } from "node:crypto";
import { comparePluginMigrations, GCS_PLATFORM_VERSION, pluginSchema } from "./catalog";
import { scopePluginCss } from "./css";
import { parsePluginManifest, type GcsPluginManifest } from "./manifest";
import { compareSemver, parseSemver, satisfiesSemver } from "./semver";
import { verifyPluginSignature, type GcsPluginSignatureStatus } from "./signature";
import { checkPluginSql } from "./sqlGuard";
import { GcsPluginPackageError, readPluginZip } from "./zip";

/** O verificare din raportul de validare; `code` e cheia de traducere `acp.plugins.checks.<code>`. */
export type GcsPluginCheck = { code: string; level: "ok" | "warn" | "error"; params?: Record<string, string> };

/** Un plugin deja instalat (pentru actualizări și dependențe). */
export type GcsPluginInstalledInfo = { key: string; version: string; status: string; enabled: boolean; capabilities: string[] };

export type GcsPluginValidateContext = {
  platformVersion?: string;
  installed: GcsPluginInstalledInfo[];
  trustedKeys: ReadonlyMap<string, KeyObject>;
  /** `deny` (`GCS_PLUGINS_UNSIGNED=deny`): pachetele nesemnate sunt refuzate. */
  unsignedPolicy?: "allow" | "deny";
};

/** Raportul validării (se păstrează ca JSON lângă încărcare și se afișează pe ecranul de confirmare). */
export type GcsPluginReport = {
  ok: boolean;
  checks: GcsPluginCheck[];
  sha256: string;
  size: number;
  manifest: GcsPluginManifest | null;
  files: { path: string; size: number }[];
  signature: GcsPluginSignatureStatus | null;
  mode: "install" | "update" | "reinstall" | null;
  previous: { version: string; capabilities: string[] } | null;
  newCapabilities: string[];
  migrations: string[];
};

export const PLUGIN_LOCALES = ["ro", "en", "de", "es", "fr", "ru"] as const;

const FILE_RULES: RegExp[] = [
  /^plugin\.json$/,
  /^server\.mjs$/,
  /^server\/[A-Za-z0-9._/-]+\.(?:mjs|json)$/,
  /^lang\/(?:ro|en|de|es|fr|ru)\.json$/,
  /^migrations\/\d{3,6}_[a-z0-9_]{1,60}\.sql$/,
  /^assets\/[A-Za-z0-9._/-]+\.(?:css|js|png|jpe?g|gif|webp|woff2?)$/,
  /^gcs-signature\.json$/,
  /^(?:README|CHANGELOG)\.md$/,
  /^LICENSE(?:\.md|\.txt)?$/,
  /^THIRD-PARTY-NOTICES(?:\.md|\.txt)?$/,
];

const isUtf8 = (buf: Buffer) => Buffer.from(buf.toString("utf8"), "utf8").equals(buf);

/**
 * Un fișier de limbă: obiecte imbricate cu șiruri (≤ 5 niveluri, ≤ 2000 de chei), chei fără `.`, texte ≤ 2000 de
 * caractere, cu `{param}` ca singură sintaxă de mesaj (fără taguri `<…>` și alte acolade).
 */
export function langFileError(raw: unknown): string | null {
  let keys = 0;
  const walk = (value: unknown, depth: number): string | null => {
    if (typeof value === "string") {
      if (value.length > 2000) return "too_long";
      if (/[<>]/.test(value)) return "markup";
      if (/[{}]/.test(value.replace(/\{[A-Za-z0-9_]{1,40}\}/g, ""))) return "braces";
      return null;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value) || depth > 5) return "invalid_type";
    for (const [k, v] of Object.entries(value)) {
      if (++keys > 2000) return "too_many";
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(k)) return "invalid_key";
      const err = walk(v, depth + 1);
      if (err) return err;
    }
    return null;
  };
  return walk(raw, 0);
}

export type GcsPluginPackage = { report: GcsPluginReport; files: Map<string, Buffer> | null };

/**
 * Validează arhiva unui plugin: structura ZIP, fișierele permise, manifestul, textele, migrațiile (SQL guard), CSS-ul,
 * compatibilitatea cu platforma, dependențele, versiunea față de cea instalată și semnătura. Nu scrie nimic.
 */
export function validatePluginPackage(zip: Buffer, ctx: GcsPluginValidateContext): GcsPluginPackage {
  const checks: GcsPluginCheck[] = [];
  const report: GcsPluginReport = {
    ok: false,
    checks,
    sha256: createHash("sha256").update(zip).digest("hex"),
    size: zip.length,
    manifest: null,
    files: [],
    signature: null,
    mode: null,
    previous: null,
    newCapabilities: [],
    migrations: [],
  };
  const error = (code: string, params?: Record<string, string>) => checks.push({ code, level: "error", ...(params ? { params } : {}) });
  const done = (files: Map<string, Buffer> | null): GcsPluginPackage => {
    report.ok = !checks.some((c) => c.level === "error");
    return { report, files: report.ok ? files : null };
  };

  let files: Map<string, Buffer>;
  try {
    files = readPluginZip(zip);
  } catch (e) {
    if (e instanceof GcsPluginPackageError) error(e.code, e.params);
    else error("zip_invalid");
    return done(null);
  }
  report.files = [...files].map(([path, data]) => ({ path, size: data.length })).sort((a, b) => a.path.localeCompare(b.path));
  checks.push({ code: "archive_ok", level: "ok", params: { files: String(files.size) } });

  for (const path of files.keys()) if (!FILE_RULES.some((r) => r.test(path))) error("unexpected_file", { path });
  for (const [path, data] of files) {
    if (/\.(?:json|mjs|js|css|sql|md)$/.test(path) && !isUtf8(data)) error("not_utf8", { path });
  }

  const rawManifest = files.get("plugin.json");
  if (!rawManifest) {
    error("manifest_missing");
    return done(null);
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(rawManifest.toString("utf8"));
  } catch {
    error("manifest_json");
    return done(null);
  }
  const parsed = parsePluginManifest(manifestJson);
  if (!parsed.ok) {
    for (const issue of parsed.issues) error("manifest_invalid", { path: issue.path, issue: issue.code });
    return done(null);
  }
  const manifest = parsed.manifest;
  report.manifest = manifest;
  checks.push({ code: "manifest_ok", level: "ok", params: { key: manifest.key, version: manifest.version } });

  if (!files.has("server.mjs")) error("server_missing");

  for (const locale of PLUGIN_LOCALES) {
    const data = files.get(`lang/${locale}.json`);
    if (!data) continue;
    let json: unknown;
    try {
      json = JSON.parse(data.toString("utf8"));
    } catch {
      error("lang_invalid", { path: `lang/${locale}.json`, issue: "json" });
      continue;
    }
    const issue = langFileError(json);
    if (issue) error("lang_invalid", { path: `lang/${locale}.json`, issue });
  }

  const schema = pluginSchema(manifest.key);
  const migrations = [...files.keys()].filter((p) => p.startsWith("migrations/")).sort(comparePluginMigrations);
  report.migrations = migrations.map((p) => p.slice("migrations/".length));
  if (migrations.length > 0 && !manifest.capabilities.includes("db")) error("missing_capability", { capability: "db", path: "migrations/" });
  for (const path of migrations) {
    const check = checkPluginSql(files.get(path)!.toString("utf8"), { schema, mode: "migration" });
    if (!check.ok) error("migration_rejected", { path, issue: check.code, detail: check.detail });
  }
  if (migrations.length > 0 && !checks.some((c) => c.code === "migration_rejected")) checks.push({ code: "migrations_ok", level: "ok", params: { count: String(migrations.length) } });

  for (const style of manifest.client.styles) {
    const data = files.get(style);
    if (!data) {
      error("asset_missing", { path: style });
      continue;
    }
    const css = scopePluginCss(data.toString("utf8"), { pluginKey: manifest.key, file: style });
    if (!css.ok) error("css_rejected", { path: style, issue: css.code, detail: css.detail ?? "" });
  }
  for (const script of manifest.client.scripts) if (!files.has(script)) error("asset_missing", { path: script });

  const platform = ctx.platformVersion ?? GCS_PLATFORM_VERSION;
  if (manifest.minGcs && compareSemver(parseSemver(manifest.minGcs)!, parseSemver(platform)!) > 0) {
    error("incompatible_gcs", { required: manifest.minGcs, current: platform });
  } else checks.push({ code: "compatible", level: "ok", params: { current: platform } });

  for (const [dep, range] of Object.entries(manifest.dependencies)) {
    const found = ctx.installed.find((p) => p.key === dep && p.status === "installed");
    if (!found) error("dependency_missing", { key: dep, range });
    else if (!satisfiesSemver(found.version, range)) error("dependency_version", { key: dep, range, found: found.version });
    else if (!found.enabled) checks.push({ code: "dependency_disabled", level: "warn", params: { key: dep } });
  }

  const existing = ctx.installed.find((p) => p.key === manifest.key);
  if (!existing) report.mode = "install";
  else if (existing.status !== "installed") {
    report.mode = "reinstall";
    report.previous = { version: existing.version, capabilities: existing.capabilities };
  } else {
    report.mode = "update";
    report.previous = { version: existing.version, capabilities: existing.capabilities };
    const prev = parseSemver(existing.version);
    if (prev && compareSemver(parseSemver(manifest.version)!, prev) <= 0) error("version_not_newer", { installed: existing.version, version: manifest.version });
  }
  report.newCapabilities = manifest.capabilities.filter((c) => !(report.previous?.capabilities ?? []).includes(c));

  const signature = verifyPluginSignature(files, ctx.trustedKeys);
  report.signature = signature;
  if (signature.status === "invalid") error("signature_invalid", { reason: signature.reason, ...(signature.keyId ? { keyId: signature.keyId } : {}) });
  else if (signature.status === "signed") checks.push({ code: "signed", level: "ok", params: { keyId: signature.keyId } });
  else {
    if (ctx.unsignedPolicy === "deny") error("unsigned_denied");
    else checks.push({ code: "unsigned", level: "warn", ...(signature.keyId ? { params: { keyId: signature.keyId } } : {}) });
    if (manifest.client.scripts.length > 0) error("client_js_unsigned");
  }
  if (manifest.capabilities.includes("templates")) checks.push({ code: "templates_reserved", level: "warn" });

  return done(files);
}
