import { describe, expect, test } from "vitest";
import { compileAppearanceCss } from "./appearance";
import { compileCustomStyle, customStyleClass, customStylePrefix, parseCustomStyle } from "./customStyle";

const KEY = "gcs.vip_studio";
const parse = (css: string) => parseCustomStyle(css, { pluginKey: KEY });
const codes = (css: string) => {
  const r = parse(css);
  return r.ok ? [] : r.errors.map((e) => `${e.line}:${e.code}`);
};

const FIRE = `/* Flacăra mea */
color: #ffd166;
text-shadow: 0 0 6px #ff7b00, 0 -4px 12px #ff3d00;
animation: flicker 1.4s ease-in-out infinite alternate;

::after {
  content: "🔥";
  position: absolute;
  left: 100%;
  animation: rise 2s linear infinite, gcsNfxBlink 1s steps(1) infinite;
}

@keyframes flicker {
  from { opacity: 1; }
  50%, 75% { opacity: .82; }
  to { opacity: 1; }
}
@keyframes rise { to { transform: translateY(-8px); opacity: 0; } }
`;

describe("stilurile CSS scrise de admin: verificarea", () => {
  test("declarații, ::after și @keyframes: acceptate", () => {
    const r = parse(FIRE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.style.main.map((d) => d.prop)).toEqual(["color", "text-shadow", "animation"]);
    expect(r.style.after.map((d) => d.prop)).toEqual(["content", "position", "left", "animation"]);
    expect(r.style.keyframes.map((k) => k.name)).toEqual(["flicker", "rise"]);
    expect(r.style.keyframes[0]!.frames.map((f) => f.selector)).toEqual(["from", "50%, 75%", "to"]);
  });

  test("încercările de a ieși din stil sunt refuzate, cu linia lor", () => {
    expect(codes("color: red;\n}body{display:none")).toEqual(["2:css_braces", "2:css_selector"]);
    expect(codes("color: red;\n</style><script>alert(1)</script>")).toEqual(["2:css_forbidden"]);
    expect(codes('@import url("https://evil.example/x.css");')).toEqual(["1:css_forbidden"]);
    expect(codes("color: red;\nwidth: expression(alert(1));")).toEqual(["2:css_forbidden"]);
    expect(codes("behavior: url(x.htc);")).toEqual(["1:css_forbidden"]);
    expect(codes("-moz-binding: url(x.xml);")).toEqual(["1:css_forbidden"]);
    expect(codes("content: '\\3c script'")).toEqual(["1:css_forbidden"]);
    expect(codes("color: red;\n\nbody { color: red; }")).toEqual(["3:css_selector"]);
    expect(codes(":hover { color: red; }")).toEqual(["1:css_selector"]);
    expect(codes("::before { color: red; a { x: y } }")).toEqual(["1:css_selector"]);
    expect(codes("::before { color: red; @media x { y: z } }")).toEqual(["1:css_nested"]);
    expect(codes("@media (min-width: 1px) { color: red; }")).toEqual(["1:css_at_rule"]);
    expect(codes("@font-face { font-family: x; }")).toEqual(["1:css_at_rule"]);
    expect(codes("color: red !important;")).toEqual(["1:css_important"]);
    expect(codes("position: fixed; inset: 0;")).toEqual(["1:css_position"]);
    expect(codes("color red;")).toEqual(["1:css_declaration"]);
    expect(codes("co@lor: red;")).toEqual(["1:css_property"]);
    expect(codes("color: red;\n/* neînchis")).toEqual(["2:css_syntax"]);
    expect(codes('content: "neînchis\n;')).toEqual(["1:css_syntax"]);
    expect(codes("::after { content: 'x';")).toEqual(["1:css_braces"]);
    expect(codes("@keyframes bad name { to { opacity: 0 } }")).toEqual(["1:css_at_rule"]);
    expect(codes("@keyframes x { 120px { opacity: 0 } }")).toEqual(["1:css_keyframes_selector"]);
    expect(codes("")).toEqual(["1:css_empty"]);
  });

  test("CR și FF se normalizează ca în browser (un șir nu poate trece de ele)", () => {
    expect(codes('content: "a\rb";')).toEqual(["1:css_syntax"]);
    expect(codes("color: red;\fbody{x:y}")).toEqual(["2:css_selector"]);
    expect(codes("color: red;\r\n\r\nfoo{}")).toEqual(["3:css_selector"]);
  });

  test("url(): doar fișierele pluginului, nimic din afară", () => {
    expect(codes("background: url(https://evil.example/a.png);")).toEqual(["1:css_url"]);
    expect(codes("background: url(/plugins/acme.other/media/abcdef123456.webp);")).toEqual(["1:css_url"]);
    expect(codes(`background: url(/plugins/${KEY}/media/../../../files/x.webp);`)).toEqual(["1:css_url"]);
    expect(codes(`background: url(/plugins/${KEY}/media/abc.svg);`)).toEqual(["1:css_url"]);
    expect(codes("background: image-set('x.png' 1x);")).toEqual(["1:css_url"]);
    expect(codes("background: src('x.png');")).toEqual(["1:css_url"]);
    const ok = parse(`background: url('/plugins/${KEY}/media/abcdef123456.webp') center / contain;`);
    expect(ok.ok && ok.style.main[0]!.value).toBe(`url("/plugins/${KEY}/media/abcdef123456.webp") center / contain`);
  });
});

describe("stilurile CSS scrise de admin: compilarea", () => {
  test("selectorii nucleului, animațiile prefixate, oprite sub reduced-motion", () => {
    const r = parse(FIRE);
    if (!r.ok) throw new Error("invalid");
    const cls = customStyleClass(KEY, "name", "flacara");
    expect(cls).toBe("gcs-nameStyle--gcs-vip_studio--flacara");
    const prefix = customStylePrefix(KEY, "name", "flacara");
    const css = compileCustomStyle(r.style, { selectors: [`:is(.gcs-root,#gcs-names) .${cls}`, ':is(.gcs-root,#gcs-names) :is(.gcs-userLink[data-user-id="u1"],[data-name-user="u1"])'], prefix });
    expect(css).toContain(`:is(.gcs-root,#gcs-names) .${cls},:is(.gcs-root,#gcs-names) :is(.gcs-userLink[data-user-id="u1"],[data-name-user="u1"]){color:#ffd166;`);
    expect(css).toContain(`animation:${prefix}flicker 1.4s ease-in-out infinite alternate`);
    // Animațiile GCS (gcsNfx*) rămân cum sunt; doar cele proprii primesc prefixul.
    expect(css).toContain(`animation:${prefix}rise 2s linear infinite, gcsNfxBlink 1s steps(1) infinite`);
    expect(css).toContain(`:is(.gcs-root,#gcs-names) .${cls}::after,`);
    expect(css).toContain(`@keyframes ${prefix}flicker{from{opacity:1}50%, 75%{opacity:.82}to{opacity:1}}`);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^}]*\{animation:none!important;transition:none!important\}\}/);
    expect(css).not.toContain("@keyframes flicker");
  });

  test("în CSS-ul aspectului: clasa stilului (previzualizări) și numele membrilor care l-au ales", () => {
    const r = parse("color: #00ff88; text-shadow: 0 0 8px #00ff88;");
    if (!r.ok) throw new Error("invalid");
    const css = compileAppearanceCss(
      [
        { userId: "u1", appearance: { name: { fill: { colors: ["#FFFFFF"] }, style: "verde", styleClass: customStyleClass(KEY, "name", "verde") } } },
        { userId: "u2", appearance: { name: { fill: { colors: ["#FFFFFF"] } } } },
      ],
      { previews: true, styles: [{ pluginKey: KEY, kind: "name", key: "verde", style: r.style }, { pluginKey: KEY, kind: "banner", key: "verde", style: r.style }] },
    );
    expect(css).toContain(':is(.gcs-root,#gcs-names) .gcs-nameStyle--gcs-vip_studio--verde,:is(.gcs-root,#gcs-names) :is(.gcs-userLink[data-user-id="u1"],[data-name-user="u1"]){color:#00ff88');
    expect(css).not.toContain('[data-user-id="u2"],[data-name-user="u2"]){color:#00ff88');
    expect(css).toContain(":is(.gcs-root,#gcs-names) .gcs-bannerStyle--gcs-vip_studio--verde{color:#00ff88");
    // Stilul vine după efecte, deci câștigă la aceeași specificitate.
    expect(css.indexOf("gcs-nameStyle--gcs-vip_studio--verde")).toBeGreaterThan(css.indexOf("@keyframes gcsNfxFlow"));
  });
});
