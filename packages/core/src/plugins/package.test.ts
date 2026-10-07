import { generateSigningKey, packPlugin } from "@gcs/plugin-sdk/pack";
import { writeZip } from "@gcs/plugin-sdk/zip";
import { describe, expect, test } from "vitest";
import { testManifest, testPluginFiles, testPluginZip } from "../../test/pluginFixtures";
import { comparePluginMigrations } from "./catalog";
import { langFileError, validatePluginPackage, type GcsPluginValidateContext } from "./package";
import { trustedPluginKeys } from "./signature";
import { readPluginZip } from "./zip";

const market = generateSigningKey();
const ctx = (over: Partial<GcsPluginValidateContext> = {}): GcsPluginValidateContext => ({
  installed: [],
  trustedKeys: trustedPluginKeys(`market=${market.publicKeyBase64}`).keys,
  platformVersion: "0.6.0",
  ...over,
});
const errors = (zip: Buffer, c = ctx()) => validatePluginPackage(zip, c).report.checks.filter((x) => x.level === "error").map((x) => [x.code, x.params ?? {}]);

describe("validarea pachetului", () => {
  test("un pachet nesemnat valid: instalare, cu avertismentul „nesemnat”", () => {
    const { report, files } = validatePluginPackage(testPluginZip(), ctx());
    expect(report.ok).toBe(true);
    expect(files?.get("server.mjs")).toBeDefined();
    expect(report.mode).toBe("install");
    expect(report.signature).toEqual({ status: "unsigned" });
    expect(report.checks.map((c) => `${c.level}:${c.code}`)).toEqual(["ok:archive_ok", "ok:manifest_ok", "ok:compatible", "warn:unsigned"]);
    expect(report.newCapabilities).toEqual(["widgets"]);
  });

  test("semnat cu o cheie de încredere; modificat după semnare → respins", () => {
    const sign = { keyId: "market", privateKey: market.privateKeyPem };
    expect(validatePluginPackage(testPluginZip({ sign }), ctx()).report.checks).toContainEqual({ code: "signed", level: "ok", params: { keyId: "market" } });
    const files = testPluginFiles();
    const signedZip = packPlugin(files, { sign });
    // Re-împachetat cu un server.mjs schimbat, dar cu semnătura veche.
    const tampered = readPluginZip(signedZip);
    tampered.set("server.mjs", Buffer.from("export default {};"));
    const zip = writeZip([...tampered].map(([name, data]) => ({ name, data })));
    expect(errors(zip)).toEqual([["signature_invalid", { reason: "mismatch", keyId: "market" }]]);
  });

  test("politica `deny` refuză pachetele nesemnate; JS client cere semnătură", () => {
    expect(errors(testPluginZip(), ctx({ unsignedPolicy: "deny" }))).toEqual([["unsigned_denied", {}]]);
    const withJs = testPluginZip({
      manifest: testManifest({ capabilities: ["widgets", "client-js"], client: { scripts: ["assets/app.js"] } }),
      files: { "assets/app.js": "console.log(1)" },
    });
    expect(errors(withJs)).toEqual([["client_js_unsigned", {}]]);
  });

  test("fișierele neașteptate, manifestul lipsă sau invalid, serverul lipsă", () => {
    expect(errors(testPluginZip({ files: { "evil.sh": "rm -rf /", "node_modules/x/index.js": "1" } }))).toEqual([
      ["unexpected_file", { path: "evil.sh" }],
      ["unexpected_file", { path: "node_modules/x/index.js" }],
    ]);
    expect(errors(testPluginZip({ files: { "plugin.json": null } }))).toEqual([["manifest_missing", {}]]);
    expect(errors(testPluginZip({ files: { "plugin.json": "{nu" } }))).toEqual([["manifest_json", {}]]);
    expect(errors(testPluginZip({ manifest: testManifest({ key: "BAD" }) }))).toEqual([["manifest_invalid", { path: "key", issue: "invalid_plugin_key" }]]);
    expect(errors(testPluginZip({ files: { "server.mjs": null } }))).toEqual([["server_missing", {}]]);
  });

  test("arhiva cu zip-slip sau link simbolic nu ajunge la manifest", () => {
    expect(errors(writeZip([{ name: "../plugin.json", data: "{}" }]))).toEqual([["path_unsafe", { path: "../plugin.json" }]]);
    expect(errors(writeZip([{ name: "server.mjs", data: "/etc/passwd", mode: 0o120777 }]))).toEqual([["symlink", { path: "server.mjs" }]]);
  });

  test("textele: doar șiruri, fără taguri și acolade în afara parametrilor", () => {
    expect(langFileError({ a: { b: "Salut {name}" } })).toBeNull();
    expect(langFileError({ a: "<b>x</b>" })).toBe("markup");
    expect(langFileError({ a: "{count, plural, one {#} other {#}}" })).toBe("braces");
    expect(langFileError({ "a.b": "x" })).toBe("invalid_key");
    expect(langFileError({ a: 1 })).toBe("invalid_type");
    expect(errors(testPluginZip({ files: { "lang/ro.json": '{"x": "<script>"}' } }))).toEqual([["lang_invalid", { path: "lang/ro.json", issue: "markup" }]]);
  });

  test("migrațiile: cer `db` și trec prin SQL guard", () => {
    const sql = { "migrations/001_init.sql": "CREATE TABLE items (id serial primary key);" };
    expect(errors(testPluginZip({ files: sql }))).toEqual([["missing_capability", { capability: "db", path: "migrations/" }]]);
    const withDb = testManifest({ capabilities: ["widgets", "db"] });
    expect(validatePluginPackage(testPluginZip({ manifest: withDb, files: sql }), ctx()).report.migrations).toEqual(["001_init.sql"]);
    expect(errors(testPluginZip({ manifest: withDb, files: { "migrations/002_evil.sql": "DROP TABLE public.users;" } }))).toEqual([
      ["migration_rejected", { path: "migrations/002_evil.sql", issue: "sql_schema", detail: "public" }],
    ]);
  });

  test("migrațiile se ordonează după număr, nu alfabetic (prefixe de 3 până la 6 cifre)", () => {
    const withDb = testManifest({ capabilities: ["widgets", "db"] });
    const files = Object.fromEntries(["000100_c.sql", "1000_e.sql", "0002_b.sql", "001_a.sql", "999_d.sql", "002_a.sql"].map((n) => [`migrations/${n}`, "SELECT 1;"]));
    expect(validatePluginPackage(testPluginZip({ manifest: withDb, files }), ctx()).report.migrations).toEqual(["001_a.sql", "0002_b.sql", "002_a.sql", "000100_c.sql", "999_d.sql", "1000_e.sql"]);
    expect(["010_x.sql", "9_y.sql", "abc.sql", "010_a.sql"].sort(comparePluginMigrations)).toEqual(["9_y.sql", "010_a.sql", "010_x.sql", "abc.sql"]);
  });

  test("CSS-ul declarat trebuie să existe și să rămână în container", () => {
    const manifest = testManifest({ capabilities: ["widgets", "client-css"], client: { styles: ["assets/a.css"] } });
    expect(errors(testPluginZip({ manifest }))).toEqual([["asset_missing", { path: "assets/a.css" }]]);
    expect(errors(testPluginZip({ manifest, files: { "assets/a.css": "a { background: url(https://evil.example/x) }" } }))).toEqual([
      ["css_rejected", { path: "assets/a.css", issue: "css_url", detail: "https://evil.example/x" }],
    ]);
  });

  test("compatibilitatea, dependențele și actualizările", () => {
    expect(errors(testPluginZip({ manifest: testManifest({ minGcs: "9.0.0" }) }))).toEqual([["incompatible_gcs", { required: "9.0.0", current: "0.6.0" }]]);
    const dep = testPluginZip({ manifest: testManifest({ dependencies: { "acme.base": "^1.2.0" } }) });
    expect(errors(dep)).toEqual([["dependency_missing", { key: "acme.base", range: "^1.2.0" }]]);
    const base = (version: string, enabled = true) => ({ key: "acme.base", version, status: "installed", enabled, capabilities: [] });
    expect(errors(dep, ctx({ installed: [base("1.1.0")] }))).toEqual([["dependency_version", { key: "acme.base", range: "^1.2.0", found: "1.1.0" }]]);
    expect(errors(dep, ctx({ installed: [base("1.4.0")] }))).toEqual([]);

    const installed = { key: "acme.demo", version: "1.0.0", status: "installed", enabled: true, capabilities: ["widgets"] };
    expect(errors(testPluginZip(), ctx({ installed: [installed] }))).toEqual([["version_not_newer", { installed: "1.0.0", version: "1.0.0" }]]);
    const update = validatePluginPackage(testPluginZip({ manifest: testManifest({ version: "1.1.0", capabilities: ["widgets", "events"], events: ["post.created"] }) }), ctx({ installed: [installed] })).report;
    expect(update).toMatchObject({ ok: true, mode: "update", previous: { version: "1.0.0" }, newCapabilities: ["events"] });
    const kept = validatePluginPackage(testPluginZip(), ctx({ installed: [{ ...installed, status: "removed_kept_data", version: "2.0.0" }] })).report;
    expect(kept).toMatchObject({ ok: true, mode: "reinstall" });
  });
});

