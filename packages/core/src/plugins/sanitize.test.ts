import { describe, expect, test } from "vitest";
import { scopePluginCss } from "./css";
import { sanitizePluginHtml } from "./sanitize";

const icon = (name: string) => (name === "fa-solid fa-star" ? '<svg class="gcs-icon"><path d="M0"/></svg>' : null);

describe("HTML-ul pluginurilor", () => {
  test("scripturile, handlerele și stilurile dispar", () => {
    const html = sanitizePluginHtml(
      `<p onclick="x()" style="position:fixed" id="main" name="x">Salut</p><script>alert(1)</script><img src="javascript:alert(1)" onerror="x"><iframe src="https://e"></iframe><form action="/x"><input name="a"><button>Go</button></form><svg><script>1</script></svg><!-- c -->`,
    );
    expect(html).toBe("<p>Salut</p><img loading=\"lazy\" />Go");
  });

  test("linkurile primesc rel, iar schemele periculoase dispar", () => {
    expect(sanitizePluginHtml('<a href="https://x.example" target="_self">x</a>')).toBe('<a href="https://x.example" target="_blank" rel="noopener noreferrer nofollow ugc">x</a>');
    expect(sanitizePluginHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer nofollow ugc">x</a>');
    expect(sanitizePluginHtml('<a href="//evil.example/x">x</a>')).toBe('<a rel="noopener noreferrer nofollow ugc">x</a>');
    expect(sanitizePluginHtml('<a href="/p/acme.demo/stats">x</a>')).toContain('href="/p/acme.demo/stats"');
    expect(sanitizePluginHtml('<img src="http://x.example/a.png">')).toBe('<img loading="lazy" />');
    expect(sanitizePluginHtml('<img src="data:image/png;base64,AAAA">')).toBe('<img loading="lazy" />');
  });

  test("clasele: doar gcsp-* și clasele GCS de prezentare", () => {
    expect(sanitizePluginHtml('<div class="gcsp-box gcs-muted gcs-drawer gcs-modal evil">x</div>')).toBe('<div class="gcsp-box gcs-muted">x</div>');
    expect(sanitizePluginHtml('<span data-gcsp-id="1" data-testid="gcs-header-user" aria-label="x" role="note">x</span>')).toBe('<span data-gcsp-id="1" aria-label="x" role="note">x</span>');
  });

  test("`style` păstrează doar variabilele CSS cu valori sigure", () => {
    expect(sanitizePluginHtml('<div class="gcsp-x" style="--gcsp-c1:#FF0044; --a: 135deg;--w:700;--fx:gcsFxShimmer">x</div>')).toBe(
      '<div class="gcsp-x" style="--gcsp-c1:#FF0044;--a:135deg;--w:700;--fx:gcsFxShimmer">x</div>',
    );
    for (const style of [
      "color:red",
      "--x:url(https://evil.example/a.png)",
      "--x:expression(alert(1))",
      '--x:"</div><script>"',
      "--x:red;position:fixed;inset:0",
      "--x:var(--y)",
      "--x:1px 2px",
      "-x:#fff",
    ]) {
      const out = sanitizePluginHtml(`<p style='${style}'>x</p>`);
      expect([style, out]).toEqual([style, style.startsWith("--x:red") ? '<p style="--x:red">x</p>' : "<p>x</p>"]);
    }
  });

  test("formularele: doar în pagini, spre API-ul sau paginile pluginului", () => {
    const page = (html: string) => sanitizePluginHtml(html, { pluginKey: "acme.demo", page: true });
    expect(page('<form method="POST" action="/api/plugins/acme.demo/save" enctype="multipart/form-data"><input type="radio" name="style" value="ns_1" checked><button>Salvează</button></form>')).toBe(
      '<form method="post" action="/api/plugins/acme.demo/save" enctype="multipart/form-data"><input type="radio" name="style" value="ns_1" checked /><button type="submit">Salvează</button></form>',
    );
    expect(page('<form action="/p/acme.demo/items"><input type="search" name="q"></form>')).toBe('<form method="get" action="/p/acme.demo/items"><input type="search" name="q" /></form>');
    for (const action of ["https://evil.example/x", "//evil.example", "/api/plugins/acme.other/save", "/api/auth/sign-out", "/api/plugins/acme.demo/../../auth", "/api/plugins/acme.demo%2f..%2fx", "javascript:alert(1)"]) {
      expect([action, page(`<form method="post" action="${action}"><input name="a"></form>`)]).toEqual([action, '<div><input type="text" name="a" /></div>']);
    }
    // GET spre API sau POST spre o pagină: nu.
    expect(page('<form method="get" action="/api/plugins/acme.demo/save"></form>')).toBe("<div></div>");
    expect(page('<form method="post" action="/p/acme.demo"></form>')).toBe("<div></div>");
    // Fără „page” (widget-uri, puncte de extensie), formularele dispar ca până acum.
    expect(sanitizePluginHtml('<form method="post" action="/api/plugins/acme.demo/save"><input name="a"></form>', { pluginKey: "acme.demo" })).toBe("");
  });

  test("controalele: tipuri sigure, fără trimitere în altă parte", () => {
    const page = (html: string) => sanitizePluginHtml(html, { pluginKey: "acme.demo", page: true });
    expect(page('<input type="password" name="p"><input type="image" src="https://evil.example/x.png" name="i">')).toBe('<input type="text" name="p" /><input type="text" name="i" />');
    expect(page('<button type="submit" formaction="https://evil.example" formmethod="get" form="other">x</button>')).toBe('<button type="submit">x</button>');
    expect(page('<input name="a b" onfocus="x()" id="i" value="1">')).toBe('<input value="1" type="text" />');
    expect(page('<textarea name="quote" maxlength="200" onkeyup="x()">a &lt;b&gt;</textarea>')).toBe('<textarea name="quote" maxlength="200">a &lt;b&gt;</textarea>');
    expect(page('<select name="plan"><option value="gold" selected>Gold</option></select>')).toBe('<select name="plan"><option value="gold" selected>Gold</option></select>');
  });

  test("audio și video: doar fișierele pluginului; video fără sunet, audio fără pornire automată", () => {
    const page = (html: string) => sanitizePluginHtml(html, { pluginKey: "acme.demo", page: true });
    expect(page('<video src="/plugins/acme.demo/media/abc123.webm" poster="/plugins/acme.demo/media/p1.webp" autoplay loop></video>')).toBe(
      '<video src="/plugins/acme.demo/media/abc123.webm" poster="/plugins/acme.demo/media/p1.webp" autoplay loop muted playsinline></video>',
    );
    expect(page('<audio src="/plugins/acme.demo/media/s.mp3" autoplay controls></audio>')).toBe('<audio src="/plugins/acme.demo/media/s.mp3" controls></audio>');
    for (const src of ["https://evil.example/a.mp4", "/plugins/acme.other/media/a.mp4", "/plugins/acme.demo/../acme.other/media/a", "/files/abc", "/plugins/acme.demo/media/a.mp4?x=1"]) {
      expect([src, page(`<video src="${src}"></video>`)]).toEqual([src, "<video muted playsinline></video>"]);
    }
    expect(sanitizePluginHtml('<video src="/plugins/acme.demo/media/a.webm"></video>', { pluginKey: "acme.demo" })).toBe("");
  });

  test("numele și avatarele membrilor ca în nucleu", () => {
    expect(sanitizePluginHtml('<a class="gcs-userLink gcs-name--vip_gold gcs-drawer" data-user-id="u123" href="/members/u123-ana">Ana</a><span class="gcs-avatar"><img class="gcs-avatar__img" src="/files/a"></span>')).toBe(
      '<a class="gcs-userLink gcs-name--vip_gold" data-user-id="u123" href="/members/u123-ana" rel="noopener noreferrer nofollow ugc">Ana</a><span class="gcs-avatar"><img class="gcs-avatar__img" src="/files/a" loading="lazy" /></span>',
    );
    expect(sanitizePluginHtml('<a data-user-id="x&quot; onmouseover=&quot;1" href="/m">x</a>')).toBe('<a href="/m" rel="noopener noreferrer nofollow ugc">x</a>');
  });

  test("<gcs-icon> devine iconița Font Awesome; numele necunoscute dispar", () => {
    expect(sanitizePluginHtml('<p><gcs-icon name="fa-solid fa-star"></gcs-icon> Top</p>', { icon })).toBe('<p><svg class="gcs-icon"><path d="M0"/></svg> Top</p>');
    expect(sanitizePluginHtml('<gcs-icon name="fa-solid fa-star" />!', { icon })).toBe('<svg class="gcs-icon"><path d="M0"/></svg>!');
    expect(sanitizePluginHtml('<gcs-icon name="fa-solid fa-nope"></gcs-icon><gcs-icon name="x&quot; onload=&quot;1"></gcs-icon>', { icon })).toBe("");
  });
});

describe("CSS-ul pluginurilor", () => {
  const scope = (css: string, file = "assets/style.css") => scopePluginCss(css, { pluginKey: "acme.demo", file });

  test("se închide în clasa pluginului, iar url()-urile relative se rescriu", () => {
    expect(scope(".box { color: red; background: url(img/bg.png) } @media (max-width: 600px) { .box { color: blue } }")).toEqual({
      ok: true,
      css: '.gcsp--acme--demo {\n.box { color: red; background: url("/plugins/acme.demo/assets/img/bg.png") } @media (max-width: 600px) { .box { color: blue } }\n}\n',
    });
    expect(scope("a{background:url('data:image/png;base64,AAAA')}")).toMatchObject({ ok: true });
  });

  test("exfiltrarea și ieșirea din container sunt refuzate", () => {
    const cases: [string, string][] = [
      ["@import url(https://evil.example/x.css);", "css_forbidden"],
      ["a { background: url(https://evil.example/?k=1) }", "css_url"],
      ["a { background: url(//evil.example/x) }", "css_url"],
      ["a { background: url(../../../admin) }", "css_url"],
      ["} body { display: none } a {", "css_braces"],
      ["a { color: red }}", "css_braces"],
      ["a { color: red", "css_braces"],
      ["& ~ .gcs-siteHeader { display: none }", "css_selector"],
      ["body:has(&) .gcs-siteHeader { display: none }", "css_selector"],
      ["+ .gcs-siteMain { display: none }", "css_selector"],
      ["a, ~ b { color: red }", "css_selector"],
      ["@scope (body) { a { color: red } }", "css_unsupported"],
      ["@font-face { font-family: x; src: url(f.woff2) }", "css_unsupported"],
      ["a { background: url(x.png) } /* </style><script> */", "css_forbidden"],
      ["a { content: '\\3c script' }", "css_forbidden"],
      ["a { width: expression(alert(1)) }", "css_forbidden"],
    ];
    for (const [css, code] of cases) expect([css, scope(css)]).toEqual([css, expect.objectContaining({ ok: false, code })]);
  });

  test("CR, FF și celelalte caractere de control nu pot închide containerul", () => {
    // Browserul transformă CR/FF în LF înainte de parsare: șirul se termină acolo, iar `}` de după e o acoladă reală.
    for (const ctl of ["\f", "\r", "\r\n"]) {
      const css = `.x { content: "${ctl}} } body { display: none } .y { content: "; }`;
      expect([JSON.stringify(ctl), scope(css)]).toEqual([JSON.stringify(ctl), expect.objectContaining({ ok: false })]);
    }
    for (const ctl of ["\u0000", "\u0001", "\u000b", "\u001b", "\u007f"]) {
      expect([JSON.stringify(ctl), scope(`a { color: red${ctl} }`)]).toEqual([JSON.stringify(ctl), { ok: false, code: "css_forbidden", detail: "control" }]);
    }
    // Sfârșiturile de rând Windows și tab-urile rămân valide (normalizate la LF).
    expect(scope("a {\r\n\tcolor: red;\r\n}\r\n")).toEqual({ ok: true, css: ".gcsp--acme--demo {\na {\n\tcolor: red;\n}\n}\n" });
    expect(scope("a {\fcolor: red }")).toEqual({ ok: true, css: ".gcsp--acme--demo {\na {\ncolor: red }\n}\n" });
  });

  test("acoladele din șiruri și comentarii nu contează", () => {
    expect(scope('a::after { content: "}" } /* { */ b { color: red }')).toMatchObject({ ok: true });
  });
});
