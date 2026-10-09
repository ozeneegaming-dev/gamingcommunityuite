import { describe, expect, test } from "vitest";
import { GcsValidationError } from "../errors";
import { contentRefs, GcsContentRenderer, sanitizeContentHtml, type GcsRenderOptions } from "./renderer";

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

  test("mențiune → link către profil (cu `data-user-id` pentru hover card); id-ul e extras", () => {
    const out = render(doc(p({ type: "mention", attrs: { id: "user_1", label: "Krypt" } })));
    expect(out.html).toBe('<p><a class="gcs-userLink gcs-mention" href="/members/user_1" data-user="user_1" data-user-id="user_1">@Krypt</a></p>');
    expect(out.mentions).toEqual(["user_1"]);
    expect(out.groupMentions).toEqual([]);
    expect(out.text).toBe("@Krypt");
  });

  test("mențiune cu `kind: user` (formatul nou) = mențiunea unui membru", () => {
    const out = render(doc(p({ type: "mention", attrs: { id: "user_1", label: "Krypt", kind: "user" } })));
    expect(out.html).toContain('data-user-id="user_1"');
    expect(out.mentions).toEqual(["user_1"]);
    expect(out.json.content![0]!.content![0]).toEqual({ type: "mention", attrs: { id: "user_1", label: "Krypt", kind: "user" } });
  });

  test("mențiunea unui grup permis → pastila grupului, cu numele curent al grupului", () => {
    const groups = new Map([["5", { name: "Moderator" }]]);
    const out = render(doc(p(text("Salut "), { type: "mention", attrs: { id: "5", label: "Mods vechi", kind: "group" } })), { groups });
    expect(out.html).toBe('<p>Salut <a class="gcs-groupMention" href="/members?group=5" data-group-id="5">@Moderator</a></p>');
    expect(out.groupMentions).toEqual([5]);
    expect(out.mentions).toEqual([]);
    expect(out.text).toBe("Salut @Moderator");
    expect(out.json.content![0]!.content![1]).toEqual({ type: "mention", attrs: { id: "5", label: "Moderator", kind: "group" } });
  });

  test("mențiunea unui grup nepermis (sau fără lista de grupuri) devine text simplu, și în JSON", () => {
    const d = doc(p({ type: "mention", attrs: { id: "7", label: "Admin", kind: "group" } }, text(" ajutor")));
    for (const out of [render(d), render(d, { groups: new Map([["5", { name: "Moderator" }]]) })]) {
      expect(out.html).toBe("<p>@Admin ajutor</p>");
      expect(out.groupMentions).toEqual([]);
      expect(out.json.content![0]!.content).toEqual([{ type: "text", text: "@Admin" }, { type: "text", text: " ajutor" }]);
      expect(out.text).toBe("@Admin ajutor");
    }
  });

  test("numele lung al unui grup e scurtat la 40 de caractere în eticheta salvată", () => {
    const groups = new Map([["5", { name: "G".repeat(64) }]]);
    const out = render(doc(p({ type: "mention", attrs: { id: "5", label: "G", kind: "group" } })), { groups });
    expect(out.json.content![0]!.content![0]!.attrs!.label).toBe("G".repeat(40));
  });

  test("un `kind` necunoscut sau un id de grup invalid → refuzat", () => {
    expectInvalid(doc(p({ type: "mention", attrs: { id: "5", label: "X", kind: "role" } })));
    expectInvalid(doc(p({ type: "mention", attrs: { id: "5\" onmouseover=\"x", label: "X", kind: "group" } })));
  });

  test("HTML-ul vechi (salvat înainte de `data-user-id`) trece neschimbat prin sanitizer; atributele noi sunt permise", () => {
    const old = '<p><a class="gcs-userLink gcs-mention" href="/members/u1" data-user="u1">@Ana</a></p>';
    expect(sanitizeContentHtml(old)).toBe(old);
    const pill = '<p><a class="gcs-groupMention" href="/members?group=5" data-group-id="5">@Moderator</a></p>';
    expect(sanitizeContentHtml(pill)).toBe(pill);
    expect(sanitizeContentHtml('<a class="gcs-groupMention" data-group-id="5" onmouseover="x" style="color:red">@X</a>')).toBe('<a class="gcs-groupMention" data-group-id="5">@X</a>');
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

describe("GcsContentRenderer — formatarea din etapa 5", () => {
  test("culoarea, mărimea, evidențierea, indicii și alinierea devin HTML cu stiluri permise", () => {
    const out = render(
      doc(
        { type: "paragraph", attrs: { textAlign: "center" }, content: [text("roșu", [{ type: "textStyle", attrs: { color: "#D62839", fontSize: "18px" } }])] },
        { type: "heading", attrs: { level: 2, textAlign: "right" }, content: [text("titlu")] },
        p(text("x", [{ type: "highlight", attrs: { color: "#FDE68A" } }]), text("2", [{ type: "superscript" }]), text("i", [{ type: "subscript" }])),
        { type: "paragraph", attrs: { textAlign: null }, content: [text("implicit")] },
      ),
    );
    expect(out.html).toBe(
      '<p style="text-align:center"><span style="color:#D62839;font-size:18px">roșu</span></p>' +
        '<h2 style="text-align:right">titlu</h2>' +
        '<p><mark style="background-color:#FDE68A">x</mark><sup>2</sup><sub>i</sub></p>' +
        "<p>implicit</p>",
    );
  });

  test.each([
    ["culoare cu nume", { type: "textStyle", attrs: { color: "red" } }],
    ["culoare cu CSS strecurat", { type: "textStyle", attrs: { color: "#fff;background:url(https://x.example/a.png)" } }],
    ["culoare cu url(", { type: "textStyle", attrs: { color: "url(javascript:alert(1))" } }],
    ["mărime în afara listei", { type: "textStyle", attrs: { fontSize: "200px" } }],
    ["mărime cu expresie", { type: "textStyle", attrs: { fontSize: "expression(alert(1))" } }],
    ["evidențiere în afara paletei", { type: "highlight", attrs: { color: "#000000" } }],
    ["atribut style injectat", { type: "textStyle", attrs: { style: "background:url(x)" } }],
  ])("%s → refuzat", (_name, mark) => {
    expectInvalid(doc(p(text("x", [mark]))));
  });

  test("alinierea acceptă doar cele 4 valori; `style` pe paragraf e refuzat", () => {
    expectInvalid(doc({ type: "paragraph", attrs: { textAlign: "left;position:fixed" }, content: [text("x")] }));
    expectInvalid(doc({ type: "paragraph", attrs: { style: "color:red" }, content: [text("x")] }));
  });

  test("sanitizer-ul păstrează doar proprietățile și valorile permise din `style`", () => {
    const html = sanitizeContentHtml(
      '<p style="text-align:center;position:fixed"><span style="color:#D62839;background-image:url(https://x.example/a.png)">a</span>' +
        '<span style="font-size:999px">b</span><mark style="background-color:javascript:alert(1)">c</mark></p>',
    );
    expect(html).toBe('<p style="text-align:center"><span style="color:#D62839">a</span><span>b</span><mark>c</mark></p>');
  });
});

describe("contentRefs", () => {
  test("mențiunile și citatele de pe primul nivel; ce e în citat se ignoră", () => {
    const mention = (id: string) => ({ type: "mention", attrs: { id, label: id } });
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [mention("u1"), { type: "text", text: " salut " }, mention("u2"), mention("u1")] },
        {
          type: "quote",
          attrs: { postId: 7, authorName: "Ana" },
          content: [{ type: "paragraph", content: [mention("u3")] }, { type: "quote", attrs: { postId: 3, authorName: "B" }, content: [] }],
        },
        { type: "quote", attrs: { postId: "x", authorName: "C" }, content: [] },
      ],
    };
    expect(contentRefs(doc)).toEqual({ mentions: ["u1", "u2"], groups: [], quotes: [7] });
    expect(contentRefs(null)).toEqual({ mentions: [], groups: [], quotes: [] });
  });

  test("mențiunile de grup sunt separate de cele ale membrilor (și ignorate în citate)", () => {
    const group = (id: string) => ({ type: "mention", attrs: { id, label: `G${id}`, kind: "group" } });
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [group("5"), { type: "mention", attrs: { id: "u1", label: "Ana", kind: "user" } }, group("5"), group("x")] },
        { type: "quote", attrs: { postId: 7, authorName: "Ana" }, content: [{ type: "paragraph", content: [group("9")] }] },
      ],
    };
    expect(contentRefs(doc)).toEqual({ mentions: ["u1"], groups: [5], quotes: [7] });
  });
});
