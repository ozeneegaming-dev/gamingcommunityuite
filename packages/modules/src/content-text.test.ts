import { describe, expect, test } from "vitest";
import { docFirstImage, docSnippet } from "./content-text";

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
});
