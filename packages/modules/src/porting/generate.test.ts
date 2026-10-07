import { GcsValidationError, parsePluginManifest, readPluginZip } from "@gcs/core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { PORT_SOURCE_LIMITS, readPortArchive } from "./archive";
import { readPortSource, suggestPluginKey } from "./detect";
import { writeZip } from "@gcs/plugin-sdk/zip";
import { ADDON_FILES, addonJsonFixture, appJsonFixture, pluginXmlFixture } from "./fixtures";
import { convertPortSource } from "./generate";

const tmp = mkdtempSync(path.join(os.tmpdir(), "gcs-port-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** `node --check`: codul generat se parsează (fără să ruleze). */
function checkSyntax(code: string, name: string): void {
  const file = path.join(tmp, `${name}.mjs`);
  writeFileSync(file, code);
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}

const confirmed = { basis: "author" as const, confirmedAt: new Date("2026-10-07T10:00:00Z") };

function port(name: string, data: Buffer) {
  const source = readPortSource(readPortArchive(name, data));
  return { source, out: convertPortSource(source, { key: suggestPluginKey(source), rights: confirmed }) };
}

describe("generatorul", () => {
  test("add-on: pachetul trece de validarea instalatorului; manifestul, textele, migrația, CSS-ul, server.mjs", () => {
    const { out } = port("demo.zip", addonJsonFixture());
    expect(out.report.validation.checks.filter((c) => c.level === "error")).toEqual([]);
    expect(out.report.validation.ok).toBe(true);
    const files = readPluginZip(out.packageZip);
    expect([...files.keys()].sort()).toEqual(["README.md", "assets/style.css", "lang/en.json", "lang/ro.json", "migrations/001_init.sql", "plugin.json", "server.mjs"]);
    const manifest = JSON.parse(files.get("plugin.json")!.toString());
    expect(parsePluginManifest(manifest).ok).toBe(true);
    expect(manifest).toMatchObject({
      key: "acme.demo",
      name: "Demo Tools",
      version: "1.2.0",
      author: { name: "Acme", url: "https://acme.example" },
      icon: "fa-solid fa-star",
      capabilities: ["acp", "api", "client-css", "db", "jobs", "pages", "permissions", "settings", "widgets"],
      routes: {
        pages: [{ path: "/demo/:itemId" }],
        acp: [{ path: "/demo-items", label: "src.admin_navigation_demoItems" }],
        api: [{ path: "/demo-items", methods: ["GET"] }],
      },
      jobs: [{ key: "demoCleanup", everyMinutes: 60 }],
    });
    expect(manifest.settings.tabs.map((t: { key: string; label: string }) => [t.key, t.label])).toEqual([
      ["demo", "src.option_group_demo"],
      ["demoLook", "src.option_group_demoLook"],
    ]);
    expect(manifest.settings.tabs[0].fields[0]).toEqual({ key: "demoEnabled", label: "src.option_demoEnabled", hint: "src.option_explain_demoEnabled", type: "toggle", default: true });
    expect(manifest.settings.tabs[0].fields[1]).toMatchObject({ key: "demoLimit", type: "number", default: 20, min: 1, max: 100 });
    expect(manifest.settings.tabs[1].fields[0]).toMatchObject({ key: "demoStyle", type: "select", default: "light", options: [{ value: "light", label: "src.demo_style_light" }, { value: "dark", label: "src.demo_style_dark" }] });
    expect(manifest.permissions).toEqual([
      { key: "demo_view", scope: "group", type: "boolean", label: "src.permission_demo_view", default: { root_admin: true, admin: true } },
      { key: "demo_maxItems", scope: "group", type: "number", label: "src.permission_demo_maxItems", default: { root_admin: -1, admin: -1 } },
    ]);
    expect(manifest.menus.site).toEqual([]);
    const en = JSON.parse(files.get("lang/en.json")!.toString());
    expect(en.src.demo_hello_x).toBe("Hello, {name}! You have {count} items.");
    expect(en.src.option_explain_demoEnabled).toBe("Turns the tools on.");
    expect(JSON.parse(files.get("lang/ro.json")!.toString()).port.pending).toMatch(/portată automat/);
    expect(files.get("migrations/001_init.sql")!.toString()).toContain("CREATE TABLE acme_demo_item (");
    const server = files.get("server.mjs")!.toString();
    checkSyntax(server, "addon");
    expect(server).not.toMatch(/^\s*import\b/m);
    expect(server).toContain('"/demo/:itemId": async (input, ctx) =>');
    expect(server).toContain("html: '<div class=\"gcsp-port\">' + tpl1(data, ctx)");
    expect(server).toContain('ctx.t("src.demo_hello_x", { "name": str(get(d0, ["site","visitor","username"])), "count": str(get(d0, ["total"])) })');
    expect(out.report.todos).toBeGreaterThan(3);
    expect(out.report.automatedPercent).toBeGreaterThan(0);
    expect(out.report.automatedPercent).toBeLessThan(100);
  });

  test("arhiva rezultatului: folderul pluginului, pachetul, ORIGINAL/, PORTING.md, report.json", () => {
    const { out, source } = port("demo.zip", addonJsonFixture());
    const files = readPluginZip(out.resultZip, PORT_SOURCE_LIMITS);
    expect(files.has("acme.demo/plugin.json")).toBe(true);
    expect(files.has("acme.demo/server.mjs")).toBe(true);
    expect(files.get("acme.demo-1.2.0.zip")!.equals(out.packageZip)).toBe(true);
    for (const p of source.files.keys()) expect(files.has(`ORIGINAL/${p}`)).toBe(true);
    const md = files.get("PORTING.md")!.toString();
    expect(md).toContain("# Portarea: Demo Tools → `acme.demo`");
    expect(md).toContain("sunt autorul pluginului (2026-10-07T10:00:00.000Z)");
    expect(md).toContain("`upload/src/addons/Acme/Demo/Entity/Item.php` | model |");
    expect(JSON.parse(files.get("report.json")!.toString()).plugin).toEqual({ key: "acme.demo", name: "Demo Tools", version: "1.2.0", fileName: "acme.demo-1.2.0.zip" });
  });

  test("aplicația: paginile randează șablonul controllerului, setarea „Nelimitat”, jobul, widget-ul, meniul", () => {
    const { out } = port("arcade.tar", appJsonFixture());
    expect(out.report.validation.ok).toBe(true);
    const files = readPluginZip(out.packageZip);
    const manifest = JSON.parse(files.get("plugin.json")!.toString());
    expect(manifest.key).toBe("acme_games.arcade");
    expect(manifest.routes.pages.map((p: { path: string }) => p.path)).toEqual(["/", "/game/:id"]);
    expect(manifest.routes.acp).toEqual([{ path: "/manage/scores", label: "src.menu__arcade_manage_scores", icon: "fa-solid fa-puzzle-piece" }]);
    expect(manifest.menus.site).toEqual([{ key: "main", label: "src.app_arcade", href: "/p/acme_games.arcade", icon: "fa-solid fa-puzzle-piece" }]);
    const fields = manifest.settings.tabs[0].fields;
    expect(fields.find((f: { key: string }) => f.key === "arcade_limit")).toMatchObject({ type: "text", default: "-1" });
    expect(fields.find((f: { key: string }) => f.key === "arcade_per_page")).toMatchObject({ type: "number", default: 25, min: 1, max: 200 });
    expect(fields.find((f: { key: string }) => f.key === "arcade_mode")).toMatchObject({ type: "select", default: "daily" });
    expect(manifest.jobs.map((j: { key: string; everyMinutes: number }) => [j.key, j.everyMinutes])).toEqual([
      ["arcadeCleanup", 1440],
      ["arcadeSync", 30],
    ]);
    expect(manifest.widgets.map((w: { key: string }) => w.key)).toEqual(["topScores"]);
    const server = files.get("server.mjs")!.toString();
    checkSyntax(server, "app");
    expect(server).toContain('"/": async (input, ctx) =>');
    expect(server).toContain("tpl1(data, ctx)");
    const sql = files.get("migrations/001_init.sql")!.toString();
    expect(sql).toContain('"order" smallint NOT NULL DEFAULT 0');
    expect(out.report.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["fulltext_index", "settings_unknown", "css_dropped", "html_dropped"]));
  });

  test("pluginul XML: licența GPL în raport și în LICENSE, fără rute; pachet valid", () => {
    const { out } = port("shoutbox.xml", pluginXmlFixture());
    expect(out.report.validation.ok).toBe(true);
    expect(out.report.license.gpl).toBe(true);
    expect(out.report.notes.some((n) => n.code === "gpl")).toBe(true);
    const files = readPluginZip(out.packageZip);
    const manifest = JSON.parse(files.get("plugin.json")!.toString());
    expect(manifest).toMatchObject({ key: "jane_doe.shoutbox_lite", license: "GPL-2.0-or-later", capabilities: ["client-css", "jobs", "settings"] });
    checkSyntax(files.get("server.mjs")!.toString(), "xml");
    expect(out.report.manual.map((m) => m.kind)).toEqual(expect.arrayContaining(["hook", "settings_form", "setup", "javascript"]));
  });

  test("o sursă ostilă (nume, fraze, șabloane, rute, tabele) dă tot un pachet valid, fără cod injectat", () => {
    const evil = `Evil"); process.exit(1); //\n*/ <script>alert(1)</script> {x} ${"A".repeat(300)}`;
    const files = Object.entries(ADDON_FILES).map(([name, data]) => ({ name: `Evil/Addon/${name}`, data }));
    const replace = (name: string, data: string) => (files.find((f) => f.name === `Evil/Addon/${name}`)!.data = data);
    replace("addon.json", JSON.stringify({ title: evil, description: evil, version_string: "1.0.0 <b>", dev: evil, dev_url: "javascript:alert(1)", icon: "fa-x\" onload=\"y" }));
    replace(
      "_data/phrases.xml",
      `<phrases><phrase title="demo_items"><![CDATA[${evil}]]></phrase><phrase title="__proto__"><![CDATA[x]]></phrase><phrase title="a.b.c/../d"><![CDATA[{{ $x }} %s {0}]]></phrase></phrases>`,
    );
    replace(
      "_data/routes.xml",
      `<routes><route route_type="public" route_prefix="../../etc" controller="A:B"/><route route_type="public" route_prefix="ok&quot;);x(" controller="A:B"/></routes>`,
    );
    replace(
      "_data/options.xml",
      `<options><option option_id="__proto__" edit_format="spinbox" data_type="integer"><default_value>1e999</default_value><edit_format_params>min=5
max=1</edit_format_params></option><option option_id="x&quot;y" edit_format="radio" data_type="string"><default_value>z</default_value><edit_format_params>a={phrase:demo_items}
a=dup</edit_format_params></option></options>`,
    );
    replace(
      "_data/templates.xml",
      `<templates><template type="public" title="t&quot;);x(//"><![CDATA[<div onclick="${"x".repeat(10)}" class="a&quot;b">{$__proto__.x}{{ phrase('demo_items') }}<tpl:if is="$a">\`\${process.exit(1)}\`</tpl:if></div><tpl:foreach loop="$x" value="$constructor">{$constructor.y}</tpl:foreach>]]></template></templates>`,
    );
    replace("Setup.php", `<?php $sm->createTable('pg_catalog.users; DROP TABLE x', function (Create $table) { $table->addColumn('id"; --', 'int'); $table->addColumn('select', 'varchar', 10)->setDefault("'; DROP TABLE y; --"); });`);
    const source = readPortSource(readPortArchive("evil.zip", writeZip(files)));
    const out = convertPortSource(source, { key: suggestPluginKey(source), rights: confirmed });
    expect(out.report.validation.checks.filter((c) => c.level === "error")).toEqual([]);
    const pkg = readPluginZip(out.packageZip);
    const server = pkg.get("server.mjs")!.toString();
    checkSyntax(server, "evil");
    // Textele sursei apar doar în literali JSON sau comentarii pe un rând; niciun apel injectat nu e cod.
    expect(server).not.toMatch(/^[^/"]*process\.exit/m);
    const manifest = JSON.parse(pkg.get("plugin.json")!.toString());
    expect(manifest.name).not.toMatch(/[<>{}]/);
    expect(manifest.icon).toBe("fa-solid fa-puzzle-piece");
    expect(manifest.author).toEqual(expect.any(String));
    expect(manifest.routes.pages.map((p: { path: string }) => p.path)).toEqual(["/etc", "/ok-x"]);
    expect(pkg.get("migrations/001_init.sql")!.toString()).toContain("CREATE TABLE pg_catalog_users_drop_table_x (");
  });

  test("o cheie invalidă e refuzată; fără confirmare raportul o spune", () => {
    const source = readPortSource(readPortArchive("demo.zip", addonJsonFixture()));
    expect(() => convertPortSource(source, { key: "Bad Key", rights: null })).toThrow(GcsValidationError);
    const out = convertPortSource(source, { key: "other.name", rights: null, locale: "en" });
    expect(out.report.rights).toBeNull();
    expect(readPluginZip(out.resultZip, PORT_SOURCE_LIMITS).get("PORTING.md")!.toString()).toContain("not confirmed (analysis only)");
  });
});
