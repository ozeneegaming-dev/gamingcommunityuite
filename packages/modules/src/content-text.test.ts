import { describe, expect, test } from "vitest";
import { docFirstImage, docImages, docSnippet } from "./content-text";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("docFirstImage (caruselul topicurilor recomandate)", () => {
  test("primul atașament imagine devine adresa fișierului", () => {
    expect(docFirstImage(doc(p("salut"), { type: "image", attrs: { attachmentId: "abc_12", alt: "" } }, { type: "image", attrs: { src: "https://x.example/b.png" } }))).toBe("/files/abc_12");
  });

  test("o imagine externă doar prin https; embed-ul de imagine contează; citatele se sar", () => {
    expect(docFirstImage(doc({ type: "image", attrs: { src: "http://x.example/a.png" } }))).toBeNull();
    expect(docFirstImage(doc({ type: "image", attrs: { src: "javascript:alert(1)" } }))).toBeNull();
    expect(docFirstImage(doc({ type: "quote", content: [{ type: "image", attrs: { attachmentId: "q1" } }] }, { type: "embed", attrs: { url: "https://i.example/c.webp" } }))).toBe("https://i.example/c.webp");
    expect(docFirstImage(doc({ type: "embed", attrs: { url: "https://youtube.example/watch?v=1" } }))).toBeNull();
  });

  test("fără imagini sau cu date stricate: null", () => {
    expect(docFirstImage(doc(p("doar text")))).toBeNull();
    expect(docFirstImage(null)).toBeNull();
    expect(docFirstImage(doc({ type: "image", attrs: { attachmentId: "../../etc" } }))).toBeNull();
  });

  test("docSnippet rămâne neschimbat", () => {
    expect(docSnippet(doc(p("Primul"), p("al doilea")), 140)).toBe("Primul al doilea");
  });

  test("blocurile ascunse (per vizitator) nu ies în fragmente și nici în imagini", () => {
    const hidden = { type: "gcsHidden", attrs: { mode: "members" }, content: [p("secret"), { type: "image", attrs: { src: "https://x.example/ascunsa.png" } }] };
    expect(docSnippet(doc(p("Public"), hidden, p("final")), 140)).toBe("Public final");
    expect(docFirstImage(doc(hidden, { type: "image", attrs: { src: "https://x.example/vizibila.png" } }))).toBe("https://x.example/vizibila.png");
  });
});

describe("docImages (previzualizarea cardurilor de forum)", () => {
  const img = (attrs: Record<string, unknown>) => ({ type: "image", attrs });

  test("pozele în ordine (atașamente și https), fără dubluri, cel mult `max`", () => {
    const d = doc(p("a"), img({ attachmentId: "f1", width: 800, height: 400 }), img({ src: "https://x.example/b.jpg" }), img({ src: "https://x.example/b.jpg" }), { type: "embed", attrs: { url: "https://x.example/c.webp" } });
    expect(docImages(d)).toEqual([
      { src: "/files/f1", file: true },
      { src: "https://x.example/b.jpg", file: false },
      { src: "https://x.example/c.webp", file: false },
    ]);
    expect(docImages(d, { max: 1 })).toEqual([{ src: "/files/f1", file: true }]);
  });

  test("emoticoanele și iconițele se sar: latura mică, adresa lor, SVG / ICO; o bandă lată (120 × 40) rămâne", () => {
    const d = doc(
      img({ src: "https://x.example/smile.gif", width: 20, height: 20 }),
      img({ attachmentId: "mic", width: 48, height: 48 }),
      img({ attachmentId: "pixel", width: 1, height: 1 }),
      img({ src: "https://cdn.example/emoji/1f600.png" }),
      img({ src: "https://forum.example/images/smilies/biggrin.png" }),
      img({ src: "https://x.example/logo.svg" }),
      img({ src: "https://x.example/favicon.ico" }),
      img({ src: "https://x.example/my-icon.png" }),
      img({ attachmentId: "banda", width: 120, height: 40 }),
    );
    expect(docImages(d)).toEqual([{ src: "/files/banda", file: true }]);
    // „lexicon” sau „iconic” nu sunt iconițe.
    expect(docImages(doc(img({ src: "https://x.example/lexicon/iconic.jpg" })))).toEqual([{ src: "https://x.example/lexicon/iconic.jpg", file: false }]);
  });

  test("citatele, blocurile ascunse și nodurile din `skip` se sar; adresele nesigure nu trec", () => {
    const d = doc(
      { type: "quote", attrs: { postId: 1, authorName: "A" }, content: [img({ src: "https://x.example/citat.png" })] },
      { type: "gcsHidden", attrs: { mode: "reply" }, content: [img({ attachmentId: "ascuns", width: 900, height: 500 })] },
      { type: "spoiler", content: [img({ src: "https://x.example/spoiler.png" })] },
      img({ src: "http://x.example/nesigur.png" }),
      img({ attachmentId: "../../etc" }),
      img({ src: "https://x.example/ok.png" }),
    );
    expect(docImages(d, { skip: new Set(["quote", "gcsHidden", "spoiler"]) })).toEqual([{ src: "https://x.example/ok.png", file: false }]);
    expect(docImages(d).map((x) => x.src)).toEqual(["https://x.example/spoiler.png", "https://x.example/ok.png"]);
    expect(docImages(null)).toEqual([]);
  });
});
