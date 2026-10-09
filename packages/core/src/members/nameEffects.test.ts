import { describe, expect, test } from "vitest";
import { compileAppearanceCss, nameEffectOf } from "./appearance";
import { compileNameEffectsCss, LETTER_EFFECTS, NAME_EFFECTS, nameEffectUsesLetters, nameVars, styledNameSelectors } from "./nameEffects";
import { TEXT_EFFECTS } from "./nameEffectsText";

const previews = compileNameEffectsCss([], { previews: true });

describe("efectele numelui", () => {
  test("fiecare efect din lista albă are reguli de previzualizare", () => {
    for (const effect of NAME_EFFECTS) {
      if (effect === "none") continue;
      expect([effect, previews.includes(`.gcs-nfx.gcs-nfx--${effect}`)]).toEqual([effect, true]);
    }
  });

  test("toate animațiile folosite au cadrele-cheie definite", () => {
    const used = new Set([...previews.matchAll(/animation:([^;}]+)/g)].flatMap((m) => [...m[1]!.matchAll(/\b(gcsNfx[A-Za-z0-9]+)\b/g)].map((x) => x[1]!)));
    expect(used.size).toBeGreaterThan(20);
    for (const name of used) expect([name, previews.includes(`@keyframes ${name}{`)]).toEqual([name, true]);
  });

  test("pseudo-elementele: fără evenimente de mouse, poziționate absolut, ascunse cititoarelor de ecran", () => {
    // Fără literele desenate (`.gcs-name__ls > b::before` e chiar litera, în rând cu celelalte).
    const pseudoRules = [...previews.matchAll(/::(?:before|after)\{([^}]*)\}/g)].map((m) => m[1]!).filter((body) => !body.includes("!important") && !body.startsWith("content:attr(data-c)"));
    expect(pseudoRules.length).toBeGreaterThan(20);
    for (const body of pseudoRules) {
      expect(body).toContain("pointer-events:none");
      expect(body).toContain("position:absolute");
      // Textul dublat sau decorul au un text alternativ gol (`/ ""`).
      expect(body).toMatch(/content:[^;]*\/ ""/);
    }
  });

  test("categoria „Efecte text”: în lista albă, fiecare cu reguli și cadre-cheie; cele pe litere sunt marcate", () => {
    expect(TEXT_EFFECTS.length).toBeGreaterThanOrEqual(40);
    for (const e of TEXT_EFFECTS) expect([e, NAME_EFFECTS.includes(e)]).toEqual([e, true]);
    expect(new Set(NAME_EFFECTS).size).toBe(NAME_EFFECTS.length);
    expect(nameEffectUsesLetters("val_litere")).toBe(true);
    expect(nameEffectUsesLetters("magnetic")).toBe(true);
    expect(nameEffectUsesLetters("unda")).toBe(true);
    expect(nameEffectUsesLetters("neon")).toBe(false);
    expect(LETTER_EFFECTS.length).toBeGreaterThanOrEqual(15);
  });

  test("efectele pe litere: textul simplu rămâne pentru cititoarele de ecran, literele desenate din `data-c`", () => {
    const sel = ":is(.gcs-root,#gcs-names) .gcs-nfx.gcs-nfx--val_litere";
    expect(previews).toContain(`${sel} .gcs-name__t`);
    expect(previews).toMatch(/\.gcs-nfx--val_litere \.gcs-name__t[^{]*\{position:absolute;width:1px;height:1px/);
    expect(previews).toContain(`${sel} .gcs-name__ls>b{animation:gcsNfxWave`);
    expect(previews).toContain('.gcs-name__ls>b::before{content:attr(data-c);content:attr(data-c) / ""}');
    // Literele se opresc și ele sub reduced-motion.
    expect(previews).toMatch(/prefers-reduced-motion: reduce\)\{[^}]*\.gcs-nfx \.gcs-name__ls>b\{animation:none!important/);
  });

  test("curcubeul pe efectele cu o culoare plină: culorile trec una după alta, strălucirea le urmează", () => {
    const rainbow = nameVars({ colors: ["#FF4D4D", "#FFB020", "#3DDC97", "#38BDF8", "#A78BFA"] });
    expect(rainbow).toContain("--nfx-cyc:gcsNfxCycle5");
    expect(rainbow).toContain("--nfx-cyg:currentColor");
    expect(nameVars({ colors: ["#FF4D4D"] }).some((v) => v.startsWith("--nfx-cyc"))).toBe(false);
    expect(previews).toContain("@keyframes gcsNfxCycle5{");
    expect(previews).toMatch(/\.gcs-nfx--electric\{[^}]*animation:gcsNfxZap [^;]*,var\(--nfx-cyc,none\)/);
    expect(previews).toMatch(/\.gcs-nfx--n5\{[^}]*--nfx-cyc:gcsNfxCycle5;--nfx-cyg:currentColor/);
  });

  test("sub reduced-motion animațiile se opresc, iar tăieturile și măștile dispar", () => {
    expect(previews).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^@]*animation:none!important/);
    expect(previews).toContain("clip-path:none!important");
    expect(previews).toContain("mask-image:none!important");
  });

  test("tema deschisă: cernelurile se închid, strălucirea scade", () => {
    expect(previews).toContain('html[data-theme="light"] :where(');
    expect(previews).toContain('html[data-theme="auto"] :where(');
    expect(previews).toContain("oklch(from var(--nfx-c1) min(l,.5) c h)");
    expect(previews).toContain("--nfx-dk:0");
  });

  test("un membru: selectorul lui, decorațiile doar în locurile mari (cu data-text), variabilele din culori validate", () => {
    const sels = styledNameSelectors("u1")!;
    const css = compileNameEffectsCss([{ ...sels, effect: "inferno", vars: nameVars({ colors: ["#FFF3B0", "#FF6A00", "nu"], speed: 0.55 }) }], { previews: false });
    expect(css).toContain(`${sels.all}{--nfx-c1:#FFF3B0;--nfx-c2:#FF6A00;--nfx-sp:0.55`);
    expect(css).toContain(`${sels.rich}::before{`);
    expect(sels.rich).toContain(".gcs-post__authorName");
    expect(sels.rich.endsWith("[data-text]")).toBe(true);
    // Fără previzualizări: nicio clasă `.gcs-nfx`.
    expect(css).not.toContain(".gcs-nfx");
    expect(styledNameSelectors('"]{}*{x')).toBeNull();
  });

  test("numele fără efect: o culoare = plin, mai multe = gradient fix; animațiile vechi ale umplerii au echivalent", () => {
    expect(nameEffectOf({ fill: { colors: ["#FF0000"] } })).toBe("none");
    expect(nameEffectOf({ fill: { colors: ["#FF0000", "#0000FF"] } })).toBe("gradient");
    expect(nameEffectOf({ fill: { colors: ["#FF0000"], animation: "flow" } })).toBe("shimmer");
    expect(nameEffectOf({ fill: { colors: ["#FF0000"], animation: "shine" } })).toBe("chrome");
    expect(nameEffectOf({ fill: { colors: ["#FF0000"] }, effect: "razor" })).toBe("razor");
  });

  test("CSS-ul aspectului: efectul ales ajunge pe numele membrului, iar previzualizările doar la cerere", () => {
    const css = compileAppearanceCss([{ userId: "u7", appearance: { name: { fill: { colors: ["#00FF41"] }, effect: "matrix", bold: false } } }]);
    expect(css).toContain(':is(.gcs-root,#gcs-names) :is(.gcs-userLink[data-user-id="u7"],[data-name-user="u7"]){--nfx-c1:#00FF41');
    expect(css).toContain("font-weight:600");
    expect(css).toContain("animation:gcsNfxDigital");
    expect(css).not.toContain(".gcs-nfx--matrix");
    expect(compileAppearanceCss([], { previews: true })).toContain(".gcs-nfx--matrix");
  });
});
