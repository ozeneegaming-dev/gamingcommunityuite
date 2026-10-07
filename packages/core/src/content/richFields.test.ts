import { describe, expect, test } from "vitest";
import { GcsValidationError } from "../errors";
import { GCS_DOC_MARKS, GCS_DOC_NODES } from "./renderer";
import { GCS_RICH_FIELDS, isRichDoc, plainTextToDoc, richDocIssue, richValueToDoc } from "./richFields";
import { renderRichField, richFieldError, richFieldHtml } from "./richRender";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string, marks?: unknown[]) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const image = (attrs: Record<string, unknown>) => ({ type: "image", attrs });

/** Câmpul și codul erorii aruncate de `fn`. */
function failure(fn: () => unknown): { fields: Record<string, string>; params?: Record<string, string> } {
  try {
    fn();
  } catch (error) {
    if (error instanceof GcsValidationError) return { fields: error.fields, ...(error.params ? { params: error.params } : {}) };
    throw error;
  }
  throw new Error("nu a aruncat");
}

describe("textul vechi → document", () => {
  test("un paragraf pe rând; rândurile goale devin paragrafe goale", () => {
    expect(plainTextToDoc("Fără spam.\r\nRespect.\n\nAdminii decid.")).toEqual(
      doc(p(text("Fără spam.")), p(text("Respect.")), { type: "paragraph" }, p(text("Adminii decid."))),
    );
  });

  test("rândurile goale de la capete și caracterele de control dispar; textul gol → null", () => {
    expect(plainTextToDoc("\n\nSalut\u0007\n\n  ")).toEqual(doc(p(text("Salut"))));
    expect(plainTextToDoc("   \n\t\n")).toBeNull();
    expect(plainTextToDoc("")).toBeNull();
  });

  test("richValueToDoc: textul se convertește, documentul rămâne, golul e null", () => {
    expect(richValueToDoc("a")).toEqual(doc(p(text("a"))));
    expect(richValueToDoc(doc(p(text("x"))))).toEqual(doc(p(text("x"))));
    expect(richValueToDoc("")).toBeNull();
    expect(richValueToDoc(null)).toBeNull();
    expect(isRichDoc(doc())).toBe(true);
    expect(isRichDoc("doc")).toBe(false);
  });
});

describe("profilurile câmpurilor", () => {
  test("folosesc doar noduri și mărci cunoscute de renderer", () => {
    for (const profile of Object.values(GCS_RICH_FIELDS)) {
      for (const n of profile.nodes) expect(Object.keys(GCS_DOC_NODES)).toContain(n);
      for (const m of profile.marks) expect(Object.keys(GCS_DOC_MARKS)).toContain(m);
    }
  });

  test("semnătura acceptă tot ce scria editorul complet, fără video", () => {
    expect(GCS_RICH_FIELDS.signature.nodes).not.toContain("embed");
    for (const n of Object.keys(GCS_DOC_NODES).filter((k) => k !== "embed")) expect(GCS_RICH_FIELDS.signature.nodes).toContain(n);
  });

  test("richDocIssue: nod sau marcă nepermisă, imagine din atașamente, prea multe imagini", () => {
    const rules = GCS_RICH_FIELDS.chatRules;
    expect(richDocIssue(doc(p(text("a", [{ type: "bold" }]))), rules)).toBeNull();
    expect(richDocIssue(doc(image({ src: "https://cdn.example/a.png" })), rules)).toBe("format_not_allowed");
    expect(richDocIssue(doc(p(text("a", [{ type: "code" }]))), GCS_RICH_FIELDS.profileText)).toBe("format_not_allowed");
    const sig = GCS_RICH_FIELDS.signature;
    expect(richDocIssue(doc(image({ attachmentId: "att_1" })), sig)).toBe("format_not_allowed");
    expect(richDocIssue(doc(image({ src: "https://cdn.example/a.png" }), image({ src: "https://cdn.example/b.png" })), sig)).toBe("too_many_images");
    expect(richDocIssue(doc(image({ src: "https://cdn.example/a.png" }), image({ src: "https://cdn.example/b.png" })), sig, 2)).toBeNull();
  });
});

describe("renderRichField", () => {
  test("semnătura formatată: culoare, mărime, aliniere, link și o imagine din adresă", () => {
    const out = renderRichField(
      doc(
        { type: "paragraph", attrs: { textAlign: "center" }, content: [text("GG", [{ type: "bold" }, { type: "textStyle", attrs: { color: "#FF6B74", fontSize: "18px" } }])] },
        p(text("clan", [{ type: "link", attrs: { href: "https://clan.example" } }])),
        image({ src: "https://cdn.example/banner.png", alt: "" }),
      ),
      GCS_RICH_FIELDS.signature,
    );
    expect(out.html).toBe(
      '<p style="text-align:center"><strong><span style="color:#FF6B74;font-size:18px">GG</span></strong></p>' +
        '<p><a href="https://clan.example" rel="nofollow ugc noopener" target="_blank">clan</a></p>' +
        '<img class="gcs-postImage" src="https://cdn.example/banner.png" alt="" loading="lazy" />',
    );
    expect(out.text).toBe("GG\nclan");
  });

  test("textul vechi se randează ca paragrafe (conversie la citire)", () => {
    expect(renderRichField("Regula 1\nRegula 2", GCS_RICH_FIELDS.chatRules).html).toBe("<p>Regula 1</p><p>Regula 2</p>");
    expect(renderRichField("<script>alert(1)</script>", GCS_RICH_FIELDS.chatRules).html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  test.each([
    ["link javascript:", doc(p(text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])))],
    ["link data:", doc(p(text("x", [{ type: "link", attrs: { href: "data:text/html,<script>alert(1)</script>" } }])))],
    ["imagine http", doc(image({ src: "http://cdn.example/a.png" }))],
    ["imagine cu ghilimele", doc(image({ src: 'https://cdn.example/a.png" onerror="alert(1)' }))],
    ["stil injectat", doc(p(text("x", [{ type: "textStyle", attrs: { color: "red;background:url(https://x)" } }])))],
    ["mărime nepermisă", doc(p(text("x", [{ type: "textStyle", attrs: { fontSize: "300px" } }])))],
    ["nod necunoscut (HTML brut)", doc({ type: "html", attrs: { html: "<script>alert(1)</script>" } })],
    ["atribut necunoscut", doc({ type: "paragraph", attrs: { onclick: "alert(1)" }, content: [text("x")] })],
    ["document gol", doc({ type: "paragraph" })],
  ])("respinge %s", (_name, value) => {
    expect(failure(() => renderRichField(value, GCS_RICH_FIELDS.signature, { field: "signature" }))).toEqual({ fields: { signature: "invalid" } });
  });

  test("respinge nodurile din afara profilului: video la semnătură, imagini la reguli, titluri la câmpurile de profil", () => {
    expect(failure(() => renderRichField(doc({ type: "embed", attrs: { url: "https://youtu.be/dQw4w9WgXcQ" } }), GCS_RICH_FIELDS.signature)).fields).toEqual({ content: "format_not_allowed" });
    expect(failure(() => renderRichField(doc(image({ src: "https://cdn.example/a.png" })), GCS_RICH_FIELDS.chatRules)).fields).toEqual({ content: "format_not_allowed" });
    const heading = doc({ type: "heading", attrs: { level: 2 }, content: [text("Titlu")] });
    expect(failure(() => renderRichField(heading, GCS_RICH_FIELDS.profileText)).fields).toEqual({ content: "format_not_allowed" });
    expect(renderRichField(heading, GCS_RICH_FIELDS.chatRules).html).toBe("<h2>Titlu</h2>");
  });

  test("limitele: caractere și imagini, cu maximul în parametri", () => {
    expect(failure(() => renderRichField("x".repeat(11), GCS_RICH_FIELDS.signature, { maxChars: 10 }))).toEqual({ fields: { content: "too_long" }, params: { max: "10" } });
    const two = doc(image({ src: "https://cdn.example/a.png" }), image({ src: "https://cdn.example/b.png" }));
    expect(failure(() => renderRichField(two, GCS_RICH_FIELDS.signature))).toEqual({ fields: { content: "too_many_images" }, params: { max: "1" } });
    expect(renderRichField(two, GCS_RICH_FIELDS.signature, { maxImages: 2 }).html).toContain("b.png");
    expect(failure(() => renderRichField("", GCS_RICH_FIELDS.signature)).fields).toEqual({ content: "required" });
  });
});

describe("richFieldError și richFieldHtml", () => {
  test("richFieldError: gol și documentele valide trec; altfel codul erorii", () => {
    expect(richFieldError("", GCS_RICH_FIELDS.chatRules)).toBeNull();
    expect(richFieldError("Fără spam.", GCS_RICH_FIELDS.chatRules)).toBeNull();
    expect(richFieldError(doc(p(text("x", [{ type: "italic" }]))), GCS_RICH_FIELDS.chatRules)).toBeNull();
    expect(richFieldError(doc(image({ src: "https://cdn.example/a.png" })), GCS_RICH_FIELDS.chatRules)).toBe("format_not_allowed");
    expect(richFieldError("x".repeat(5001), GCS_RICH_FIELDS.chatRules)).toBe("too_long");
    expect(richFieldError(42, GCS_RICH_FIELDS.chatRules)).toBe("invalid");
  });

  test("richFieldHtml: textul vechi devine paragrafe; o valoare invalidă nu afișează nimic", () => {
    expect(richFieldHtml("a\n\nb", GCS_RICH_FIELDS.chatRules)).toBe("<p>a</p><p></p><p>b</p>");
    expect(richFieldHtml("", GCS_RICH_FIELDS.chatRules)).toBe("");
    expect(richFieldHtml(doc(p(text("x", [{ type: "link", attrs: { href: "javascript:x" } }]))), GCS_RICH_FIELDS.chatRules)).toBe("");
  });
});
