import { describe, expect, test } from "vitest";
import { looksLikeSvg, sanitizeSvg } from "./svg";

describe("curățarea SVG (Aspect forumuri)", () => {
  test("desenul rămâne; scripturile, evenimentele, foreignObject și legăturile externe dispar", () => {
    const dirty = `<?xml version="1.0"?>
<svg viewBox="0 0 24 24" onload="alert(1)" width="24"><script>alert(2)</script>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#FF6A3D"/></linearGradient></defs>
  <path d="M3 3 H10 Z" fill="url(#g)" onclick="x()" style="fill:red"/>
  <image href="https://evil.example/x.png"/>
  <foreignObject><div>html</div></foreignObject>
  <use href="https://evil.example/s.svg#a"/><use href="#g"/>
  <a href="javascript:alert(3)"><circle r="2"/></a>
  <rect fill="url(https://evil.example/p)" width="2" height="2"/>
</svg>`;
    const clean = sanitizeSvg(dirty)!;
    expect(clean).toContain('<svg viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">');
    expect(clean).toContain('<linearGradient id="g"><stop offset="0" stop-color="#FF6A3D"></stop></linearGradient>');
    expect(clean).toContain('<path d="M3 3 H10 Z" fill="url(#g)"></path>');
    expect(clean).toContain('<use href="#g"></use>');
    for (const bad of ["script", "onload", "onclick", "style=", "image", "foreignObject", "evil.example", "javascript", "<a", "circle"]) expect(clean, bad).not.toContain(bad);
  });

  test("nu e SVG, are DOCTYPE / entități sau nu se închide → null", () => {
    expect(sanitizeSvg("<html><body>x</body></html>")).toBeNull();
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>')).toBeNull();
    expect(sanitizeSvg("<svg><path d='M0 0'/>")).toBeNull();
  });

  test("recunoașterea după text (SVG-ul nu are magic bytes)", () => {
    expect(looksLikeSvg(Buffer.from('﻿<?xml version="1.0"?>\n<!-- logo --><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(true);
    expect(looksLikeSvg(Buffer.from("<html><svg></svg></html>"))).toBe(false);
  });
});
