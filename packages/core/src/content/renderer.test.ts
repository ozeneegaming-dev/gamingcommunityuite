import { describe, expect, test } from "vitest";
import { GcsValidationError } from "../errors";
import { GcsContentRenderer, type GcsRenderOptions } from "./renderer";

const renderer = new GcsContentRenderer();
const opts: GcsRenderOptions = {
  embeds: ["youtube", "twitch", "medal", "image"],
  siteHost: "forum.example",
  labels: { quoteWrote: "{name} a scris:", spoiler: "Spoiler" },
};

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string, marks?: unknown[]) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });

function render(d: unknown, o: Partial<GcsRenderOptions> = {}) {
  return renderer.render(d, { ...opts, ...o });
}

function expectInvalid(d: unknown) {
  expect(() => render(d)).toThrow(GcsValidationError);
}

describe("GcsContentRenderer — randare", () => {
  test("paragrafe și mărci de bază", () => {
    const out = render(
      doc(p(text("Salut "), text("lume", [{ type: "bold" }, { type: "italic" }]), text(" și "), text("cod", [{ type: "code" }]))),
    );
    expect(out.html).toBe("<p>Salut <strong><em>lume</em></strong> și <code>cod</code></p>");
    expect(out.text).toBe("Salut lume și cod");
  });

  test("textul e escapat", () => {
    const out = render(doc(p(text("<script>alert(1)</script> & \"x\""))));
    expect(out.html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "x"</p>');
  });

  test("link: doar http(s), mailto și relative; primește rel și target", () => {
    const out = render(doc(p(text("site", [{ type: "link", attrs: { href: "https://example.com/a?b=1&c=2" } }]))));
    expect(out.html).toBe(
      '<p><a href="https://example.com/a?b=1&amp;c=2" rel="nofollow ugc noopener" target="_blank">site</a></p>',
    );
  });

  test("titluri, liste, cod cu limbaj, citat simplu, separator, rând nou", () => {
    const out = render(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Titlu")] },
        { type: "bulletList", content: [{ type: "listItem", content: [p(text("a"))] }] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(text("b"))] }] },
        { type: "codeBlock", attrs: { language: "cfg" }, content: [text("cl_crosshairsize 2.5; <x>")] },
        { type: "blockquote", content: [p(text("citat"))] },
        { type: "horizontalRule" },
        p(text("x"), { type: "hardBreak" }, text("y")),
      ),
    );
    expect(out.html).toBe(
      "<h2>Titlu</h2><ul><li><p>a</p></li></ul><ol start=\"3\"><li><p>b</p></li></ol>" +
        '<pre><code class="language-cfg">cl_crosshairsize 2.5; &lt;x&gt;</code></pre>' +
        "<blockquote><p>citat</p></blockquote><hr /><p>x<br />y</p>",
    );
  });

  test("mențiune → link către profil; id-ul e extras", () => {
    const out = render(doc(p({ type: "mention", attrs: { id: "user_1", label: "Krypt" } })));
    expect(out.html).toBe('<p><a class="gcs-userLink gcs-mention" href="/members/user_1" data-user="user_1">@Krypt</a></p>');
    expect(out.mentions).toEqual(["user_1"]);
    expect(out.text).toBe("@Krypt");
  });

  test("citatul unei postări are autorul și id-ul postării", () => {
    const out = render(
      doc({ type: "quote", attrs: { postId: 12, authorId: "u1", authorName: "ShadowRO" }, content: [p(text("Ce setări folosiți?"))] }),
    );
    expect(out.html).toBe(
      '<blockquote class="gcs-quote" data-post="12"><span class="gcs-quote__author">ShadowRO a scris:</span><p>Ce setări folosiți?</p></blockquote>',
    );
    expect(out.quotes).toEqual([12]);
  });

  test("spoiler", () => {
    const out = render(doc({ type: "spoiler", content: [p(text("final"))] }));
    expect(out.html).toBe('<details class="gcs-spoiler"><summary>Spoiler</summary><p>final</p></details>');
  });

  test("imagine dintr-un atașament; id-ul e extras", () => {
    const out = render(doc({ type: "image", attrs: { attachmentId: "att_1", alt: "poză", width: 640, height: 360 } }));
    expect(out.html).toBe('<img class="gcs-postImage" src="/files/att_1" alt="poză" width="640" height="360" loading="lazy" />');
    expect(out.attachments).toEqual(["att_1"]);
  });

  test("un link spre `/files/{id}` (fișier atașat) e extras ca atașament", () => {
    const out = render(doc(p(text("autoexec.cfg", [{ type: "link", attrs: { href: "/files/att_9" } }]))));
    expect(out.attachments).toEqual(["att_9"]);
  });

  test("embed YouTube → iframe youtube-nocookie, în sandbox", () => {
    const out = render(doc({ type: "embed", attrs: { url: "https://youtu.be/dQw4w9WgXcQ" } }));
    expect(out.html).toBe(
      '<div class="gcs-embed gcs-embed--youtube"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" ' +
        'title="youtube" loading="lazy" allowfullscreen="" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"></iframe></div>',
    );
  });

  test("un embed dezactivat din setări devine link simplu", () => {
    const out = render(doc({ type: "embed", attrs: { url: "https://youtu.be/dQw4w9WgXcQ" } }), { embeds: [] });
    expect(out.html).toBe(
      '<p><a href="https://youtu.be/dQw4w9WgXcQ" rel="nofollow ugc noopener" target="_blank">https://youtu.be/dQw4w9WgXcQ</a></p>',
    );
  });

  test("întoarce JSON-ul normalizat (doar câmpurile cunoscute)", () => {
    const out = render(doc(p(text("a"))));
    expect(out.json).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] });
  });

  test("documentul gol e refuzat; un paragraf gol nu", () => {
    expectInvalid(doc());
    expectInvalid(doc(p()));
    expect(render(doc(p(text("a")), { type: "paragraph" })).html).toBe("<p>a</p><p></p>");
  });
});

describe("GcsContentRenderer — XSS (Review Focus #4)", () => {
  test.each([
    ["javascript:", "javascript:alert(1)"],
    ["JavaScript cu spații", " JaVaScRiPt:alert(1)"],
    ["data:", "data:text/html;base64,PHNjcmlwdD4="],
    ["vbscript:", "vbscript:msgbox(1)"],
  ])("link cu %s → refuzat", (_name, href) => {
    expectInvalid(doc(p(text("x", [{ type: "link", attrs: { href } }]))));
  });

  test("imagine cu src extern nepermis sau atribute injectate → refuzată", () => {
    expectInvalid(doc({ type: "image", attrs: { src: "javascript:alert(1)" } }));
    expectInvalid(doc({ type: "image", attrs: { src: "data:image/png;base64,AAAA" } }));
    expectInvalid(doc({ type: "image", attrs: { attachmentId: "att_1", onerror: "alert(1)" } }));
    expectInvalid(doc({ type: "image", attrs: { attachmentId: "att\"><script>" } }));
  });

  test("atribute necunoscute pe noduri sau mărci → refuzate", () => {
    expectInvalid(doc({ type: "paragraph", attrs: { style: "background:url(x)" }, content: [text("a")] }));
    expectInvalid(doc(p(text("a", [{ type: "bold", attrs: { class: "evil" } }]))));
    expectInvalid(doc(p({ type: "text", text: "a", onclick: "x" })));
  });

  test("noduri și mărci necunoscute → refuzate", () => {
    expectInvalid(doc({ type: "iframe", attrs: { src: "https://evil.example" } }));
    expectInvalid(doc({ type: "html", content: "<script>alert(1)</script>" }));
    expectInvalid(doc(p(text("a", [{ type: "textStyle", attrs: { color: "red" } }]))));
  });

  test("embed din domeniu nepermis → refuzat", () => {
    expectInvalid(doc({ type: "embed", attrs: { url: "https://evil.example/video" } }));
  });

  test("nivel de titlu, limbaj de cod și mențiune invalide → refuzate", () => {
    expectInvalid(doc({ type: "heading", attrs: { level: 1 }, content: [text("a")] }));
    expectInvalid(doc({ type: "codeBlock", attrs: { language: "js\"><script>" }, content: [text("a")] }));
    expectInvalid(doc(p({ type: "mention", attrs: { id: "u1\" onmouseover=\"x", label: "a" } })));
  });

  test("structură invalidă: text la nivel de bloc, listă fără listItem", () => {
    expectInvalid(doc(text("a")));
    expectInvalid(doc({ type: "bulletList", content: [p(text("a"))] }));
  });

  test("documente uriașe sau prea adânci → refuzate", () => {
    const many = doc(...Array.from({ length: 50_000 }, () => p(text("a"))));
    expectInvalid(many);
    let deep: unknown = p(text("a"));
    for (let i = 0; i < 40; i++) deep = { type: "blockquote", content: [deep] };
    expectInvalid(doc(deep));
  });

  test("ce nu e obiect → refuzat", () => {
    expectInvalid(null);
    expectInvalid("<p>html</p>");
    expectInvalid({ type: "paragraph" });
  });
});
