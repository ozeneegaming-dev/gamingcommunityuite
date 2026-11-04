import { describe, expect, test } from "vitest";
import { fieldSearchText, parseFieldDefs, parseFieldValues, youtubeId } from "./fields";
import { fillBlockTemplate, sanitizePageHtml, splitPageTags } from "./html";
import { layoutOf, parseLayout } from "./layout";

describe("câmpurile bazelor de date", () => {
  test("definițiile: chei unice, opțiuni obligatorii la select, filtre doar pe tipurile permise", () => {
    const { defs, errors } = parseFieldDefs([
      { key: "game", label: "Joc", type: "select", options: "CS2\nMinecraft\nCS2", filter: true, listed: true },
      { key: "game", label: "Dublură", type: "text" },
      { key: "notes", label: "Note", type: "textarea", filter: true },
      { key: "Bad Key", label: "X", type: "text" },
      { key: "kind", label: "Tip", type: "select" },
    ]);
    expect(defs[0]).toMatchObject({ key: "game", options: ["CS2", "Minecraft"], filter: true, listed: true, position: "bottom" });
    expect(defs[2]!.filter).toBe(false);
    expect(errors).toEqual({ "fields.1.key": "duplicate", "fields.3.key": "invalid_key", "fields.4.options": "required" });
  });

  test("valorile: obligatoriu, select din opțiuni, URL, dată, număr, YouTube, server cunoscut", () => {
    const { defs } = parseFieldDefs([
      { key: "game", label: "Joc", type: "select", options: ["CS2"], required: true },
      { key: "site", label: "Site", type: "url" },
      { key: "day", label: "Zi", type: "date" },
      { key: "n", label: "N", type: "number" },
      { key: "yt", label: "Video", type: "youtube" },
      { key: "srv", label: "Server", type: "server" },
      { key: "ok", label: "Bifă", type: "checkbox" },
    ]);
    const bad = parseFieldValues(defs, { game: "Doom", site: "javascript:alert(1)", day: "2026-13-40", n: "abc", yt: "https://evil.example/watch?v=x", srv: 9 }, { servers: new Set([1]) });
    expect(bad.errors).toEqual({ "field.game": "invalid_choice", "field.site": "invalid_url", "field.day": "invalid_date", "field.n": "invalid_number", "field.yt": "invalid_url", "field.srv": "invalid_choice" });
    const good = parseFieldValues(defs, { game: "CS2", site: "https://gcs.test", day: "2026-11-04", n: "2,5", yt: "https://youtu.be/dQw4w9WgXcQ", srv: "1", ok: "on" }, { servers: new Set([1]) });
    expect(good).toEqual({ errors: {}, values: { game: "CS2", site: "https://gcs.test", day: "2026-11-04", n: 2.5, yt: "dQw4w9WgXcQ", srv: 1, ok: true } });
    expect(parseFieldValues(defs, {}).errors).toEqual({ "field.game": "required" });
    expect(fieldSearchText(defs, good.values)).toBe("CS2 https://gcs.test 2026-11-04 2.5");
  });

  test("id-ul YouTube din formele obișnuite de adresă", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

describe("layout-ul constructorului", () => {
  test("coloanele după aspect, blocurile invalide raportate pe id, id-urile unice", () => {
    const { layout, errors } = parseLayout({
      width: "wide",
      sections: [
        {
          id: "s1",
          columns: "2-1",
          blocks: [
            [{ id: "b1", type: "content", doc: null }, { id: "b2", type: "nope" }],
            [{ id: "b1", type: "html", html: "<p>x</p>" }],
            [{ id: "b3", type: "image", link: "/ok" }],
          ],
        },
      ],
    });
    expect(layout.width).toBe("wide");
    expect(layout.sections[0]!.blocks.map((c) => c.map((b) => b.id))).toEqual([["b1"], ["b3"]]);
    expect(errors).toEqual({ "block.b2": "invalid_block", "block.b1": "duplicate" });
  });

  test("un link nesigur pe imagine e refuzat; layout-ul salvat își păstrează HTML-ul randat", () => {
    expect(parseLayout({ sections: [{ id: "s", columns: "1", blocks: [[{ id: "i", type: "image", link: "javascript:x" }]] }] }).errors).toEqual({ "block.i": "invalid_url" });
    const saved = layoutOf({ v: 1, sections: [{ id: "s", columns: "1", blocks: [[{ id: "c", type: "content", doc: {}, html: "<p>gata</p>" }]] }] });
    expect(saved.sections[0]!.blocks[0]![0]).toMatchObject({ type: "content", html: "<p>gata</p>" });
  });
});

describe("HTML-ul paginilor", () => {
  test("fără scripturi, evenimente, URL-uri javascript, stiluri cu url(); iframe doar de la furnizori video", () => {
    const html = sanitizePageHtml(
      `<h1 class="hero" onclick="x()">Salut</h1><script>alert(1)</script><a href="javascript:alert(1)">x</a>` +
        `<div style="color: red; background: url(evil)">y</div><iframe src="https://evil.test/"></iframe><iframe src="https://www.youtube.com/embed/abc"></iframe>` +
        `<a href="https://gcs.test" target="_blank">z</a><img src="data:image/svg+xml;base64,AAA"><form><input></form>`,
    );
    expect(html).not.toMatch(/script|onclick|javascript:|url\(|evil\.test|<form|<input|svg\+xml/);
    expect(html).toContain('<h1 class="hero">Salut</h1>');
    expect(html).toContain('style="color:red"');
    expect(html).toContain('src="https://www.youtube.com/embed/abc"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  test("etichetele {block} / {database} despart HTML-ul; șablonul blocului escapează valorile", () => {
    expect(splitPageTags('<p>a</p>{block="banner"}<p>b</p>{database="ghiduri"}')).toEqual([
      { kind: "html", html: "<p>a</p>" },
      { kind: "block", key: "banner" },
      { kind: "html", html: "<p>b</p>" },
      { kind: "database", key: "ghiduri" },
    ]);
    const fields = [
      { key: "title", label: "Titlu", type: "text" as const },
      { key: "img", label: "Imagine", type: "image" as const },
    ];
    expect(fillBlockTemplate("<h2>{{title}}</h2><img src=\"{{img}}\">{{nope}}", fields, { title: "<b>Hi</b>", img: "javascript:x" })).toBe('<h2>&lt;b&gt;Hi&lt;/b&gt;</h2><img src="">');
  });
});
