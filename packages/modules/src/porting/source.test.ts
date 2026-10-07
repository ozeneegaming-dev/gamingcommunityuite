import { GcsPluginPackageError } from "@gcs/core";
import { writeZip } from "@gcs/plugin-sdk/zip";
import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { PORT_SOURCE_LIMITS, readPortArchive, readTar } from "./archive";
import { analyzePortSource, readPortSource, suggestPluginKey } from "./detect";
import { addonJsonFixture, appJsonFixture, pluginXmlFixture, writeTar } from "./fixtures";
import { scanCreateTables, scanFormFields, scanTemplateRefs } from "./formats/php";
import { detectLicense, keyPart, toSemver } from "./text";
import { parseXml } from "./xml";

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof GcsPluginPackageError) return e.code;
    throw e;
  }
  return "ok";
};

describe("arhiva sursă", () => {
  test("TAR: fișierele, prefixul ustar, numele pax și GNU lungi; directoarele ignorate", () => {
    const tar = writeTar([
      { name: "app/", type: "5" },
      { name: "app/a.txt", data: "A" },
      { name: "x", data: "lung", pax: { path: `app/${"d".repeat(120)}.txt` } },
      { name: "././@LongLink", data: `app/${"g".repeat(110)}.txt\0`, type: "L" },
      { name: "ignored", data: "gnu" },
    ]);
    const files = readTar(tar);
    expect([...files.keys()]).toEqual(["app/a.txt", `app/${"d".repeat(120)}.txt`, `app/${"g".repeat(110)}.txt`]);
    expect(files.get(`app/${"g".repeat(110)}.txt`)!.toString()).toBe("gnu");
    // gzip-ul e recunoscut după conținut.
    expect(readPortArchive("x.tgz", gzipSync(tar)).files.size).toBe(3);
  });

  test("TAR: căi nesigure, link-uri, intrări speciale, duplicate și sume de control greșite sunt refuzate", () => {
    expect(code(() => readTar(writeTar([{ name: "../etc/passwd", data: "x" }])))).toBe("path_unsafe");
    expect(code(() => readTar(writeTar([{ name: "/abs.txt", data: "x" }])))).toBe("path_unsafe");
    expect(code(() => readTar(writeTar([{ name: "a\\b.txt", data: "x" }])))).toBe("path_unsafe");
    expect(code(() => readTar(writeTar([{ name: "x", data: "", pax: { path: "a/../../b" } }])))).toBe("path_unsafe");
    expect(code(() => readTar(writeTar([{ name: "link", type: "2", linkname: "/etc/passwd" }])))).toBe("symlink");
    expect(code(() => readTar(writeTar([{ name: "hard", type: "1", linkname: "a" }])))).toBe("symlink");
    expect(code(() => readTar(writeTar([{ name: "dev", type: "3" }])))).toBe("special_file");
    expect(code(() => readTar(writeTar([{ name: "a.txt", data: "1" }, { name: "A.txt", data: "2" }])))).toBe("duplicate_path");
    expect(code(() => readTar(writeTar([{ name: "a", data: "1" }, { name: "a/b", data: "2" }])))).toBe("duplicate_path");
    expect(code(() => readTar(writeTar([{ name: "a/b", data: "1" }, { name: "a", data: "2" }])))).toBe("duplicate_path");
    expect(code(() => readTar(writeTar([{ name: "a.txt", data: "1", checksum: 1 }])))).toBe("zip_crc");
    // O mărime declarată mai mare decât arhiva: trunchiată.
    expect(code(() => readTar(writeTar([{ name: "a.txt", data: "1", size: 99999 }])))).toBe("zip_invalid");
  });

  test("TAR: limitele de mărime și număr, inclusiv după gzip (bombă)", () => {
    const small = { ...PORT_SOURCE_LIMITS, maxFiles: 2, maxFileBytes: 100, maxTotalBytes: 150 };
    expect(code(() => readTar(writeTar([{ name: "a", data: "1" }, { name: "b", data: "2" }, { name: "c", data: "3" }]), small))).toBe("too_many_files");
    expect(code(() => readTar(writeTar([{ name: "a", data: "x".repeat(101) }]), small))).toBe("file_too_large");
    expect(code(() => readTar(writeTar([{ name: "a", data: "x".repeat(90) }, { name: "b", data: "y".repeat(90) }]), small))).toBe("total_too_large");
    const bomb = gzipSync(writeTar([{ name: "a", data: Buffer.alloc(PORT_SOURCE_LIMITS.maxTotalBytes + 5 * 1024 * 1024) }]));
    expect(bomb.length).toBeLessThan(PORT_SOURCE_LIMITS.maxArchiveBytes);
    expect(code(() => readTar(bomb))).toBe("total_too_large");
  });

  test("ZIP: cititorul întărit al pluginurilor; fișierele de sistem ignorate; tip necunoscut refuzat", () => {
    const zip = writeZip([
      { name: "a/addon.json", data: "{}" },
      { name: "__MACOSX/a/._addon.json", data: "x" },
      { name: "a/.DS_Store", data: "x" },
    ]);
    expect([...readPortArchive("a.zip", zip).files.keys()]).toEqual(["a/addon.json"]);
    expect(code(() => readPortArchive("a.zip", writeZip([{ name: "../a.php", data: "x" }])))).toBe("path_unsafe");
    expect(code(() => readPortArchive("a.zip", writeZip([{ name: "l", data: "/etc", mode: 0o120777 }])))).toBe("symlink");
    expect(code(() => readPortArchive("a.bin", Buffer.from("not an archive")))).toBe("unknown_archive");
    expect(code(() => readPortArchive("a.zip", Buffer.alloc(PORT_SOURCE_LIMITS.maxArchiveBytes + 1)))).toBe("archive_too_large");
  });

  test("XML: un singur fișier, cu numele curățat", () => {
    const archive = readPortArchive("../my plugin.xml", pluginXmlFixture());
    expect(archive.kind).toBe("xml");
    expect([...archive.files.keys()]).toEqual(["my_plugin.xml"]);
  });
});

describe("XML și textul", () => {
  test("CDATA, entitățile XML; fără DTD și fără entități externe", () => {
    const root = parseXml(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a k="1 &amp; 2"><b><![CDATA[<i>x</i>]]></b><c>&xxe;&lt;</c></a>`)!;
    expect(root.attrs.k).toBe("1 & 2");
    expect(root.children[0]!.text).toBe("<i>x</i>");
    expect(root.children[1]!.text).not.toContain("root:");
    expect(root.children[1]!.text).toContain("<");
  });

  test("XML adânc: adâncimea e plafonată (fără depășirea stivei)", () => {
    const deep = `${"<a>".repeat(20000)}x${"</a>".repeat(20000)}`;
    expect(parseXml(deep)!.name).toBe("a");
  });

  test("cheile, versiunile și licența", () => {
    expect(keyPart("MyAddOn")).toBe("my_add_on");
    expect(keyPart("Cool Stuff!")).toBe("cool_stuff");
    expect(keyPart("123 go")).toBe("p_123_go");
    expect(keyPart("x".repeat(40))).toHaveLength(24);
    expect(toSemver("1.2")).toBe("1.2.0");
    expect(toSemver("1.0.0 Beta 2")).toBe("1.0.0-beta.2");
    expect(toSemver("garbage")).toBe("1.0.0");
    const files = new Map([
      ["LICENSE", Buffer.from("GNU GENERAL PUBLIC LICENSE\nVersion 3")],
      ["a.php", Buffer.from("<?php // nimic")],
    ]);
    expect(detectLicense(files)).toEqual({ spdx: "GPL", gpl: true, files: ["LICENSE"] });
    expect(detectLicense(new Map([["LICENSE.md", Buffer.from("MIT License\nPermission is hereby granted, free of charge")]]))).toEqual({ spdx: "MIT", gpl: false, files: ["LICENSE.md"] });
  });
});

describe("PHP citit ca text", () => {
  test("câmpurile formularelor de setări (tip, opțiuni, limite)", () => {
    const fields = scanFormFields(`$form->add( new \\X\\Helpers\\Form\\Select( 'mode', 'a', TRUE, array( 'options' => array( 'a' => 'lang_a', "b" => 'lang_b' ) ) ) );
      $form->add( new Form\\Number( 'n', 5, FALSE, [ 'min' => 1, 'max' => 9 ] ) ); $form->add(new \\X\\Form\\Upload('file'));`);
    expect(fields).toEqual([
      { key: "mode", type: "select", options: [{ value: "a", label: "lang_a" }, { value: "b", label: "lang_b" }] },
      { key: "n", type: "number", min: 1, max: 9 },
      { key: "file", type: "unknown" },
    ]);
  });

  test("tabelele din codul de instalare și legăturile spre șabloane", () => {
    const tables = scanCreateTables(
      `$sm->createTable('t_one', function (Create $table) { $table->addColumn('id', 'int')->autoIncrement(); $table->addColumn('name', 'varchar', 50)->setDefault('a;b'); $table->addPrimaryKey('id'); $table->addUniqueKey(['name', 'id'], 'n_id'); });
       $tables['t_two'] = function (Create $table) { $table->addColumn('v', 'text')->nullable(); };`,
      "Setup.php",
    );
    expect(tables.map((t) => t.name)).toEqual(["t_one", "t_two"]);
    expect(tables[0]!.columns).toEqual([
      { name: "id", type: "int", nullable: false, unsigned: true, autoIncrement: true },
      { name: "name", type: "varchar", nullable: false, unsigned: false, length: 50, default: "a;b" },
    ]);
    expect(tables[0]!.indexes).toEqual([
      { kind: "primary", name: "id", columns: ["id"] },
      { kind: "unique", name: "n_id", columns: ["name", "id"] },
    ]);
    expect(tables[1]!.columns[0]).toMatchObject({ name: "v", nullable: true });
    expect(scanTemplateRefs(`getTemplate( 'scores', 'arcade', 'admin' )->list( $x ); $this->view('A:B', 'demo_view', []);`)).toEqual(["admin/scores/list", "demo_view"]);
  });
});

describe("formatele", () => {
  test("app-json: manifestul, setările (tipul din formulare), rutele, schema, șabloanele, CSS-ul, task-urile", () => {
    const source = readPortSource(readPortArchive("arcade.tar", appJsonFixture()));
    expect(source.format).toBe("app-json");
    expect(source.meta).toMatchObject({ id: "arcade", name: "Arcade Scores", version: "1.2.3", author: "Acme Games", url: "https://acme.example/arcade" });
    expect(source.settings.map((s) => [s.key, s.type])).toEqual([
      ["arcade_enabled", "toggle"],
      ["arcade_per_page", "number"],
      ["arcade_mode", "select"],
      ["arcade_welcome", "textarea"],
      ["arcade_limit", "unknown"],
    ]);
    expect(source.routes.map((r) => [r.area, r.path, r.controller ?? null])).toEqual([
      ["site", "/", "modules/front/scores/index.php"],
      ["site", "/game/:id", "modules/front/scores/game.php"],
      ["acp", "/manage/scores", "modules/admin/manage/scores.php"],
    ]);
    expect(source.views.get("modules/front/scores/index.php")).toBe("front/scores/index");
    expect(source.tables[0]!.name).toBe("arcade_scores");
    expect(source.templates.map((t) => t.name)).toEqual(["front/scores/index", "front/scores/row", "admin/manage/list"]);
    expect(source.templates[0]!.params).toEqual(["scores", "title"]);
    expect(source.styles).toHaveLength(1);
    expect(source.tasks).toEqual([
      { key: "arcadeCleanup", everyMinutes: 1440, origin: "data/tasks.json" },
      { key: "arcadeSync", everyMinutes: 30, origin: "data/tasks.json" },
    ]);
    expect(source.widgets.map((w) => w.key)).toEqual(["topScores"]);
    expect(source.phrases.get("arcade_title")).toBe("Top scores");
    expect(source.code.find((c) => c.path === "modules/admin/manage/scores.php")!.kind).toBe("settings_form");
    expect(source.code.find((c) => c.path === "extensions/core/MemberSync/Arcade.php")!.kind).toBe("extension");
    expect(source.code.find((c) => c.path === "dev/js/front/arcade.js")!.kind).toBe("javascript");
    expect(suggestPluginKey(source)).toBe("acme_games.arcade");
    expect(source.license.gpl).toBe(false);
  });

  test("plugin-xml: fișierele încorporate, setările, frazele, task-urile și licența GPL din antet", () => {
    const source = readPortSource(readPortArchive("shoutbox.xml", pluginXmlFixture()));
    expect(source.format).toBe("plugin-xml");
    expect(source.meta).toMatchObject({ name: "Shoutbox Lite", version: "1.1.0", author: "Jane Doe" });
    expect([...source.files.keys()].sort()).toEqual(["css/shoutbox.css", "hooks/globalTemplate.php", "html/shoutbox.phtml", "js/shoutbox.js", "settings.php", "setup/10000.php", "shoutbox.xml"]);
    expect(source.settings.map((s) => [s.key, s.type, s.default])).toEqual([
      ["shout_max", "number", "50"],
      ["shout_guests", "toggle", "0"],
    ]);
    expect(source.templates[0]).toMatchObject({ name: "plugins/shoutbox", params: ["shouts"] });
    expect(source.tasks).toEqual([{ key: "shoutPrune", everyMinutes: 60, origin: "shoutbox.xml" }]);
    expect(source.license).toMatchObject({ gpl: true, spdx: "GPL-2.0-or-later" });
    expect(suggestPluginKey(source)).toBe("jane_doe.shoutbox_lite");
    // Același plugin, într-un `.zip` cu documentație alături.
    const zipped = readPortSource(readPortArchive("s.zip", writeZip([{ name: "shoutbox.xml", data: pluginXmlFixture() }, { name: "README.txt", data: "citește" }])));
    expect(zipped.format).toBe("plugin-xml");
    expect(zipped.files.has("README.txt")).toBe(true);
  });

  test("addon-json: opțiunile, permisiunile, rutele (site, ACP, API), navigarea, șabloanele, schema din Setup.php", () => {
    const source = readPortSource(readPortArchive("demo.zip", addonJsonFixture()));
    expect(source.format).toBe("addon-json");
    expect(source.meta).toMatchObject({ id: "Acme/Demo", name: "Demo Tools", version: "1.2.0", author: "Acme", icon: "fa-star" });
    expect(source.settings.map((s) => [s.key, s.type, s.group])).toEqual([
      ["demoEnabled", "toggle", "demo"],
      ["demoLimit", "number", "demo"],
      ["demoStyle", "select", "demoLook"],
      ["demoNote", "textarea", "demoLook"],
      ["demoCallback", "unknown", "demo"],
    ]);
    expect(source.settings[1]).toMatchObject({ min: 1, max: 100 });
    expect(source.settings[2]!.options).toEqual([
      { value: "light", label: "demo_style_light" },
      { value: "dark", label: "demo_style_dark" },
    ]);
    expect(source.permissions).toEqual([
      { key: "demo_view", type: "boolean", labelPhrase: "permission.demo_view", group: "demo" },
      { key: "demo_maxItems", type: "number", labelPhrase: "permission.demo_maxItems", group: "demo" },
    ]);
    const root = "upload/src/addons/Acme/Demo/";
    expect(source.routes.map((r) => [r.area, r.path, r.controller, r.labelPhrase ?? null])).toEqual([
      ["site", "/demo/:itemId", `${root}Pub/Controller/Item.php`, null],
      ["acp", "/demo-items", `${root}Admin/Controller/Item.php`, "admin_navigation.demoItems"],
      ["api", "/demo-items", `${root}Api/Controller/Items.php`, null],
    ]);
    expect(source.menus).toEqual([{ area: "site", key: "demoTab", route: "/demo/:itemId", labelPhrase: "nav.demoTab" }]);
    expect(source.views.get(`${root}Pub/Controller/Item.php`)).toBe("public:demo_item_list");
    expect(source.views.get(`${root}Admin/Controller/Item.php`)).toBe("admin:demo_admin_list");
    expect(source.templates.map((t) => t.name)).toEqual(["public:demo_item_list", "public:demo_macros", "admin:demo_admin_list"]);
    expect(source.styles.map((s) => s.name)).toEqual(["demo.less"]);
    expect(source.tasks).toEqual([{ key: "demoCleanup", everyMinutes: 60, origin: "_data/cron.xml" }]);
    expect(source.tables.map((t) => [t.name, t.columns.length])).toEqual([["acme_demo_item", 6]]);
    const kinds = Object.fromEntries(source.code.map((c) => [c.path.replace(root, ""), c.kind]));
    expect(kinds).toMatchObject({
      "Pub/Controller/Item.php": "controller",
      "Admin/Controller/Item.php": "acp_controller",
      "Api/Controller/Items.php": "api_controller",
      "Entity/Item.php": "model",
      "Cron/Cleanup.php": "task",
      "Base/Entity/User.php": "extension",
      "Listener.php": "listener",
      "Setup.php": "setup",
      "upload/js/acme/demo/demo.js": "javascript",
    });
    expect(suggestPluginKey(source)).toBe("acme.demo");
    expect(analyzePortSource(source).counts).toMatchObject({ settings: 5, permissions: 2, routes: 3, tables: 1, templates: 3, styles: 1, tasks: 1, widgets: 1, javascript: 1 });
  });

  test("metadatele ajung în analiză curățate: pe un rând, plafonate, linkuri doar http(s)", () => {
    const zip = writeZip([
      { name: "A/B/addon.json", data: JSON.stringify({ title: `Nume\nlung ${"x".repeat(5000)}`, description: "d".repeat(100_000), dev_url: "javascript:alert(1)", version_string: "1.0.0" }), method: 0 },
      { name: "A/B/_data/phrases.xml", data: "<phrases/>" },
    ]);
    const meta = readPortSource(readPortArchive("a.zip", zip)).meta;
    expect(meta.name).not.toContain("\n");
    expect(meta.name.length).toBeLessThanOrEqual(200);
    expect(meta.description.length).toBe(2000);
    expect(meta.url).toBeNull();
  });

  test("o arhivă fără niciun format cunoscut e refuzată", () => {
    expect(code(() => readPortSource(readPortArchive("x.zip", writeZip([{ name: "readme.txt", data: "x" }]))))).toBe("unknown_format");
    expect(code(() => readPortSource(readPortArchive("x.xml", Buffer.from("<?xml version='1.0'?><other/>"))))).toBe("unknown_format");
  });
});
