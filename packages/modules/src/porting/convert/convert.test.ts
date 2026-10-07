import { checkPluginSql, langFileError, pluginSchema, scopePluginCss } from "@gcs/core";
import { describe, expect, test } from "vitest";
import { scanCreateTables, scanFormFields } from "../formats/php";
import { convertStyles } from "./css";
import { convertPhrases, phraseText } from "./phrases";
import { convertSchema, sqlIdent } from "./schema";
import { emitTemplate, parsePath, parseTemplate, rewriteHtml, TEMPLATE_RUNTIME, type GcsTplNode } from "./template";

const stats = () => ({ todos: 0, dropped: { scripts: 0, styles: 0, inlineStyles: 0, handlers: 0, forms: 0 } });
const emitCtx = { phrase: (k: string) => `src.${k}`, setting: (k: string) => (k === "known" ? "known" : null), template: (n: string) => (n === "front/x/row" ? "tpl9" : null) };

/**
 * Rulează funcția generată cu un `ctx` minimal. Codul generat e al nostru (șirurile sursei sunt literali JSON); testul
 * îl evaluează doar ca să verifice comportamentul, ca gazda pluginurilor.
 */
function render(nodes: GcsTplNode[], data: Record<string, unknown>): string {
  const body = emitTemplate(nodes, emitCtx);
  const ctx = {
    locale: "en",
    escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    t: (k: string, p?: Record<string, string>) => `[${k}${p ? ` ${JSON.stringify(p)}` : ""}]`,
    settings: { get: (k: string) => `setting:${k}` },
  };
  const fn = new Function("d0", "ctx", "tpl9", `${TEMPLATE_RUNTIME}\nconst h = [];\n${body}\nreturn h.join("");`) as (d: unknown, c: unknown, t: unknown) => string;
  return fn(data, ctx, () => "<row/>");
}

describe("șabloanele", () => {
  test("căile simple și expresiile nerecunoscute", () => {
    expect(parsePath("$item->title")).toEqual({ path: ["item", "title"] });
    expect(parsePath("$item['a-b'][0]")).toEqual({ path: ["item", "a-b", "0"] });
    expect(parsePath("$item.title")).toEqual({ path: ["item", "title"] });
    expect(parsePath("\\count( $items )")).toEqual({ path: ["items"] });
    expect(parsePath("$a + 1")).toEqual({ raw: "$a + 1" });
    expect(parsePath("doSomething($a)")).toEqual({ raw: "doSomething($a)" });
  });

  test("sintaxa brace: fraze cu parametri, if/else, foreach, setări, include, TODO-uri", () => {
    const { nodes, stats: s } = parseTemplate(
      `<div class="box big" id="top" style="color:red" onclick="x()"><h1>{lang="title"}</h1>{{if \\count( $items )}}<ul>{{foreach $items as $k => $item}}<li data-id="{$item->id}">{$item->name} {lang="by" sprintf="$item->user"}</li>{{endforeach}}</ul>{{else}}<p>{lang="empty"}</p>{{endif}}{{if $a > 1}}X{{endif}}{setting="known"}{setting="other"}{template="row" group="x" app="y"}<a href="{url="app=x"}">l</a><script>alert(1)</script></div>`,
      "brace",
    );
    expect(s.dropped).toMatchObject({ scripts: 1, inlineStyles: 1, handlers: 1 });
    const html = render(nodes, { items: [{ id: 7, name: "<b>Ana</b>", user: "Ion" }] });
    expect(html).toBe(
      '<div class="gcsp-box gcsp-big gcsp-id-top"><h2>[src.title]</h2><ul><li data-gcsp-id="7">&lt;b&gt;Ana&lt;/b&gt; [src.by {&quot;p1&quot;:&quot;Ion&quot;}]</li></ul>setting:known<row/><a href="#">l</a></div>',
    );
    expect(render(nodes, { items: [] })).toContain("<p>[src.empty]</p>");
    const code = emitTemplate(nodes, emitCtx);
    expect(code).toContain("// TODO(portare): condiție: $a > 1");
    expect(code).toContain("// TODO(portare): setarea lipsă: other");
  });

  test("sintaxa tag: titlu, if/elseif/else, foreach cu cheie, iconițe, dată, include, comentarii și scripturi scoase", () => {
    const { nodes, stats: s } = parseTemplate(
      `<tpl:title>{{ phrase('items') }}</tpl:title><tpl:if is="$items is not empty"><tpl:foreach loop="$items" key="$id" value="$item"><p>{$id}: {$item.title} <tpl:fa icon="fa-star" /></p></tpl:foreach><tpl:elseif is="$total" /><b>{$total|number}</b><tpl:else /><i>{{ phrase('none', {'name': $user.name}) }}</i></tpl:if><tpl:comment>secret {$x}</tpl:comment><tpl:js>alert(1)</tpl:js><tpl:include template="row" /><tpl:form action="x"><input name="a"></tpl:form>`,
      "tag",
      "front/x",
    );
    expect(s.dropped.forms).toBe(1);
    const out = render(nodes, { items: { a: { title: "T" } }, total: 3 });
    expect(out).toContain('<h2 class="gcsp-title">[src.items]</h2>');
    expect(out).toContain("<p>a: T <gcs-icon");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("alert");
    expect(render(nodes, { items: [], total: 1234 })).toContain("<b>1,234</b>");
    expect(render(nodes, { items: [], total: 0, user: { name: "Ana" } })).toContain('<i>[src.none {&quot;name&quot;:&quot;Ana&quot;}]</i>');
  });

  test("intrări ostile: nu ies din șiruri sau comentarii, nu ating prototipul", () => {
    const evil = `</script>"); process.exit(1); //\u2028*/ {$__proto__.polluted} {{if $constructor}}C{{endif}} {lang="x\\"); boom(\\""} {{$a = "*/ alert(1) /*";}}`;
    const { nodes } = parseTemplate(evil, "brace");
    const code = emitTemplate(nodes, emitCtx);
    // Fiecare comentariu rămâne pe un rând, fără `*/`.
    for (const line of code.split("\n")) if (line.trim().startsWith("//")) expect(line).not.toMatch(/\*\//);
    const out = render(nodes, {});
    expect(out).toContain("process.exit(1)");
    expect(out).not.toContain("C");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("HTML: clasele prefixate, data-* redenumite, iconițele goale devin gcs-icon", () => {
    const s = stats();
    expect(rewriteHtml('<i class="fa fa-trophy"></i><span class="gcs-muted x" data-a="1" ID="b">t</span>', s)).toBe(
      '<gcs-icon name="fa-solid fa-trophy"></gcs-icon><span class="gcs-muted gcsp-x gcsp-id-b" data-gcsp-a="1">t</span>',
    );
  });
});

describe("limitele (intrări ostile, fără timp pătratic sau depășirea stivei)", () => {
  const fast = (fn: () => void) => {
    const start = Date.now();
    fn();
    expect(Date.now() - start).toBeLessThan(10_000);
  };

  test("șabloane: imbricare foarte adâncă, mii de construcții neînchise", () => {
    fast(() => {
      const deep = parseTemplate(`${"{{if $a}}".repeat(20000)}x${"{{endif}}".repeat(20000)}`, "brace");
      expect(emitTemplate(deep.nodes, emitCtx)).toContain("x");
    });
    fast(() => void parseTemplate("{{".repeat(100000), "brace"));
    fast(() => void parseTemplate('<a:comment>'.repeat(20000), "tag"));
    fast(() => void parseTemplate(`${"<a:if is=\"$x\">".repeat(20000)}`, "tag"));
  });

  test("PHP și CSS: paranteze neînchise, imbricare adâncă", () => {
    fast(() => void scanFormFields("new X\\Form\\YesNo( 'a', ".repeat(50000)));
    fast(() => void scanCreateTables("createTable('t', function (Create $table) { $table->addColumn('a', ".repeat(20000), "Setup.php"));
    fast(() => {
      const { css } = convertStyles([{ name: "x.css", origin: "x", syntax: "css", body: `${"a {".repeat(5000)}color:red${"}".repeat(5000)}` }], "acme.demo");
      expect(css).toBeNull();
    });
  });
});

describe("frazele, schema, CSS", () => {
  test("frazele: text simplu, parametri sprintf și {nume}, chei sigure, fișier valid", () => {
    expect(phraseText("Score by %s on %s")).toBe("Score by {p1} on {p2}");
    expect(phraseText("%2$s then %1$s")).toBe("{p2} then {p1}");
    expect(phraseText('Hi <a href="x">{name}</a> {# [1:a][?:b]} &amp;')).toBe("Hi {name} # [1:a][?:b] &");
    const table = convertPhrases(new Map([["option.demoEnabled", "On"], ["a.b", "x"], ["a_b", "y"], ["empty", "<b></b>"]]), ["a_b"]);
    expect(table.keyOf("a_b")).toBe("src.a_b");
    expect(table.keyOf("a.b")).toBe("src.a_b_2");
    expect(table.keyOf("option.demoEnabled")).toBe("src.option_demoEnabled");
    expect(table.keyOf("empty")).toBeNull();
    expect(langFileError({ src: table.entries })).toBeNull();
  });

  test("schema: tipurile traduse, cuvinte rezervate, indexuri, enum; trece de SQL guard", () => {
    const { sql, tables, notes } = convertSchema(
      [
        {
          name: "Demo-Items",
          origin: "data/schema.json",
          columns: [
            { name: "id", type: "bigint", nullable: false, autoIncrement: true },
            { name: "order", type: "tinyint", nullable: false, default: "0" },
            { name: "title", type: "varchar", length: 50, nullable: false, default: "it's" },
            { name: "kind", type: "enum", values: ["a", "b"], nullable: false, default: "a" },
            { name: "price", type: "decimal", length: 10, decimals: 2, nullable: true, default: null },
            { name: "at", type: "datetime", nullable: false, default: "0000-00-00 00:00:00" },
            { name: "geo", type: "point", nullable: true },
          ],
          indexes: [
            { kind: "primary", name: "PRIMARY", columns: ["id"] },
            { kind: "unique", name: "t", columns: ["title"] },
            { kind: "fulltext", name: "ft", columns: ["title"] },
            { kind: "key", name: "missing", columns: ["nope"] },
          ],
        },
      ],
      "acme.demo",
    );
    expect(tables).toEqual(["Demo-Items"]);
    expect(sql).toContain("CREATE TABLE demo_items (");
    expect(sql).toContain("  id bigserial,");
    expect(sql).toContain('  "order" smallint NOT NULL DEFAULT 0,');
    expect(sql).toContain("  title varchar(50) NOT NULL DEFAULT 'it''s',");
    expect(sql).toContain("  kind text NOT NULL DEFAULT 'a' CHECK (kind IN ('a', 'b')),");
    expect(sql).toContain("  price numeric(10, 2) DEFAULT NULL,");
    expect(sql).toContain("  at timestamp NOT NULL,");
    expect(sql).toContain("  PRIMARY KEY (id)");
    expect(sql).toContain("CREATE UNIQUE INDEX demo_items_t ON demo_items (title);");
    expect(notes.map((n) => n.code)).toEqual(["column_type_unknown", "fulltext_index"]);
    expect(checkPluginSql(sql!, { schema: pluginSchema("acme.demo"), mode: "migration" })).toEqual({ ok: true });
    expect(sqlIdent("123abc")).toBe("c_123abc");
  });

  test("CSS: clase prefixate, reguli nesigure și LESS scoase, validat cu regulile de instalare", () => {
    const { css, stats: s } = convertStyles(
      [
        {
          name: "a.css",
          origin: "x",
          syntax: "brace",
          body: `.box { color: red; background: url(x.png); } #top .list > li { margin: 0 } .ic:before { content: "\\f091"; } @import url("https://evil.example/x.css"); @media (max-width: 600px) { .box { padding: 4px } } @font-face { font-family: x } .v { width: {$w}px; color: blue }`,
        },
        { name: "b.less", origin: "y", syntax: "tag", body: "@pad: 4px;\n.a { padding: @pad; border: 0;\n  &:hover { color: red }\n}\n.m-mixin();" },
      ],
      "acme.demo",
    );
    expect(css).toContain(".gcsp-box {\n  color: red;\n}");
    expect(css).toContain(".gcsp-id-top .gcsp-list > li {");
    expect(css).toContain("@media (max-width: 600px) {");
    expect(css).toContain(".gcsp-a {\n  border: 0;\n}");
    expect(css).not.toMatch(/url\(|@import|@font-face|\\f091|@pad|&:hover/);
    expect(s.rules).toBeGreaterThanOrEqual(3);
    expect(scopePluginCss(css!, { pluginKey: "acme.demo", file: "assets/style.css" }).ok).toBe(true);
  });
});
