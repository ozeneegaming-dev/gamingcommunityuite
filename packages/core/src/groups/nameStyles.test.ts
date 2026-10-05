import { describe, expect, test } from "vitest";
import { compileNameStylesCss } from "./nameStyles";

const gold = {
  key: "vip_gold",
  color: null,
  nameStyle: { gradient: ["#F4B740", "#FFF0B8", "#E8961C"], animated: true, bold: true },
};

describe("compileNameStylesCss", () => {
  test("vip_gold: gradient animat, ca în machetă", () => {
    const css = compileNameStylesCss([gold]);
    expect(css).toContain(".gcs-name--vip_gold{");
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
      ".gcs-name--admin{color:#FF4D57;text-shadow:0 0 10px rgba(255,77,87,.55);font-weight:700;font-style:italic}",
    );
  });

  test("culoarea din nameStyle are prioritate față de culoarea grupului", () => {
    const css = compileNameStylesCss([{ key: "member", color: "#111111", nameStyle: { color: "#ECEDF1" } }]);
    expect(css).toContain("color:#ECEDF1");
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
