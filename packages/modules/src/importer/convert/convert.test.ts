import { GcsContentRenderer, type GcsDoc, type GcsDocNode } from "@gcs/core";
import { describe, expect, test } from "vitest";
import { coreSchemaFixture, prefixedSchemaFixture } from "../fixtures";
import { matchLegacyPath, stripLegacyPrefix } from "../legacyUrls";
import { convertBbcode, parseBbcode } from "./bbcode";
import type { GcsConvertContext } from "./context";
import { rewriteHref } from "./context";
import { convertHtml } from "./html";
import { renderImported } from "./index";
import { normalizeColor, parseFontSize } from "./style";

const OPTS = { embeds: ["youtube", "twitch", "medal", "image"], siteHost: "forum.test", labels: { quoteWrote: "{name} a scris:", spoiler: "Spoiler" } };
const renderer = new GcsContentRenderer();

const MEMBERS: Record<string, { id: string; name: string }> = {
  "1": { id: "cmadmin0001", name: "Vechiul Admin" },
  "2": { id: "cmana000002", name: "Ana Pop" },
};

function context(schema: GcsConvertContext["schema"], oldUrl: string): GcsConvertContext {
  return {
    schema,
    oldUrl,
    member: (id) => MEMBERS[id] ?? null,
    memberByName: (name) => Object.values(MEMBERS).find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null,
    post: (id) => (id === "100" || id === "200" ? { id: 501, topicId: 77 } : null),
    topic: (id) => (id === "11" || id === "20" ? { id: 78, slug: "configul-meu" } : null),
    forum: (id) => (id === "2" ? { id: 12, slug: "discutii-generale" } : null),
    attachment: (id) =>
      id === "50" || id === "60"
        ? { id: `att${id}xxxxxxx`, isImage: true, filename: "poza.png", width: 8, height: 8 }
        : id === "51"
          ? { id: "att51xxxxxxx", isImage: false, filename: "config.cfg", width: null, height: null }
          : null,
  };
}

const core = context("core-schema", "https://vechi.exemplu.ro/forum");
const prefixed = context("prefixed-schema", "https://comunitate.exemplu.ro");
const corePost = (pid: number) => String(coreSchemaFixture().tables.forums_posts!.find((p) => p.pid === pid)!.post);
const prefixedPost = (pid: number) => String(prefixedSchemaFixture().tables.xf_post!.find((p) => p.post_id === pid)!.message);

/** Toate nodurile unui document, în ordine. */
function nodes(doc: GcsDoc | null): GcsDocNode[] {
  const out: GcsDocNode[] = [];
  const walk = (n: GcsDocNode) => {
    out.push(n);
    (n.content ?? []).forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}
const ofType = (doc: GcsDoc | null, type: string) => nodes(doc).filter((n) => n.type === type);
const texts = (doc: GcsDoc | null) => ofType(doc, "text").map((t) => t.text).join("");

/** Documentul trebuie să treacă de renderer exact ca o postare nouă. */
function rendered(doc: GcsDoc | null) {
  expect(doc).not.toBeNull();
  return renderer.render(doc, OPTS);
}

describe("HTML (core-schema) → document GCS", () => {
  test("formatare, aliniere, link intern rescris, imagine atașată", () => {
    const r = convertHtml(corePost(100), core);
    const html = rendered(r.doc).html;
    expect(r.attachments).toEqual(["50"]);
    expect(ofType(r.doc, "image")[0]!.attrs).toMatchObject({ attachmentId: "att50xxxxxxx", width: 8, height: 8 });
    const link = ofType(r.doc, "text").find((t) => t.marks?.some((m) => m.type === "link"));
    expect(link?.marks).toContainEqual({ type: "link", attrs: { href: "/topic/78-configul-meu" } });
    expect(ofType(r.doc, "paragraph")[1]!.attrs).toEqual({ textAlign: "center" });
    expect(ofType(r.doc, "text").find((t) => t.text === "Important")!.marks).toEqual([{ type: "textStyle", attrs: { color: "#FF0000", fontSize: "18px" } }]);
    expect(html).toContain('<strong>regulile</strong>');
    expect(r.unrecognized).toBe(0);
  });

  test("citat legat de postarea nouă, mențiune, emoticon, embed YouTube", () => {
    const r = convertHtml(corePost(101), core);
    const quote = ofType(r.doc, "quote")[0]!;
    expect(quote.attrs).toEqual({ postId: 501, authorName: "Vechiul Admin", authorId: "cmadmin0001" });
    expect(texts({ type: "doc", content: quote.content! })).toBe("Salut!");
    expect(ofType(r.doc, "mention")[0]!.attrs).toEqual({ id: "cmadmin0001", label: "Vechiul Admin" });
    expect(texts(r.doc)).toContain("🙂");
    expect(ofType(r.doc, "embed")[0]!.attrs).toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    // Antetul vechi al citatului („X a spus:”) nu se dublează.
    expect(texts(r.doc)).not.toContain("a spus");
    const out = rendered(r.doc);
    expect(out.quotes).toEqual([501]);
    expect(out.mentions).toEqual(["cmadmin0001"]);
    expect(out.html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  test("cod cu limbaj, spoiler, listă; scripturile și linkurile periculoase dispar (XSS)", () => {
    const r = convertHtml(corePost(102), core);
    const code = ofType(r.doc, "codeBlock")[0]!;
    expect(code.attrs).toEqual({ language: "javascript" });
    expect(code.content![0]!.text).toBe('sensitivity "1.8"\n<b>nu e html</b>');
    expect(ofType(r.doc, "spoiler")[0]!.attrs).toBeUndefined();
    expect(ofType(r.doc, "listItem")).toHaveLength(2);
    expect(texts(r.doc)).toContain("click");
    const html = rendered(r.doc).html;
    expect(html).not.toMatch(/<script|javascript:|onerror|alert\(3\)/i);
    expect(html).toContain("&lt;b&gt;nu e html&lt;/b&gt;");
    expect(r.unrecognized).toBeGreaterThan(0);
  });

  test("citatul unei postări neimportate devine citat simplu cu autorul", () => {
    const r = convertHtml('<blockquote class="srcQuote" data-srcquote-username="Ion" data-srcquote-contentcommentid="999"><div class="srcQuote_contents"><p>text</p></div></blockquote>', core);
    expect(ofType(r.doc, "quote")).toHaveLength(0);
    expect(ofType(r.doc, "blockquote")[0]!.content![0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "Ion:", marks: [{ type: "bold" }] }] });
    rendered(r.doc);
  });

  test("linkurile vechi: postare, topic neimportat (calea veche, pentru redirect), extern, protocol-relativ", () => {
    expect(rewriteHref("<___base_url___>/topic/10-x/?do=findComment&comment=100", core)).toBe("/topic/77/post/501");
    expect(rewriteHref("https://vechi.exemplu.ro/forum/topic/999-altul/", core)).toBe("/forum/topic/999-altul/");
    expect(rewriteHref("https://vechi.exemplu.ro/forum/forum/2-generale/", core)).toBe("/forum/12-discutii-generale");
    expect(rewriteHref("https://vechi.exemplu.ro/forum/profile/2-ana/", core)).toBe("/members/cmana000002-ana-pop");
    expect(rewriteHref("https://exemplu.ro/pagina", core)).toBe("https://exemplu.ro/pagina");
    expect(rewriteHref("//cdn.exemplu.ro/a", core)).toBe("https://cdn.exemplu.ro/a");
    expect(rewriteHref("javascript:alert(1)", core)).toBeNull();
    expect(rewriteHref("data:text/html,x", core)).toBeNull();
  });

  test("stiluri ostile, tabele, titluri, liste numerotate, elemente necunoscute", () => {
    const r = convertHtml(
      '<p><span style="color:red;background:url(javascript:alert(1));font-size:40px">x</span></p>' +
        "<table><tr><th>A</th><td>b</td></tr></table><h1>Titlu</h1><ol start=\"3\"><li>trei</li></ol><marquee>vechi</marquee>" +
        '<p><sub>2</sub><sup>3</sup><code>cod</code></p><form><input value="x"></form>',
      core,
    );
    expect(ofType(r.doc, "text")[0]!.marks).toEqual([{ type: "textStyle", attrs: { color: "#FF0000", fontSize: "32px" } }]);
    expect(texts(r.doc)).toContain("A | b");
    expect(ofType(r.doc, "heading")[0]!.attrs).toEqual({ level: 2 });
    expect(ofType(r.doc, "orderedList")[0]!.attrs).toEqual({ start: 3 });
    expect(texts(r.doc)).toContain("vechi");
    expect(r.unrecognized).toBeGreaterThanOrEqual(3);
    expect(rendered(r.doc).html).not.toContain("url(");
  });

  test("imbricarea foarte adâncă și documentele foarte mari trec de validator", () => {
    const deep = convertHtml(`${"<blockquote>".repeat(40)}<p>adânc</p>${"</blockquote>".repeat(40)}`, core);
    expect(rendered(deep.doc).text).toBe("adânc");
    const big = convertHtml(Array.from({ length: 12_000 }, (_, i) => `<p>rândul ${i}</p>`).join(""), core);
    expect(rendered(big.doc).text).toContain("rândul 11999");
  });

  test("conținut gol sau doar spații → rezerva „…”", () => {
    expect(convertHtml("<p>   </p><br>", core).doc).toBeNull();
    expect(renderImported(null, "html", "<p> </p>", OPTS)).toMatchObject({ text: "…", fallback: true });
    // Un document respins de validator → textul simplu al sursei.
    const bad = { type: "doc", content: [{ type: "embed", attrs: { url: "https://exemplu.ro/nu-e-video" } }] } as GcsDoc;
    expect(renderImported(bad, "html", "<p>text <b>vechi</b></p>", OPTS)).toMatchObject({ text: "text vechi", fallback: true });
  });
});

describe("BBCode (prefixed-schema) → document GCS", () => {
  test("aliniere, mărime și culoare rotunjite, linkuri, atașament, listă cu cod inline", () => {
    const r = convertBbcode(prefixedPost(200), prefixed);
    const first = ofType(r.doc, "paragraph")[0]!;
    expect(first.attrs).toEqual({ textAlign: "center" });
    expect(first.content![0]).toEqual({ type: "text", text: "Lansare sâmbătă!", marks: [{ type: "textStyle", attrs: { fontSize: "18px", color: "#FF0000" } }] });
    const links = ofType(r.doc, "text").flatMap((t) => (t.marks ?? []).filter((m) => m.type === "link").map((m) => m.attrs!.href));
    expect(links).toEqual(["https://exemplu.ro/stiri", "/topic/78-configul-meu"]);
    expect(ofType(r.doc, "image")[0]!.attrs).toMatchObject({ attachmentId: "att60xxxxxxx" });
    expect(r.attachments).toEqual(["60"]);
    const items = ofType(r.doc, "listItem");
    expect(items).toHaveLength(2);
    expect(ofType({ type: "doc", content: items[0]!.content! }, "text")[1]).toEqual({ type: "text", text: "play.exemplu.ro", marks: [{ type: "code" }] });
    rendered(r.doc);
    expect(r.unrecognized).toBe(0);
  });

  test("citat, mențiune, YouTube, cod cu limbaj, spoiler cu titlu; imagine http, etichetă necunoscută, link periculos", () => {
    const r = convertBbcode(prefixedPost(201), prefixed);
    expect(ofType(r.doc, "quote")[0]!.attrs).toEqual({ postId: 501, authorName: "Vechiul Admin", authorId: "cmadmin0001" });
    expect(ofType(r.doc, "mention")[0]!.attrs).toEqual({ id: "cmadmin0001", label: "Vechiul Admin" });
    expect(ofType(r.doc, "embed")[0]!.attrs).toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(ofType(r.doc, "codeBlock")[0]).toEqual({ type: "codeBlock", attrs: { language: "php" }, content: [{ type: "text", text: '<?php echo "salut"; ?>' }] });
    expect(ofType(r.doc, "spoiler")[0]!.attrs).toEqual({ summary: "Final" });
    expect(ofType(r.doc, "image")).toHaveLength(0);
    expect(texts(r.doc)).toContain("[FOO]necunoscut[/FOO]");
    expect(texts(r.doc)).toContain("rău");
    expect(r.unrecognized).toBe(2);
    const html = rendered(r.doc).html;
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('href="http://nesigur.exemplu.ro/a.png"');
  });

  test("rândurile noi: unul = hardBreak, rând gol = paragraf nou, după un bloc nu se dublează", () => {
    const r = convertBbcode("a\nb\n\nc\n[QUOTE]q[/QUOTE]\nd", prefixed);
    expect(r.doc!.content!.map((n) => n.type)).toEqual(["paragraph", "paragraph", "blockquote", "paragraph"]);
    expect(r.doc!.content![0]!.content!.map((n) => n.type)).toEqual(["text", "hardBreak", "text"]);
    expect(texts({ type: "doc", content: [r.doc!.content![3]!] })).toBe("d");
  });

  test("liste fără închideri de element, numerotate, imbricate", () => {
    const r = convertBbcode("[LIST=1][*]unu[*]doi[LIST][*]a[/LIST][/LIST]", prefixed);
    const ol = ofType(r.doc, "orderedList")[0]!;
    expect(ol.content).toHaveLength(2);
    expect(ofType({ type: "doc", content: ol.content! }, "bulletList")).toHaveLength(1);
    rendered(r.doc);
  });

  test("etichete neînchise rămân text; linkurile goale se recunosc", () => {
    expect(texts(convertBbcode("[B]neînchis", prefixed).doc)).toBe("[B]neînchis");
    expect(texts(convertBbcode("text [/I] rătăcit", prefixed).doc)).toBe("text [/I] rătăcit");
    const r = convertBbcode("vezi https://exemplu.ro/a, apoi [URL]https://exemplu.ro/b[/URL]", prefixed);
    expect(ofType(r.doc, "text").filter((t) => t.marks?.[0]?.type === "link").map((t) => t.text)).toEqual(["https://exemplu.ro/a", "https://exemplu.ro/b"]);
  });

  test("XSS: atribute injectate, scheme periculoase, culori ostile", () => {
    const r = convertBbcode(
      '[URL="javascript:alert(1)"]x[/URL] [IMG]javascript:alert(2)[/IMG] [URL=http://a.ro" onmouseover="alert(3)]y[/URL] [COLOR=red;background:url(z)]t[/COLOR] <script>alert(4)</script>',
      prefixed,
    );
    const html = rendered(r.doc).html;
    // `javascript:` poate rămâne doar ca text vizibil, niciodată într-un atribut.
    expect(html).not.toMatch(/(href|src)="\s*javascript:|onmouseover|<script/i);
    expect(html).toContain("&lt;script&gt;");
    expect(ofType(r.doc, "text").some((t) => t.marks?.some((m) => m.type === "textStyle"))).toBe(false);
  });

  test("parserul păstrează conținutul brut din CODE", () => {
    const tree = parseBbcode("[CODE][B]nu[/B][/CODE]");
    expect(tree).toEqual([{ tag: "code", option: null, attrs: {}, children: [{ text: "[B]nu[/B]" }], raw: "[CODE]", end: "[/CODE]" }]);
  });
});

describe("stilurile", () => {
  test("culori și mărimi", () => {
    expect(normalizeColor("rgb(255, 0, 0)")).toBe("#FF0000");
    expect(normalizeColor("#abc")).toBe("#AABBCC");
    expect(normalizeColor("expression(alert(1))")).toBeNull();
    expect(parseFontSize("7")).toBe("24px");
    expect(parseFontSize("1")).toBe("12px");
    // Mărimea 4 (15px) e textul normal: fără marcă.
    expect(parseFontSize("4")).toBeNull();
    expect(parseFontSize("2em")).toBe("24px");
  });
});

describe("adresele vechi", () => {
  test.each([
    ["core-schema", "/topic/123-titlu/", "", { kind: "topic", id: "123", slug: "titlu" }],
    ["core-schema", "/topic/123-titlu/page/4/", "", { kind: "topic", id: "123", slug: "titlu", page: 4 }],
    ["core-schema", "/topic/123-titlu/", "?page=3", { kind: "topic", id: "123", slug: "titlu", page: 3 }],
    ["core-schema", "/topic/123-titlu/", "?do=findComment&comment=456", { kind: "post", id: "456" }],
    ["core-schema", "/forum/5-nume/", "", { kind: "forum", id: "5", slug: "nume" }],
    ["core-schema", "/profile/7-ana/", "", { kind: "member", id: "7" }],
    ["core-schema", "/index.php", "?/topic/123-titlu/", { kind: "topic", id: "123", slug: "titlu" }],
    ["core-schema", "/index.php", "?showtopic=123", { kind: "topic", id: "123" }],
    ["core-schema", "/", "?showforum=5", { kind: "forum", id: "5" }],
    ["core-schema", "/index.php", "?showuser=7", { kind: "member", id: "7" }],
    ["prefixed-schema", "/threads/titlu-lung.123/", "", { kind: "topic", id: "123", slug: "titlu-lung" }],
    ["prefixed-schema", "/threads/v1.2-lansare.123/page-4", "", { kind: "topic", id: "123", slug: "v1.2-lansare", page: 4 }],
    ["prefixed-schema", "/threads/titlu.123/post-456", "", { kind: "post", id: "456" }],
    ["prefixed-schema", "/posts/456/", "", { kind: "post", id: "456" }],
    ["prefixed-schema", "/forums/nume.5/", "", { kind: "forum", id: "5" }],
    ["prefixed-schema", "/members/ana.7/", "", { kind: "member", id: "7" }],
    ["prefixed-schema", "/index.php", "?threads/titlu.123/", { kind: "topic", id: "123", slug: "titlu" }],
  ] as const)("%s %s%s", (schema, path, search, expected) => {
    expect(matchLegacyPath(schema, path, search)).toEqual(expected);
  });

  test.each([
    ["core-schema", "/topic/abc/"],
    ["core-schema", "/members/cm123abc-ana"],
    ["prefixed-schema", "/members/cmabc123-ana"],
    ["prefixed-schema", "/topic/12-x"],
    ["prefixed-schema", "/threads/"],
  ] as const)("%s %s nu e o adresă veche", (schema, path) => {
    expect(matchLegacyPath(schema, path, "")).toBeNull();
  });

  test("prefixul căii vechi", () => {
    expect(stripLegacyPrefix("/forum/topic/1-x/", "/forum")).toBe("/topic/1-x/");
    expect(stripLegacyPrefix("/forum/topic/1-x/", "forum/")).toBe("/topic/1-x/");
    expect(stripLegacyPrefix("/altceva/topic/1-x/", "/forum")).toBeNull();
    expect(stripLegacyPrefix("/topic/1-x/", "")).toBe("/topic/1-x/");
  });
});
