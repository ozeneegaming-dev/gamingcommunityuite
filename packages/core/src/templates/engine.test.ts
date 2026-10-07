import { describe, expect, test } from "vitest";
import { diffHunks, diffLines, diffStats } from "./diff";
import { GCS_TEMPLATE_FILTERS } from "./filters";
import { GcsTemplateError, parseTemplate, TEMPLATE_FILTERS } from "./parser";
import { compileTemplate, renderTemplate, templateSyntaxError, type GcsTemplateRenderOptions } from "./render";
import { parseHtmlTree, sanitizeStyleAttribute, sanitizeTemplateHtml } from "./sanitize";
import { GcsSafeHtml, safeHtml } from "./values";

const NOW = new Date("2026-10-06T12:00:00Z");
const opts: GcsTemplateRenderOptions = { locale: "en", timeZone: "UTC", now: NOW };
const render = (src: string, data: Record<string, unknown> = {}, o: GcsTemplateRenderOptions = {}) => renderTemplate(src, data, { ...opts, ...o });
/** Randarea + sanitizarea, ca pe site. */
const site = (src: string, data: Record<string, unknown> = {}, o: GcsTemplateRenderOptions = {}) => sanitizeTemplateHtml(render(src, data, o));

function errorOf(fn: () => unknown): GcsTemplateError {
  try {
    fn();
  } catch (error) {
    if (error instanceof GcsTemplateError) return error;
    throw error;
  }
  throw new Error("nu a aruncat");
}

describe("escaparea", () => {
  test("variabilele sunt escapate implicit, inclusiv în atribute", () => {
    const out = render('<a title="{{ t }}">{{ t }}</a>', { t: `"><script>alert(1)</script>'` });
    expect(out).toBe('<a title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&#39;">&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&#39;</a>');
  });

  test("doar GcsSafeHtml (creat de cod) iese nescapat", () => {
    expect(render("{{ html }}", { html: safeHtml("<b>ok</b>") })).toBe("<b>ok</b>");
    expect(render("{{ html }}", { html: "<b>ok</b>" })).toBe("&lt;b&gt;ok&lt;/b&gt;");
  });

  test("`escape` nu dublează escaparea; `capture` păstrează ieșirea", () => {
    expect(render("{{ x | escape }}", { x: "<i>" })).toBe("&lt;i&gt;");
    expect(render("{% capture c %}<b>{{ x }}</b>{% endcapture %}{{ c }}", { x: "<i>" })).toBe("<b>&lt;i&gt;</b>");
  });

  test("filtrele text nu pot transforma un text în HTML sigur", () => {
    const out = render('{{ x | append: "<img src=x onerror=alert(1)>" | upcase }}', { x: "a" });
    expect(out).not.toContain("<img");
    expect(render("{{ x | newline_to_br }}", { x: "<b>\nz" })).toBe("&lt;b&gt;<br>z");
  });
});

describe("XSS: sanitizer-ul final", () => {
  test("scoate script, style, iframe, form și atributele on*", () => {
    const out = sanitizeTemplateHtml(
      '<div onclick="x()" onmouseover="y()">a<script>alert(1)</script><style>body{}</style><iframe src="https://e.x"></iframe><form action="/x"><input name="p"></form><svg onload="z()"><path d="M0 0"/></svg></div>',
    );
    expect(out).not.toMatch(/script|onclick|onmouseover|onload|<style|<iframe|<form|<input|alert/i);
    expect(out).toContain('<path d="M0 0"');
  });

  test("linkurile javascript:, data: și vbscript: dispar; target=_blank primește noopener", () => {
    const out = sanitizeTemplateHtml(
      '<a href="javascript:alert(1)">a</a><a href=" jav&#x09;ascript:alert(1)">b</a><a href="data:text/html,x">c</a><img src="data:image/png;base64,AA"><a href="/forum" target="_blank">d</a><a href="vbscript:x">e</a>',
    );
    expect(out).not.toMatch(/javascript|vbscript|data:/i);
    expect(out).toContain('<a href="/forum" target="_blank" rel="noopener">d</a>');
  });

  test("o valoare din date nu poate injecta atribute sau taguri, nici în atribute fără ghilimele", () => {
    const out = site("<a href={{ u }} title={{ u }}>x</a><div class={{ u }}></div>", { u: "x onmouseover=alert(1) <script>" });
    expect(out).not.toMatch(/onmouseover|<script/i);
  });

  test("href din date cu javascript: e eliminat de sanitizer", () => {
    expect(site('<a href="{{ u }}">x</a>', { u: "javascript:alert(document.cookie)" })).toBe("<a>x</a>");
  });

  test("style: doar declarații sigure", () => {
    expect(sanitizeStyleAttribute("color: red; background: url(javascript:alert(1)); width: expression(alert(1))")).toBe("color:red");
    expect(sanitizeStyleAttribute("background:url('/files/a.png');padding:4px")).toBe("background:url('/files/a.png');padding:4px");
    expect(sanitizeStyleAttribute("background:url(http://evil.example/a.png)")).toBe("");
    expect(sanitizeStyleAttribute("x:1;-moz-binding:url(a);behavior:url(b.htc);--gcs-x: 3px")).toBe("x:1;--gcs-x:3px");
    expect(sanitizeStyleAttribute('font-family:"a;b";color:blue')).toBe('font-family:"a;b";color:blue');
    expect(sanitizeStyleAttribute("color:red\\;x")).toBe("");
    const out = sanitizeTemplateHtml('<span style="color:#fff;background-image:url(https://cdn.example/a.png)">x</span><span style="behavior:url(x)">y</span>');
    expect(out).toContain('style="color:#fff;background-image:url(https://cdn.example/a.png)"');
    expect(out).toContain("<span>y</span>");
  });

  test("id-urile și tabindex invalide dispar; data-* și aria-* rămân", () => {
    const out = sanitizeTemplateHtml('<div id="1bad" tabindex="x" data-user-id="ab12" aria-label="z">a</div><div id="ok-1">b</div>');
    expect(out).toBe('<div data-user-id="ab12" aria-label="z">a</div><div id="ok-1">b</div>');
  });

  test("sloturile există doar pe site; emailurile păstrează atributele tabelelor", () => {
    expect(sanitizeTemplateHtml('<gcs-slot data-name="content" onclick="x"></gcs-slot>')).toBe('<gcs-slot data-name="content"></gcs-slot>');
    expect(sanitizeTemplateHtml('<gcs-slot data-name="content"></gcs-slot>', "email")).toBe("");
    expect(sanitizeTemplateHtml('<table width="600" cellpadding="0" onclick="x"><tr><td bgcolor="#fff">x</td></tr></table>', "email")).toBe(
      '<table width="600" cellpadding="0"><tr><td bgcolor="#fff">x</td></tr></table>',
    );
  });

  test("arborele HTML decodează textul și atributele", () => {
    expect(parseHtmlTree('<a href="/x?a=1&amp;b=2" class="c">A &lt; B</a><br><img src="/i.png" alt="">')).toEqual([
      { type: "element", name: "a", attrs: { href: "/x?a=1&b=2", class: "c" }, children: [{ type: "text", text: "A < B" }] },
      { type: "element", name: "br", attrs: {}, children: [] },
      { type: "element", name: "img", attrs: { src: "/i.png", alt: "" }, children: [] },
    ]);
  });
});

describe("sandbox-ul", () => {
  test("funcțiile nu se apelează, iar prototipurile nu se pot citi", () => {
    const data = { f: () => "secret", o: { a: 1 }, d: new Map([["a", 1]]) };
    expect(render("{{ f }}{{ f.call }}{{ o.constructor }}{{ o.__proto__ }}{{ o.constructor.name }}{{ d.size }}{{ o.toString }}", data)).toBe("");
    expect(render('{{ o["__proto__"] }}{{ o["constructor"]["constructor"] }}', data)).toBe("");
  });

  test("o proprietate proprie numită __proto__ (din JSON) e ignorată", () => {
    const data = JSON.parse('{"o": {"__proto__": {"x": "polluted"}, "y": 2}}') as Record<string, unknown>;
    expect(render("{{ o.__proto__.x }}-{{ o.y }}", data)).toBe("-2");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  test("assign nu poate suprascrie prototipuri", () => {
    render("{% assign __proto__ = 1 %}{% assign constructor = 2 %}");
    expect(({} as Record<string, unknown>).constructor).toBe(Object);
  });
});

describe("limbajul", () => {
  test("variabile, căi, indexuri și proprietăți speciale", () => {
    const data = { user: { name: "Ana", tags: ["a", "b", "c"] }, key: "name" };
    expect(render("{{ user.name }} {{ user[key] }} {{ user.tags[1] }} {{ user.tags.size }} {{ user.tags.first }}{{ user.tags.last }} {{ user.tags[-1] }}", data)).toBe(
      "Ana Ana b 3 ac c",
    );
    expect(render("{{ missing.deep.path }}|{{ nil }}|{{ true }}|{{ 3.5 }}")).toBe("||true|3.5");
  });

  test("if / elsif / else / unless, cu and, or, not, contains, empty, blank", () => {
    const tpl = "{% if n > 10 %}mare{% elsif n > 5 and ok %}mediu{% else %}mic{% endif %}";
    expect(render(tpl, { n: 20 })).toBe("mare");
    expect(render(tpl, { n: 7, ok: true })).toBe("mediu");
    expect(render(tpl, { n: 7, ok: false })).toBe("mic");
    expect(render("{% unless x %}nu{% endunless %}", { x: 0 })).toBe("nu");
    expect(render('{% if s contains "b" and l contains 2 %}da{% endif %}', { s: "abc", l: [1, 2] })).toBe("da");
    expect(render("{% if a == empty %}gol{% endif %}{% if b == blank %}alb{% endif %}{% if not c %}nu{% endif %}", { a: [], b: "  " })).toBe("golalbnu");
    expect(render("{% if a or b %}x{% endif %}{% if '' %}y{% endif %}{% if 0 %}z{% endif %}{% if l %}w{% endif %}", { a: false, b: 1, l: [] })).toBe("x");
  });

  test("case / when", () => {
    const tpl = '{% case t %}{% when "a", "b" %}AB{% when "c" or "d" %}CD{% else %}?{% endcase %}';
    expect(render(tpl, { t: "b" })).toBe("AB");
    expect(render(tpl, { t: "d" })).toBe("CD");
    expect(render(tpl, { t: "z" })).toBe("?");
  });

  test("for: forloop, limit, offset, reversed, else, break, continue, intervale", () => {
    const data = { items: ["a", "b", "c", "d"] };
    expect(render("{% for x in items %}{{ forloop.index }}{{ x }}{% unless forloop.last %},{% endunless %}{% endfor %}", data)).toBe("1a,2b,3c,4d");
    expect(render("{% for x in items limit: 2 offset: 1 %}{{ x }}{% endfor %}", data)).toBe("bc");
    expect(render("{% for x in items reversed %}{{ x }}{% endfor %}", data)).toBe("dcba");
    expect(render("{% for x in none %}{{ x }}{% else %}gol{% endfor %}")).toBe("gol");
    expect(render('{% for x in items %}{% if x == "c" %}{% break %}{% endif %}{% if x == "a" %}{% continue %}{% endif %}{{ x }}{% endfor %}', data)).toBe("b");
    expect(render("{% for i in (1..3) %}{{ i }}{% endfor %}")).toBe("123");
    expect(render("{% for i in (1..n) %}{{ forloop.rindex }}{% endfor %}", { n: 3 })).toBe("321");
    expect(render("{% for a in (1..2) %}{% for b in (1..2) %}{{ forloop.parentloop.index }}{{ b }} {% endfor %}{% endfor %}")).toBe("11 12 21 22 ");
  });

  test("assign și controlul spațiilor", () => {
    expect(render('{% assign n = "ana" | capitalize %}{{ n }}')).toBe("Ana");
    expect(render("<p>\n  {{- x -}}\n</p>", { x: 1 })).toBe("<p>1</p>");
    expect(render("a  {%- if true -%}  b  {%- endif -%}  c")).toBe("abc");
  });

  test("raw și comment", () => {
    expect(render("{% raw %}{{ x }}{% if %}{% endraw %}", { x: 1 })).toBe("{{ x }}{% if %}");
    expect(render("a{% comment %}{{ nu se parsează {% if %}{% endcomment %}b")).toBe("ab");
  });

  test("include cu parametri, hook-uri și sloturi", () => {
    const include = (name: string) => (name === "parts.badge" ? "<b>{{ label }}{{ user.name }}</b>" : null);
    expect(render('{% include "parts.badge" label: "VIP " %}', { user: { name: "Ana" } }, { include })).toBe("<b>VIP Ana</b>");
    expect(render('a{% hook "postbit.after_fields" %}b')).toBe("ab");
    expect(render('a{% hook "postbit.after_fields" %}b', {}, { hook: (n) => `[${n}]` })).toBe("a[postbit.after_fields]b");
    expect(render('{% slot "content" %}')).toBe('<gcs-slot data-name="content"></gcs-slot>');
  });

  test("componentele platformei", () => {
    const user = { id: "u1", name: "Ana <x>", url: "/members/u1-ana", nameKey: "admin", image: null, frameKey: null };
    expect(render('{% username user %}', { user })).toBe('<a href="/members/u1-ana" class="gcs-userLink gcs-name--admin" data-user-id="u1" data-text="Ana &lt;x&gt;">Ana &lt;x&gt;</a>');
    expect(render('{% avatar user, size: "s" %}', { user })).toBe(
      '<span class="gcs-avatar gcs-avatar--s" data-avatar-user="u1" style="width:34px;height:34px;background:#5A2D6E;font-size:14px"><span aria-hidden="true">A</span><span class="gcs-srOnly">Ana &lt;x&gt;</span></span>',
    );
    expect(render('{% avatar user, size: "l" %}', { user: { ...user, image: "/files/a", frameKey: "neon" } })).toBe(
      '<span class="gcs-avatarFrame gcs-avatarFrame--neon" style="width:104px;height:104px"><span class="gcs-avatar gcs-avatar--l" data-avatar-user="u1" style="font-size:42px"><img src="/files/a" alt="Ana &lt;x&gt;" class="gcs-avatar__img"/></span></span>',
    );
    // URL-uri periculoase în date: neutralizate deja în componentă.
    expect(render("{% username user %}", { user: { ...user, url: "javascript:alert(1)" } })).toContain('href="#"');
    expect(render("{% avatar user %}", { user: { ...user, image: "javascript:x" } })).not.toContain("javascript");
    expect(render("{% time d %}", { d: "2026-10-06T11:55:00Z" })).toBe('<time datetime="2026-10-06T11:55:00.000Z" title="October 6, 2026 at 11:55 AM">5 minutes ago</time>');
    expect(render('{% icon "fa-solid fa-star" %}', {}, { components: { icon: (n) => `<svg data-icon="${n}"></svg>` } })).toBe('<svg data-icon="fa-solid fa-star"></svg>');
    expect(render('{% icon "fa-solid fa-star onload=x" %}{% icon "javascript:x" %}{% avatar nobody %}{% time "nu e o dată" %}')).toBe("");
  });
});

describe("filtrele", () => {
  test("lista din parser are toate implementările", () => {
    expect(Object.keys(GCS_TEMPLATE_FILTERS).sort()).toEqual([...TEMPLATE_FILTERS].sort());
  });

  test("text", () => {
    expect(render('{{ "ana" | upcase }} {{ "ANA" | downcase }} {{ "ana are" | capitalize }}')).toBe("ANA ana Ana are");
    expect(render('{{ "abcdefghij" | truncate: 5 }}|{{ "abc" | truncate: 5 }}|{{ "a b c d" | truncatewords: 2 }}')).toBe("abcd…|abc|a b…");
    expect(render('{{ x | default: "gol" }}|{{ "" | default: "gol" }}|{{ 0 | default: "gol" }}|{{ false | default: "x", allow_false: true }}', {})).toBe("gol|gol|0|false");
    expect(render('{{ "a,b" | split: "," | join: "-" }} {{ " x " | strip }}|{{ "aXbX" | replace: "X", "y" }} {{ "aXb" | remove: "X" }}')).toBe("a-b x|ayby ab");
    expect(render('{{ "a b" | url_encode }} {{ "x" | prepend: "<" }}')).toBe("a%20b &lt;x");
  });

  test("numere, date și traduceri", () => {
    expect(render("{{ 10 | plus: 5 | minus: 3 | times: 2 }} {{ 7 | divided_by: 2 }} {{ 7.5 | divided_by: 2 }} {{ 7 | modulo: 3 }} {{ 1 | divided_by: 0 }}")).toBe("24 3 3.75 1 ");
    expect(render("{{ 1234567.891 | number }} {{ 3.14159 | number: 2 }} {{ 1500 | number: \"compact\" }}")).toBe("1,234,567.891 3.14 1.5K");
    expect(render('{{ d | date }}|{{ d | date: "date" }}|{{ d | date: "relative" }}|{{ d | date: "iso" }}', { d: "2026-10-05T12:00:00Z" })).toBe(
      "Oct 5, 2026, 12:00 PM|Oct 5, 2026|1 day ago|2026-10-05T12:00:00.000Z",
    );
    const translate = (key: string, p: Record<string, unknown>) => `${key}(${JSON.stringify(p)})`;
    expect(render('{{ "forum.topics" | t }}|{{ n | t: "forum.replies" }}|{{ "x.y" | t: name: u.name }}', { n: 3, u: { name: "<A>" } }, { translate })).toBe(
      'forum.topics({})|forum.replies({&quot;count&quot;:3})|x.y({&quot;name&quot;:&quot;&lt;A&gt;&quot;})',
    );
    expect(render('{{ "forum.topics" | t }}')).toBe("forum.topics");
    expect(render('{{ "#FF0000" | tint }} {{ c | tint: 0.5 }}', { c: "bad" })).toBe("rgba(255, 0, 0, 0.14) rgba(214, 40, 57, 0.5)");
  });

  test("liste", () => {
    const users = [
      { name: "Zoe", vip: true, n: 2 },
      { name: "Ana", vip: false, n: 10 },
      { name: "Ion", vip: true, n: 1 },
    ];
    expect(render('{{ users | map: "name" | join: ", " }}', { users })).toBe("Zoe, Ana, Ion");
    expect(render('{{ users | where: "vip" | map: "name" | join }}|{{ users | where: "name", "Ana" | size }}', { users })).toBe("Zoe Ion|1");
    expect(render('{{ users | sort: "name" | map: "name" | join }}|{{ users | sort: "n" | map: "n" | join }}', { users })).toBe("Ana Ion Zoe|1 2 10");
    expect(render("{{ l | reverse | join }}|{{ l | uniq | join }}|{{ l | slice: 1, 2 | join }}|{{ l | compact | size }}", { l: [1, 2, 2, null] })).toBe(" 2 2 1|1 2 |2 2|3");
  });
});

describe("erorile au rândul și coloana", () => {
  const cases: [string, string, string, number][] = [
    ["tag necunoscut", "a\n  {% foo %}", "unknown_tag", 2],
    ["filtru necunoscut", "{{ x | nope }}", "unknown_filter", 1],
    ["bloc neînchis", "<p>\n{% if x %}\n", "unclosed_block", 2],
    ["închidere fără bloc", "{% endif %}", "unmatched_end", 1],
    ["output neînchis", "x\ny {{ a", "unclosed_output", 2],
    ["text neînchis", '{{ "abc }}', "unclosed_output", 1],
    ["break în afara buclei", "{% break %}", "break_outside_loop", 1],
    ["caracter neașteptat", "{{ a ; b }}", "unexpected_char", 1],
    ["slot fără nume valid", '{% slot "Bad Name" %}', "invalid_name", 1],
    ["else dublu", "{% if a %}{% else %}{% else %}{% endif %}", "unexpected_token", 1],
  ];
  test.each(cases)("%s", (_label, source, code, line) => {
    const err = errorOf(() => parseTemplate(source));
    expect(err.code).toBe(code);
    expect(err.line).toBe(line);
  });

  test("coloana exactă a unui filtru necunoscut", () => {
    const err = errorOf(() => parseTemplate("<div>\n  <b>{{ user.name | shout }}</b>\n</div>"));
    expect([err.code, err.line, err.column, err.detail]).toEqual(["unknown_filter", 2, 21, "shout"]);
    expect(templateSyntaxError("{{ ok }}")).toBeNull();
    expect(templateSyntaxError("{% if %}")?.code).toBe("unexpected_end");
  });

  test("eroarea dintr-un șablon inclus îl numește", () => {
    const err = errorOf(() => render('{% include "parts.bad" %}', {}, { include: () => "ok\n{% for x in (1..100000) %}{% endfor %}", limits: { iterations: 10 } }));
    expect([err.code, err.template, err.line]).toEqual(["iteration_limit", "parts.bad", 2]);
  });
});

describe("limitele", () => {
  test("iterațiile", () => {
    expect(errorOf(() => render("{% for i in (1..1000000000) %}x{% endfor %}")).code).toBe("iteration_limit");
    expect(errorOf(() => render("{% for a in (1..200) %}{% for b in (1..200) %}{% endfor %}{% endfor %}")).code).toBe("iteration_limit");
  });

  test("mărimea ieșirii, inclusiv prin dublarea unui text", () => {
    expect(errorOf(() => render("{% for i in (1..20000) %}0123456789012345678901234567890{% endfor %}")).code).toBe("output_limit");
    expect(errorOf(() => render('{% assign s = "xxxxxxxxxxxxxxxx" %}{% for i in (1..40) %}{% assign s = s | append: s %}{% endfor %}')).code).toBe("output_limit");
  });

  test("timpul", () => {
    const err = errorOf(() => render("{% for a in (1..19000) %}{{ a | plus: 1 | minus: 1 | times: 1 }}{% endfor %}", {}, { limits: { timeMs: 1, output: 10_000_000 } }));
    expect(err.code).toBe("time_limit");
  });

  test("adâncimea includerilor (și includerea recursivă)", () => {
    expect(errorOf(() => render('{% include "parts.loop" %}', {}, { include: () => '{% include "parts.loop" %}' })).code).toBe("include_depth");
    expect(errorOf(() => render('{% include "parts.none" %}', {}, { include: () => null })).code).toBe("include_not_found");
  });

  test("sursa prea lungă e refuzată", () => {
    expect(errorOf(() => parseTemplate("x".repeat(64 * 1024 + 1))).code).toBe("too_long");
  });

  test("AST-ul e păstrat în cache după sursă", () => {
    const src = "{{ cache_test }}";
    expect(compileTemplate(src)).toBe(compileTemplate(src));
  });
});

describe("valori", () => {
  test("GcsSafeHtml se compară după text", () => {
    expect(render("{% if a == 'x' %}da{% endif %}", { a: new GcsSafeHtml("x") })).toBe("da");
  });
});

describe("diferențele pe rânduri", () => {
  test("adăugări, ștergeri, rânduri comune", () => {
    const d = diffLines("a\nb\nc\nd", "a\nc\nd\ne");
    expect(d.map((l) => `${l.op}:${l.text}`)).toEqual(["eq:a", "del:b", "eq:c", "eq:d", "add:e"]);
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
    expect(diffLines("", "x").map((l) => l.op)).toEqual(["add"]);
    expect(diffLines("x", "x").map((l) => l.op)).toEqual(["eq"]);
  });

  test("schimbări în mijloc, cu numerele rândurilor", () => {
    const a = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n");
    const b = a.replace("l20", "L20").replace("l30\n", "");
    const d = diffLines(a, b);
    expect(d.filter((l) => l.op !== "eq").map((l) => [l.op, l.text, l.a, l.b])).toEqual([
      ["del", "l20", 21, null],
      ["add", "L20", null, 21],
      ["del", "l30", 31, null],
    ]);
    const hunks = diffHunks(d, 2);
    expect(hunks[0]).toEqual({ skipped: 18 });
    expect(hunks.filter((h) => "skipped" in h).length).toBe(3);
  });

  test("texte foarte diferite", () => {
    const a = Array.from({ length: 300 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 300 }, (_, i) => `b${i}`).join("\n");
    expect(diffStats(diffLines(a, b))).toEqual({ added: 300, removed: 300 });
  });
});
