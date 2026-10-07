/**
 * Sursele de test ale asistentului de portare: câte un exemplu mic din fiecare format (aplicație `.tar`, plugin `.xml`,
 * add-on `.zip`), cu setări, fraze, permisiuni, rute, schemă, șabloane, CSS, task-uri și cod PHP. Folosite de testele
 * unitare și de integrare și de E2E. Numele (vendor `Acme`, add-on `Demo`) sunt neutre.
 */
import { writeZip, type GcsZipEntryInput } from "@gcs/plugin-sdk/zip";

export type GcsTarEntryInput = { name: string; data?: string | Buffer; type?: string; linkname?: string; mode?: number; pax?: Record<string, string>; checksum?: number; size?: number };

function octalField(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

/** O arhivă TAR (ustar) minimă, pentru teste; `checksum`/`size` suprascriu valorile calculate. */
export function writeTar(entries: GcsTarEntryInput[]): Buffer {
  const blocks: Buffer[] = [];
  const header = (e: GcsTarEntryInput, name: string, size: number, type: string) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0, "utf8");
    h.write(octalField(e.mode ?? 0o644, 8), 100, "latin1");
    h.write(octalField(0, 8), 108, "latin1");
    h.write(octalField(0, 8), 116, "latin1");
    h.write(octalField(e.size ?? size, 12), 124, "latin1");
    h.write(octalField(0, 12), 136, "latin1");
    h.write("        ", 148, "latin1");
    h.write(type, 156, "latin1");
    if (e.linkname) h.write(e.linkname, 157, "utf8");
    h.write("ustar\0", 257, "latin1");
    h.write("00", 263, "latin1");
    let sum = 0;
    for (const b of h) sum += b;
    h.write(octalField(e.checksum ?? sum, 7), 148, "latin1");
    return h;
  };
  const pad = (data: Buffer) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
  for (const e of entries) {
    if (e.pax) {
      const body = Buffer.from(
        Object.entries(e.pax)
          .map(([k, v]) => {
            const rec = ` ${k}=${v}\n`;
            let len = rec.length + 1;
            while (String(len).length + rec.length !== len) len = String(len).length + rec.length;
            return `${len}${rec}`;
          })
          .join(""),
        "utf8",
      );
      blocks.push(header({ name: "PaxHeader" }, "PaxHeader", body.length, "x"), pad(body));
    }
    const data = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : (e.data ?? Buffer.alloc(0));
    blocks.push(header(e, e.name, data.length, e.type ?? "0"));
    if (data.length) blocks.push(pad(data));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

// ─── `app-json`: aplicația „Arcade Scores” (`arcade`) ───

const APP_FILES: Record<string, string> = {
  "data/application.json": JSON.stringify({ application_title: "Arcade Scores", app_author: "Acme Games", app_directory: "arcade", app_website: "https://acme.example/arcade" }),
  "data/versions.json": JSON.stringify({ "10000": "1.0.0", "10203": "1.2.3" }),
  "data/settings.json": JSON.stringify([
    { key: "arcade_enabled", default: "1" },
    { key: "arcade_per_page", default: "25" },
    { key: "arcade_mode", default: "daily" },
    { key: "arcade_welcome", default: "Bine ai venit!" },
    { key: "arcade_limit", default: "-1" },
  ]),
  "data/modules.json": JSON.stringify({ front: { scores: { default: true } }, admin: { manage: { default: true } } }),
  "data/acpmenu.json": JSON.stringify({ manage: { scores: { tab: "arcade", controller: "scores", restriction: "scores_manage" } } }),
  "data/furl.json": JSON.stringify({
    topLevel: "arcade",
    pages: {
      arcade_index: { friendly: "", real: "app=arcade&module=scores&controller=index" },
      arcade_game: { friendly: "game/{#id}-{?}", real: "app=arcade&module=scores&controller=game" },
    },
  }),
  "data/schema.json": JSON.stringify({
    arcade_scores: {
      name: "arcade_scores",
      columns: {
        id: { name: "id", type: "BIGINT", length: 20, unsigned: true, allow_null: false, default: null, auto_increment: true },
        member_id: { name: "member_id", type: "INT", length: 10, unsigned: true, allow_null: false, default: "0" },
        game: { name: "game", type: "VARCHAR", length: 120, allow_null: false, default: "" },
        score: { name: "score", type: "DECIMAL", length: 10, decimals: 2, allow_null: true, default: null },
        mode: { name: "mode", type: "ENUM", values: ["daily", "weekly"], allow_null: false, default: "daily" },
        order: { name: "order", type: "TINYINT", length: 1, allow_null: false, default: "0" },
        created: { name: "created", type: "DATETIME", allow_null: true },
        meta: { name: "meta", type: "MEDIUMTEXT", allow_null: true },
      },
      indexes: {
        PRIMARY: { type: "primary", name: "PRIMARY", columns: ["id"] },
        member: { type: "key", name: "member", columns: ["member_id", "game"] },
        game_unique: { type: "unique", name: "game_unique", columns: ["game", "member_id"] },
        search: { type: "fulltext", name: "search", columns: ["game"] },
      },
    },
  }),
  "data/lang.xml": `<?xml version="1.0" encoding="UTF-8"?>
<language><app key="arcade" version="10203">
<word key="__app_arcade" js="0">Arcade Scores</word>
<word key="arcade_enabled" js="0">Enable the arcade</word>
<word key="arcade_enabled_desc" js="0">Shows the &lt;b&gt;arcade&lt;/b&gt; page.</word>
<word key="arcade_per_page" js="0">Scores per page</word>
<word key="arcade_mode" js="0">Ranking mode</word>
<word key="arcade_mode_daily" js="0">Daily</word>
<word key="arcade_mode_weekly" js="0">Weekly</word>
<word key="arcade_welcome" js="0">Welcome text</word>
<word key="arcade_limit" js="0">Limit</word>
<word key="arcade_title" js="0">Top scores</word>
<word key="arcade_by" js="0">Score by %s on %s</word>
<word key="arcade_empty" js="0">No {scores} yet.</word>
<word key="menu__arcade_manage_scores" js="0">Manage scores</word>
<word key="block_topScores" js="0">Top scores block</word>
</app></language>`,
  "data/theme.xml": `<?xml version="1.0" encoding="UTF-8"?>
<theme name="Default" author_name="Acme">
<template template_group="scores" template_name="index" template_data="$scores, $title" template_location="front" template_app="arcade"><![CDATA[<div class="arcadeBox" id="arcadeTop" style="color:red" onclick="alert(1)">
<h1>{lang="arcade_title"}</h1>
{{if \\count( $scores )}}
<ul class="arcadeList">
{{foreach $scores as $score}}
<li data-score="{$score->id}"><i class="fa fa-trophy"></i> {$score->game}: {number="$score->score"} {lang="arcade_by" sprintf="$score->member, $score->date"}</li>
{{endforeach}}
</ul>
{{else}}
<p class="typeLight">{lang="arcade_empty"}</p>
{{endif}}
{{if $score->member_id > 5 AND $x}}<b>big</b>{{endif}}
<a href="{url="app=arcade&module=scores&controller=index" seoTemplate="arcade_index"}">{setting="arcade_welcome"}</a>
{template="row" group="scores" app="arcade" params="$scores"}
<script>alert("x")</script>
</div>]]></template>
<template template_group="scores" template_name="row" template_data="$scores" template_location="front" template_app="arcade"><![CDATA[<span class="arcadeRow">{$scores}</span>]]></template>
<template template_group="manage" template_name="list" template_data="" template_location="admin" template_app="arcade"><![CDATA[<div>{lang="menu__arcade_manage_scores"}</div>]]></template>
<css css_location="front" css_app="arcade" css_path="." css_name="arcade.css"><![CDATA[.arcadeBox { padding: 10px; color: #333; }
#arcadeTop .arcadeList > li { margin: 0 }
.arcadeIcon:before { content: "\\f091"; }
.arcadeBg { background: url({resource="bg.png" app="arcade" location="front"}) no-repeat; }
@import url("https://evil.example/x.css");
@media (max-width: 600px) { .arcadeBox { padding: 4px } }
@keyframes spin { from { opacity: 0 } to { opacity: 1 } }]]></css>
</theme>`,
  "data/tasks.json": JSON.stringify({ arcadeCleanup: "P1D", arcadeSync: "PT30M" }),
  "data/widgets.json": JSON.stringify({ topScores: { class: "\\Acme\\Widget", restrict: ["sidebar"], default_area: "sidebar" } }),
  "modules/front/scores/index.php": `<?php
namespace Acme\\Arcade\\modules\\front\\scores;
class index extends \\Acme\\Dispatcher\\Controller {
  protected function manage() {
    $scores = \\Acme\\Db::i()->select( '*', 'arcade_scores' );
    \\Acme\\Output::i()->output = \\Acme\\Theme::i()->getTemplate( 'scores' )->index( $scores, 'Top' );
  }
}`,
  "modules/front/scores/game.php": `<?php
class game { function manage() { echo 1; } }`,
  "modules/admin/manage/scores.php": `<?php
class scores {
  protected function manage() {
    $form = new \\Acme\\Helpers\\Form;
    $form->add( new \\Acme\\Helpers\\Form\\YesNo( 'arcade_enabled', \\Acme\\Settings::i()->arcade_enabled ) );
    $form->add( new \\Acme\\Helpers\\Form\\Number( 'arcade_per_page', 25, FALSE, array( 'min' => 1, 'max' => 200 ) ) );
    $form->add( new \\Acme\\Helpers\\Form\\Select( 'arcade_mode', 'daily', TRUE, array( 'options' => array( 'daily' => 'arcade_mode_daily', 'weekly' => 'arcade_mode_weekly' ) ) ) );
    $form->add( new \\Acme\\Helpers\\Form\\TextArea( 'arcade_welcome', '' ) );
  }
}`,
  "sources/Score/Score.php": "<?php\nclass Score extends \\Acme\\Patterns\\ActiveRecord {\n  public static $databaseTable = 'arcade_scores';\n}\n",
  "extensions/core/MemberSync/Arcade.php": "<?php\nclass Arcade { public function onDelete( $member ) {} }\n",
  "hooks/postbit.php": "<?php\nclass hook1 { }\n",
  "tasks/arcadeCleanup.php": "<?php\nclass arcadeCleanup { public function execute() {} }\n",
  "dev/js/front/arcade.js": "(function(){ console.log('arcade'); })();\n",
  "LICENSE.txt": "Copyright Acme Games. All rights reserved.\n",
};

/** Aplicația de test, ca arhivă `.tar` (cu folderul `arcade/` în rădăcină). */
export function appJsonFixture(): Buffer {
  return writeTar(Object.entries(APP_FILES).map(([name, data]) => ({ name: `arcade/${name}`, data })));
}

// ─── `plugin-xml`: pluginul „Shoutbox Lite” ───

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** Pluginul de test, ca fișier `.xml` (cod PHP GPL în antet, ca să testăm avertismentul). */
export function pluginXmlFixture(): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<plugin name="Shoutbox Lite" version_long="10100" version_human="1.1.0" author="Jane Doe" website="https://jane.example" update_check="">
<hooks><hook type="C" class="\\Acme\\Theme\\class_core_front_global" filename="globalTemplate"><![CDATA[<?php
/* SPDX-License-Identifier: GPL-2.0-or-later */
class hook2 extends _HOOK_CLASS_ { }]]></hook></hooks>
<settings><setting><key>shout_max</key><default>50</default></setting><setting><key>shout_guests</key><default>0</default></setting></settings>
<settingsCode><![CDATA[<?php
$form->add( new \\Acme\\Helpers\\Form\\Number( 'shout_max', \\Acme\\Settings::i()->shout_max, FALSE, array( 'min' => 1, 'max' => 500 ) ) );
$form->add( new \\Acme\\Helpers\\Form\\YesNo( 'shout_guests', \\Acme\\Settings::i()->shout_guests ) );]]></settingsCode>
<htmlFiles><html filename="shoutbox.phtml">${b64('<acme:template parameters="$shouts" />\n<div class="shoutbox">{{foreach $shouts as $id => $s}}<p>{$s.text}</p>{{endforeach}}</div>')}</html></htmlFiles>
<cssFiles><css filename="shoutbox.css">${b64(".shoutbox { max-height: 300px; overflow: auto; }")}</css></cssFiles>
<jsFiles><js filename="shoutbox.js">${b64("console.log('shout');")}</js></jsFiles>
<lang><word key="shout_max" js="0">Maximum shouts</word><word key="shout_guests" js="0">Guests can shout</word></lang>
<versions><version long="10000" human="1.0.0"><![CDATA[<?php
class demo_setup_install { }]]></version></versions>
<tasks><task key="shoutPrune" frequency="PT1H"/></tasks>
</plugin>`,
    "utf8",
  );
}

// ─── `addon-json`: add-on-ul „Acme/Demo” ───

export const ADDON_FILES: Record<string, string> = {
  "addon.json": JSON.stringify({ title: "Demo Tools", description: "Unelte demo.", version_id: 1020070, version_string: "1.2.0", dev: "Acme", dev_url: "https://acme.example", icon: "fa-star" }),
  "_data/options.xml": `<?xml version="1.0" encoding="utf-8"?>
<options>
  <option option_id="demoEnabled" edit_format="onoff" data_type="boolean" advanced="0"><default_value>1</default_value><edit_format_params></edit_format_params><sub_options></sub_options><relation group_id="demo" display_order="10"/></option>
  <option option_id="demoLimit" edit_format="spinbox" data_type="unsigned_integer" advanced="0"><default_value>20</default_value><edit_format_params>min=1
max=100</edit_format_params><sub_options></sub_options><relation group_id="demo" display_order="20"/></option>
  <option option_id="demoStyle" edit_format="radio" data_type="string" advanced="0"><default_value>light</default_value><edit_format_params>light={phrase:demo_style_light}
dark={phrase:demo_style_dark}</edit_format_params><sub_options></sub_options><relation group_id="demoLook" display_order="10"/></option>
  <option option_id="demoNote" edit_format="textbox" data_type="string" advanced="0"><default_value></default_value><edit_format_params>rows=4</edit_format_params><sub_options></sub_options><relation group_id="demoLook" display_order="20"/></option>
  <option option_id="demoCallback" edit_format="callback" data_type="string" advanced="0"><default_value></default_value><edit_format_params>Acme\\Demo\\Option\\Thing::render</edit_format_params><sub_options></sub_options><relation group_id="demo" display_order="30"/></option>
</options>`,
  "_data/option_groups.xml": `<?xml version="1.0" encoding="utf-8"?>
<option_groups><group group_id="demo" icon="fa-cog" display_order="100" advanced="0" debug_only="0"/><group group_id="demoLook" icon="" display_order="110" advanced="0" debug_only="0"/></option_groups>`,
  "_data/phrases.xml": `<?xml version="1.0" encoding="utf-8"?>
<phrases>
  <phrase title="option.demoEnabled" version_id="1" version_string="1.0.0"><![CDATA[Enable demo tools]]></phrase>
  <phrase title="option_explain.demoEnabled" version_id="1" version_string="1.0.0"><![CDATA[Turns the <a href="x">tools</a> on.]]></phrase>
  <phrase title="option.demoLimit" version_id="1" version_string="1.0.0"><![CDATA[Items per page]]></phrase>
  <phrase title="option.demoStyle" version_id="1" version_string="1.0.0"><![CDATA[Style]]></phrase>
  <phrase title="demo_style_light" version_id="1" version_string="1.0.0"><![CDATA[Light]]></phrase>
  <phrase title="demo_style_dark" version_id="1" version_string="1.0.0"><![CDATA[Dark]]></phrase>
  <phrase title="option.demoNote" version_id="1" version_string="1.0.0"><![CDATA[Note]]></phrase>
  <phrase title="option_group.demo" version_id="1" version_string="1.0.0"><![CDATA[Demo tools]]></phrase>
  <phrase title="option_group.demoLook" version_id="1" version_string="1.0.0"><![CDATA[Look]]></phrase>
  <phrase title="permission.demo_view" version_id="1" version_string="1.0.0"><![CDATA[Can view demo items]]></phrase>
  <phrase title="permission.demo_maxItems" version_id="1" version_string="1.0.0"><![CDATA[Maximum items]]></phrase>
  <phrase title="admin_navigation.demoItems" version_id="1" version_string="1.0.0"><![CDATA[Demo items]]></phrase>
  <phrase title="nav.demoTab" version_id="1" version_string="1.0.0"><![CDATA[Demo]]></phrase>
  <phrase title="demo_items" version_id="1" version_string="1.0.0"><![CDATA[Demo items]]></phrase>
  <phrase title="demo_hello_x" version_id="1" version_string="1.0.0"><![CDATA[Hello, {name}! You have {count} items.]]></phrase>
  <phrase title="demo_no_items" version_id="1" version_string="1.0.0"><![CDATA[There are no items yet.]]></phrase>
  <phrase title="widget_def.demo_latest" version_id="1" version_string="1.0.0"><![CDATA[Latest demo items]]></phrase>
</phrases>`,
  "_data/permissions.xml": `<?xml version="1.0" encoding="utf-8"?>
<permissions>
  <permission_groups><permission_group permission_group_id="demo"/></permission_groups>
  <permissions>
    <permission permission_group_id="demo" permission_id="view" permission_type="flag" interface_group_id="demoIface" display_order="10"/>
    <permission permission_group_id="demo" permission_id="maxItems" permission_type="integer" interface_group_id="demoIface" display_order="20"/>
  </permissions>
  <interface_groups><interface_group interface_group_id="demoIface" display_order="100"/></interface_groups>
</permissions>`,
  "_data/routes.xml": `<?xml version="1.0" encoding="utf-8"?>
<routes>
  <route route_type="public" route_prefix="demo" format=":int&lt;item_id&gt;/" controller="Acme\\Demo:Item" context="demo"/>
  <route route_type="admin" route_prefix="demo-items" controller="Acme\\Demo:Item" context="demoItems"/>
  <route route_type="api" route_prefix="demo-items" controller="Acme\\Demo:Items"/>
</routes>`,
  "_data/admin_navigation.xml": `<?xml version="1.0" encoding="utf-8"?>
<admin_navigation><navigation navigation_id="demoItems" parent_navigation_id="content" display_order="100" link="demo-items" icon="fa-star" admin_permission_id="" debug_only="0" development_only="0" hide_no_children="0"/></admin_navigation>`,
  "_data/navigation.xml": `<?xml version="1.0" encoding="utf-8"?>
<navigation><navigation navigation_id="demoTab" parent_navigation_id="" display_order="100" navigation_type_id="basic" enabled="1"><![CDATA[{"link":"{{ link('demo') }}","display_condition":"","extra_attributes":[]}]]></navigation></navigation>`,
  "_data/templates.xml": `<?xml version="1.0" encoding="utf-8"?>
<templates>
  <template type="public" title="demo_item_list" version_id="1" version_string="1.0.0"><![CDATA[<tpl:title>{{ phrase('demo_items') }}</tpl:title>
<tpl:css src="demo.less" />
<div class="block demoList" data-init="demo">
  <p>{{ phrase('demo_hello_x', {'name': $site.visitor.username, 'count': $total}) }}</p>
  <tpl:if is="$items is not empty">
    <ul>
    <tpl:foreach loop="$items" key="$id" value="$item">
      <li><tpl:fa icon="fa-star" /> <a href="{{ link('demo', $item) }}">{$item.title}</a> · <tpl:date time="$item.created" /></li>
    </tpl:foreach>
    </ul>
  <tpl:elseif is="$total > 0" />
    <p>…</p>
  <tpl:else />
    <div class="blockMessage">{{ phrase('demo_no_items') }}</div>
  </tpl:if>
  <tpl:comment>secret notes {{ $x }}</tpl:comment>
  <tpl:js>alert('inline');</tpl:js>
  <tpl:include template="demo_macros" />
  <tpl:form action="{{ link('demo/save') }}"><tpl:textboxrow name="title" /></tpl:form>
</div>]]></template>
  <template type="public" title="demo_macros" version_id="1" version_string="1.0.0"><![CDATA[<span class="demoMacro">{$total|number}</span>]]></template>
  <template type="admin" title="demo_admin_list" version_id="1" version_string="1.0.0"><![CDATA[<tpl:title>{{ phrase('demo_items') }}</tpl:title><div class="block">{$total}</div>]]></template>
  <template type="public" title="demo.less" version_id="1" version_string="1.0.0"><![CDATA[@demo-pad: 10px;
.demoList { padding: @demo-pad; border: 1px solid #ccc;
  &:hover { border-color: red; }
}
.demoMacro { font-weight: bold; }
.m-clearFix();]]></template>
</templates>`,
  "_data/cron.xml": `<?xml version="1.0" encoding="utf-8"?>
<cron><entry entry_id="demoCleanup" cron_class="Acme\\Demo\\Cron\\Cleanup" cron_method="run" active="1"><![CDATA[{"day_type":"dom","dom":[-1],"hours":[-1],"minutes":[0]}]]></entry></cron>`,
  "_data/widget_definitions.xml": `<?xml version="1.0" encoding="utf-8"?>
<widget_definitions><widget_definition definition_id="demo_latest" definition_class="Acme\\Demo\\Widget\\Latest"/></widget_definitions>`,
  "_data/class_extensions.xml": `<?xml version="1.0" encoding="utf-8"?>
<class_extensions><extension from_class="Base\\Entity\\User" to_class="Acme\\Demo\\Base\\Entity\\User" execute_order="10" active="1"/></class_extensions>`,
  "_data/code_event_listeners.xml": `<?xml version="1.0" encoding="utf-8"?>
<code_event_listeners><listener event_id="app_setup" execute_order="10" callback_class="Acme\\Demo\\Listener" callback_method="appSetup" active="1" hint="" description="Setup"/></code_event_listeners>`,
  "Setup.php": `<?php
namespace Acme\\Demo;
class Setup extends AbstractSetup {
  public function installStep1() {
    $this->schemaManager()->createTable('acme_demo_item', function (Create $table) {
      $table->addColumn('item_id', 'int')->autoIncrement();
      $table->addColumn('user_id', 'int');
      $table->addColumn('title', 'varchar', 150)->setDefault('');
      $table->addColumn('state', 'enum')->values(['visible', 'deleted'])->setDefault('visible');
      $table->addColumn('created', 'int')->setDefault(0);
      $table->addColumn('data', 'mediumblob')->nullable();
      $table->addKey(['user_id', 'created'], 'user_created');
    });
  }
}`,
  "Pub/Controller/Item.php": `<?php
namespace Acme\\Demo\\Pub\\Controller;
class Item extends AbstractController {
  public function actionIndex() {
    return $this->view('Acme\\Demo:Item\\Listing', 'demo_item_list', ['items' => []]);
  }
}`,
  "Admin/Controller/Item.php": `<?php
class Item { public function actionIndex() { return $this->view('Acme\\Demo:Item', 'demo_admin_list', []); } }`,
  "Api/Controller/Items.php": "<?php\nclass Items { public function actionGet() {} }\n",
  "Entity/Item.php": "<?php\nclass Item extends Entity { public static function getStructure(Structure $structure) { return $structure; } }\n",
  "Repository/Item.php": "<?php\nclass ItemRepo { }\n",
  "Cron/Cleanup.php": "<?php\nclass Cleanup { public static function run() {} }\n",
  "Widget/Latest.php": "<?php\nclass Latest { }\n",
  "Base/Entity/User.php": "<?php\nclass User extends Base_User { }\n",
  "Listener.php": "<?php\nclass Listener { public static function appSetup() {} }\n",
};

/** Add-on-ul de test, ca arhivă `.zip` de distribuție (`upload/src/addons/Acme/Demo/…`, plus un JS în `upload/js/`). */
export function addonJsonFixture(): Buffer {
  const entries: GcsZipEntryInput[] = Object.entries(ADDON_FILES).map(([name, data]) => ({ name: `upload/src/addons/Acme/Demo/${name}`, data }));
  entries.push({ name: "upload/js/acme/demo/demo.js", data: "window.demo = 1;\n" });
  return writeZip(entries);
}
