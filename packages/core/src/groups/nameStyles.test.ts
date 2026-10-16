import { describe, expect, test } from "vitest";
import { compileNameStylesCss, isPlainNameColor } from "./nameStyles";

const gold = {
  key: "vip_gold",
  color: null,
  nameStyle: { gradient: ["#F4B740", "#FFF0B8", "#E8961C"], animated: true, bold: true },
};

describe("compileNameStylesCss", () => {
  test("vip_gold: gradient animat, ca în machetă", () => {
    const css = compileNameStylesCss([gold]);
    expect(css).toContain(":is(.gcs-root,#gcs-names) .gcs-name--vip_gold{");
    expect(css).toContain("background:linear-gradient(90deg,#F4B740,#FFF0B8,#E8961C,#F4B740)");
    expect(css).toContain("background-clip:text");
    expect(css).toContain("animation:gcsShimmer");
    expect(css).toContain("@keyframes gcsShimmer");
  });

  test("culoare, glow, bold și italic", () => {
    const css = compileNameStylesCss([
      { key: "admin", color: "#FF4D57", nameStyle: { glow: "#FF4D57", bold: true, italic: true } },
    ]);
    expect(css).toContain(
      "{color:#FF4D57;-webkit-text-fill-color:currentColor;text-shadow:0 0 10px rgba(255,77,87,.55);font-weight:700;font-style:italic}",
    );
  });

  test("stilul bate culorile linkurilor din teme (Nova, Clasic, CSS-ul temei), și la hover: specificitate de ID", () => {
    const css = compileNameStylesCss([{ key: "admin", color: "#FF4D57", nameStyle: null }]);
    // `:is(.gcs-root,#gcs-names)` are specificitatea unui ID (orice regulă de temă pe clase pierde), fără `!important`.
    expect(css).toContain(".gcs-name--admin,:is(.gcs-root,#gcs-names) .gcs-name--admin{color:#FF4D57;-webkit-text-fill-color:currentColor");
  });

  test("numele simple, aproape albe (Membru: textul temei închise), urmează textul temei pe cele luminoase", () => {
    const css = compileNameStylesCss([
      { key: "member", color: "#ECEDF1", nameStyle: null },
      { key: "white", color: "#FFFFFF", nameStyle: null },
    ]);
    // Pe temele luminoase `--gcs-name-plain` e culoarea textului; pe cele închise lipsește, deci rămâne culoarea grupului.
    expect(css).toContain(".gcs-name--member{color:var(--gcs-name-plain, #ECEDF1);-webkit-text-fill-color:currentColor");
    expect(css).toContain(".gcs-name--white{color:var(--gcs-name-plain, #FFFFFF);");
  });

  test("culorile grupurilor rămân cum sunt (și cele deschise, dar colorate sau mai închise, ca argintiul VIP)", () => {
    expect(isPlainNameColor("#ECEDF1")).toBe(true);
    expect(isPlainNameColor("#FFFFFF")).toBe(true);
    for (const c of ["#D8DFEA", "#A1A7B4", "#FFF0B8", "#F4B740", "#5EA2FF", "#FF4D57", "#6B7280"]) expect(isPlainNameColor(c), c).toBe(false);
    const css = compileNameStylesCss([
      { key: "vip_silver", color: "#D8DFEA", nameStyle: { color: "#D8DFEA" } },
      { key: "guest", color: "#A1A7B4", nameStyle: null },
    ]);
    expect(css).not.toContain("--gcs-name-plain");
    expect(css).toContain("{color:#D8DFEA;");
  });

  test("gradientul: textul transparent și fundalul tăiat pe litere, oricum ar fi setată umplerea de temă", () => {
    const css = compileNameStylesCss([gold]);
    expect(css).toContain("color:transparent;-webkit-text-fill-color:transparent");
  });

  test("culoarea din nameStyle are prioritate față de culoarea grupului", () => {
    const css = compileNameStylesCss([{ key: "member", color: "#111111", nameStyle: { color: "#5EA2FF" } }]);
    expect(css).toContain("color:#5EA2FF");
    expect(css).not.toContain("#111111");
  });

  test("valorile invalide sunt ignorate: nu se poate injecta CSS", () => {
    const evil = "red;}body{display:none";
    const css = compileNameStylesCss([
      { key: "member", color: evil, nameStyle: { color: evil, glow: evil, gradient: [evil, "#000000"] } },
      { key: "x}body{display:none", color: "#FFFFFF", nameStyle: null },
    ]);
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("red;");
    expect(css).not.toContain("body{");
  });

  test("iconul e păstrat doar dacă e un emoji sau un text scurt, fără ghilimele", () => {
    const ok = compileNameStylesCss([{ key: "vip_legend", color: null, nameStyle: { icon: "👑" } }]);
    expect(ok).toContain('.gcs-name--vip_legend::before{content:"👑"');
    const bad = compileNameStylesCss([{ key: "member", color: null, nameStyle: { icon: '"}body{x:y' } }]);
    expect(bad).not.toContain(".gcs-name--member::before");
    expect(bad).not.toContain("body{");
  });

  test("conține exact un bloc prefers-reduced-motion", () => {
    const css = compileNameStylesCss([
      gold,
      { key: "vip_legend", color: null, nameStyle: { gradient: ["#B794FF", "#FF7AC6"], animated: true } },
      { key: "member", color: "#ECEDF1", nameStyle: null },
    ]);
    expect(css.match(/prefers-reduced-motion/g)).toHaveLength(1);
    expect(compileNameStylesCss([]).match(/prefers-reduced-motion/g)).toHaveLength(1);
  });
});
