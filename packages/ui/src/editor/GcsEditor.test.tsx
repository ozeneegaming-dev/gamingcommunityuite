import { Editor } from "@tiptap/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { GcsEditor, type GcsEditorHandle, type GcsEditorLabels } from "./GcsEditor";
import { gcsEditorExtensions, GCS_EDITOR_MARKS, GCS_EDITOR_NODES, isEmbedUrl } from "./extensions";

const labels: GcsEditorLabels = {
  toolbar: "Formatare",
  bold: "Bold",
  italic: "Italic",
  underline: "Subliniat",
  strike: "Tăiat",
  superscript: "Exponent",
  subscript: "Indice",
  alignLeft: "Stânga",
  alignCenter: "Centru",
  alignRight: "Dreapta",
  alignJustify: "Justify",
  fontSize: "Mărime",
  sizeDefault: "Normal",
  color: "Culoare",
  colorCustom: "Altă culoare",
  highlight: "Evidențiere",
  removeColor: "Fără culoare",
  clearFormatting: "Șterge formatarea",
  bulletList: "Listă",
  orderedList: "Listă numerotată",
  horizontalRule: "Linie",
  link: "Link",
  linkUrl: "Adresa linkului",
  removeLink: "Scoate linkul",
  emoji: "Emoji",
  emojiSmileys: "Fețe",
  emojiPeople: "Oameni",
  emojiGaming: "Gaming",
  emojiSymbols: "Simboluri",
  fullscreen: "Tot ecranul",
  exitFullscreen: "Ieși din tot ecranul",
  characters: "{count} caractere",
  charactersMax: "{count} / {max} caractere",
  quote: "Citat",
  code: "Cod",
  spoiler: "Spoiler",
  mention: "Mențiune",
  image: "Imagine",
  video: "Video",
  videoUrl: "Link video",
  insert: "Inserează",
  cancel: "Anulează",
  invalidVideo: "Link nerecunoscut",
  placeholder: "Scrie un răspuns…",
  uploading: "Se încarcă…",
  uploadFailed: "Încărcarea a eșuat",
  noMentions: "Niciun membru",
};

function headless(content: string) {
  return new Editor({ element: document.createElement("div"), extensions: gcsEditorExtensions({ placeholder: "" }), content });
}

/** Toate tipurile de noduri și mărci dintr-un document. */
function types(doc: { type?: string; content?: unknown[]; marks?: { type: string }[] }, out = new Set<string>()): Set<string> {
  if (doc.type) out.add(doc.type);
  for (const m of doc.marks ?? []) out.add(`mark:${m.type}`);
  for (const c of (doc.content ?? []) as (typeof doc)[]) types(c, out);
  return out;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("extensiile editorului", () => {
  test("schema conține exact nodurile și mărcile permise de server", () => {
    const editor = headless("");
    expect(Object.keys(editor.schema.nodes).sort()).toEqual([...GCS_EDITOR_NODES].sort());
    expect(Object.keys(editor.schema.marks).sort()).toEqual([...GCS_EDITOR_MARKS].sort());
    editor.destroy();
  });

  test("Bold pe selecție produce marca `bold`", () => {
    const editor = headless("<p>abc</p>");
    editor.chain().selectAll().toggleBold().run();
    expect(editor.getJSON().content![0]!.content![0]!.marks).toEqual([{ type: "bold" }]);
    editor.destroy();
  });

  test("toate funcțiile din toolbar produc nodurile așteptate", () => {
    const editor = headless("<p>x</p>");
    editor.chain().selectAll().toggleBlockquote().run();
    editor.commands.setContent(
      '<blockquote class="gcs-quote" data-post="12" data-author="Krypt"><p>citat</p></blockquote>' +
        '<div class="gcs-spoiler"><p>secret</p></div><div data-embed-url="https://youtu.be/dQw4w9WgXcQ"></div><pre><code>cod</code></pre>',
    );
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "image", attrs: { attachmentId: "att_1" } });
    const json = editor.getJSON();
    expect([...types(json)]).toEqual(expect.arrayContaining(["quote", "spoiler", "embed", "codeBlock", "image"]));
    const quote = json.content!.find((n) => n.type === "quote")!;
    expect(quote.attrs).toMatchObject({ postId: 12, authorName: "Krypt" });
    const image = json.content!.find((n) => n.type === "image")!;
    expect(image.attrs).toMatchObject({ attachmentId: "att_1", src: null });
    editor.destroy();
  });

  test("culoarea, mărimea, evidențierea, alinierea și indicii produc exact mărcile acceptate de server", () => {
    const editor = headless("<p>abc</p>");
    editor.chain().selectAll().setColor("#5EA2FF").setFontSize("18px").setHighlight({ color: "#FDE68A" }).toggleSuperscript().setTextAlign("center").run();
    const p = editor.getJSON().content![0]!;
    expect(p.attrs).toMatchObject({ textAlign: "center" });
    const marks = p.content![0]!.marks!;
    expect(marks).toEqual(
      expect.arrayContaining([
        { type: "textStyle", attrs: expect.objectContaining({ color: "#5EA2FF", fontSize: "18px" }) },
        { type: "highlight", attrs: { color: "#FDE68A" } },
        { type: "superscript" },
      ]),
    );
    editor.destroy();
  });

  test.each([
    ["https://youtu.be/dQw4w9WgXcQ", true],
    ["https://www.twitch.tv/videos/123", true],
    ["https://medal.tv/clip/abc123", true],
    ["https://example.com/video", false],
    ["text cu https://youtu.be/x în el", false],
    ["http://youtu.be/dQw4w9WgXcQ", false],
  ])("isEmbedUrl(%s) → %s", (url, expected) => {
    expect(isEmbedUrl(url)).toBe(expected);
  });
});

describe("GcsEditor", () => {
  async function mount(props: Partial<Parameters<typeof GcsEditor>[0]> = {}) {
    const ref = createRef<GcsEditorHandle>();
    render(<GcsEditor ref={ref} labels={labels} forumId={1} {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Bold" })).not.toHaveProperty("disabled", true));
    return ref;
  }

  test("toolbar-ul din machetă, cu etichete accesibile", async () => {
    await mount({ uploadUrl: "/api/forums/uploads", mentionUrl: "/api/forums/mentions" });
    const toolbar = screen.getByRole("toolbar", { name: "Formatare" });
    const names = [...toolbar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Bold", "Italic", "Subliniat", "Tăiat", "Exponent", "Indice",
      "Stânga", "Centru", "Dreapta", "Justify",
      "Culoare", "Evidențiere", "Șterge formatarea",
      "Listă", "Listă numerotată", "Linie", "Link", "Citat", "Cod", "Spoiler",
      "Mențiune", "Imagine", "Video", "Emoji", "Tot ecranul",
    ]);
    expect(screen.getByLabelText("Mărime")).toBeTruthy();
  });

  test("insertQuote adaugă un citat cu autorul și id-ul postării", async () => {
    const ref = await mount();
    act(() => ref.current!.insertQuote({ postId: 7, authorId: "u1", authorName: "ShadowRO", text: "Ce setări folosiți?" }));
    const quote = ref.current!.getJSON().content!.find((n) => n.type === "quote")!;
    expect(quote.attrs).toEqual({ postId: 7, authorId: "u1", authorName: "ShadowRO" });
    expect(quote.content![0]!.content![0]!.text).toBe("Ce setări folosiți?");
  });

  test("ciorna e restaurată la montare și ștearsă de clear()", async () => {
    const draft = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ciorna mea" }] }] };
    window.localStorage.setItem("gcs-draft:topic-1", JSON.stringify(draft));
    const ref = await mount({ draftKey: "topic-1" });
    // Paragrafele au acum și `textAlign` (null = implicit), acceptat de server.
    expect(ref.current!.getJSON()).toMatchObject(draft);
    act(() => ref.current!.clear());
    expect(window.localStorage.getItem("gcs-draft:topic-1")).toBeNull();
    expect(ref.current!.isEmpty()).toBe(true);
  });

  test("emoji-ul ales din selector se inserează în text; contorul de caractere se actualizează", async () => {
    const ref = await mount({ maxLength: 500 });
    act(() => screen.getByRole("button", { name: "Emoji" }).click());
    act(() => screen.getByRole("button", { name: "🔥" }).click());
    const text = ref.current!.getJSON().content![0]!.content![0]!.text;
    expect(text).toContain("🔥");
    await waitFor(() => expect(screen.getByTestId("gcs-editor-count").textContent).toMatch(/^[12] \/ 500 caractere$/));
  });

  test("tot ecranul se pornește și se oprește cu Escape", async () => {
    await mount();
    act(() => screen.getByRole("button", { name: "Tot ecranul" }).click());
    expect(document.querySelector(".gcs-editor--fullscreen")).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector(".gcs-editor--fullscreen")).toBeNull();
  });

  test("butonul Video cu un link nerecunoscut afișează eroarea", async () => {
    await mount();
    act(() => screen.getByRole("button", { name: "Video" }).click());
    const input = screen.getByLabelText("Link video") as HTMLInputElement;
    act(() => {
      input.value = "https://example.com";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => screen.getByRole("button", { name: "Inserează" }).click());
    expect(screen.getByRole("alert").textContent).toBe("Link nerecunoscut");
  });
});

describe("GcsEditor.getJSON", () => {
  test("întoarce obiecte simple (cu prototip), ca serializarea Server Actions să nu piardă atributele", async () => {
    const ref = createRef<GcsEditorHandle>();
    render(<GcsEditor ref={ref} labels={labels} forumId={1} />);
    await waitFor(() => expect(ref.current?.isEmpty()).toBe(true));
    act(() => ref.current!.insertQuote({ postId: 7, authorId: "u1", authorName: "ShadowRO", text: "x" }));
    const quote = ref.current!.getJSON().content!.find((n) => n.type === "quote")!;
    expect(Object.getPrototypeOf(quote.attrs)).toBe(Object.prototype);
  });
});
