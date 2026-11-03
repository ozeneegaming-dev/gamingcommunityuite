import { describe, expect, test } from "vitest";
import { cardMedia, DEFAULT_FORUM_PREVIEW, forumPreviewOf, needsPostPreview, postPreview, type GcsForumPreview } from "./cardPreview";
import type { GcsLastPost } from "./queries";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const user = { id: "u1", name: "Spike", image: null, groupKey: "vip", nameKey: "vip", frameKey: "gold" };
const last: GcsLastPost = { postId: 9, topicId: 4, topicTitle: "Ce placă video folosiți?", topicSlug: "ce-placa", at: "2026-11-03T00:41:00.000Z", user };
const preview = (patch: Partial<GcsForumPreview> = {}): GcsForumPreview => ({ ...DEFAULT_FORUM_PREVIEW, ...patch });

describe("postPreview (conținutul ultimei postări)", () => {
  test("pozele fără emoticoane și textul fără citate, blocuri ascunse și spoilere", () => {
    const json = doc(
      { type: "quote", attrs: { postId: 1, authorName: "A" }, content: [p("citat")] },
      p("Am trecut la o 4060."),
      { type: "image", attrs: { src: "https://x.example/smile.png", width: 18, height: 18 } },
      { type: "spoiler", content: [p("finalul filmului"), { type: "image", attrs: { src: "https://x.example/spoiler.jpg" } }] },
      { type: "gcsHidden", attrs: { mode: "members" }, content: [p("doar membrii")] },
      { type: "image", attrs: { attachmentId: "poza1", width: 1200, height: 600 } },
      p("Voi ce aveți?"),
    );
    expect(postPreview(json)).toEqual({ images: [{ src: "/files/poza1", file: true }], text: "Am trecut la o 4060. Voi ce aveți?" });
  });

  test("textul lung se taie (două rânduri pe card)", () => {
    const text = postPreview(doc(p("x".repeat(500)))).text;
    expect(text.length).toBe(220);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("cardMedia: ordinea celor patru stări", () => {
  const post = { images: [{ src: "/files/a1", file: true }, { src: "https://x.example/b.jpg", file: false }], text: "primele rânduri" };

  test("1. imaginea din ACP are prioritate (modul „Imaginea mea” sau automat cu imagine), cu focalizarea", () => {
    for (const mode of ["image", "auto"] as const) {
      expect(cardMedia({ preview: preview({ mode, imageId: "acp1", focusX: 30, focusY: 70 }), last, post, canDownload: true })).toEqual({ kind: "image", source: "acp", src: "/files/acp1", position: "30% 70%" });
    }
    // Și pe un forum fără postări.
    expect(cardMedia({ preview: preview({ imageId: "acp1" }), last: null, post: null, canDownload: true })).toMatchObject({ kind: "image", source: "acp" });
  });

  test("2. automat: prima poză a ultimei postări; atașamentele doar cu dreptul de descărcare", () => {
    expect(cardMedia({ preview: preview(), last, post, canDownload: true })).toEqual({ kind: "image", source: "post", src: "/files/a1", position: null });
    expect(cardMedia({ preview: preview(), last, post, canDownload: false })).toEqual({ kind: "image", source: "post", src: "https://x.example/b.jpg", position: null });
  });

  test("3. postarea fără poze (sau doar cu atașamente interzise): previzualizarea generată, cu titlul, textul și autorul", () => {
    expect(cardMedia({ preview: preview(), last, post: { images: [], text: "primele rânduri" }, canDownload: true })).toEqual({ kind: "generated", title: last.topicTitle, text: "primele rânduri", user });
    expect(cardMedia({ preview: preview(), last, post: { images: [{ src: "/files/a1", file: true }], text: "" }, canDownload: false })).toMatchObject({ kind: "generated", text: "" });
    // Conținutul lipsă (ex. postarea nu mai e vizibilă): tot titlul și autorul.
    expect(cardMedia({ preview: preview(), last, post: null, canDownload: true })).toMatchObject({ kind: "generated", title: last.topicTitle, user });
  });

  test("4. forumul fără postări și „Doar culoarea forumului”: gradientul cu iconița", () => {
    expect(cardMedia({ preview: preview(), last: null, post: null, canDownload: true })).toEqual({ kind: "empty" });
    expect(cardMedia({ preview: preview({ mode: "color", imageId: "acp1" }), last, post, canDownload: true })).toEqual({ kind: "empty" });
  });

  test("conținutul ultimei postări se cere doar pentru modul automat fără imagine, cu o postare", () => {
    expect(needsPostPreview(preview(), last)).toBe(true);
    expect(needsPostPreview(preview(), null)).toBe(false);
    expect(needsPostPreview(preview({ imageId: "acp1" }), last)).toBe(false);
    expect(needsPostPreview(preview({ mode: "color" }), last)).toBe(false);
  });
});

describe("forumPreviewOf", () => {
  test("valorile din bază, validate (stricate = implicite)", () => {
    expect(forumPreviewOf({ previewMode: "image", previewImageId: "abc_1", previewFocusX: 0, previewFocusY: 100 })).toEqual({ mode: "image", imageId: "abc_1", focusX: 0, focusY: 100 });
    expect(forumPreviewOf({ previewMode: "x", previewImageId: "../etc", previewFocusX: 101, previewFocusY: 2.5 })).toEqual(DEFAULT_FORUM_PREVIEW);
    expect(forumPreviewOf({})).toEqual(DEFAULT_FORUM_PREVIEW);
  });
});
