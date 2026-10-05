// @vitest-environment jsdom
import { GCS_DOC_MARKS, GCS_DOC_NODES, GcsContentRenderer } from "@gcs/core";
import { gcsEditorExtensions, GCS_EDITOR_MARKS, GCS_EDITOR_NODES } from "@gcs/ui/editor";
import { Editor } from "@tiptap/core";
import { describe, expect, test } from "vitest";

/**
 * Editorul (client) și renderer-ul (server) trebuie să fie de acord: orice produce editorul trebuie acceptat de server,
 * altfel userul ar primi „conținut invalid” pentru o postare scrisă normal.
 */
describe("editor ↔ renderer", () => {
  test("nodurile și mărcile editorului sunt exact cele permise de renderer", () => {
    expect([...GCS_EDITOR_NODES].filter((n) => n !== "doc" && n !== "text").sort()).toEqual(Object.keys(GCS_DOC_NODES).sort());
    expect([...GCS_EDITOR_MARKS].sort()).toEqual(Object.keys(GCS_DOC_MARKS).sort());
  });

  test("un document cu toate funcțiile editorului e acceptat și randat de server", () => {
    const editor = new Editor({ element: document.createElement("div"), extensions: gcsEditorExtensions({ placeholder: "" }) });
    editor.commands.setContent(
      "<h2>Titlu</h2><p><strong>bold</strong> <em>italic</em> <u>sub</u> <s>tăiat</s> <code>cod</code> " +
        '<a href="https://example.com">link</a> <a href="/files/att_2">config.cfg</a><br>rând nou</p>' +
        "<ul><li><p>a</p></li></ul><ol start=\"3\"><li><p>b</p></li></ol><blockquote><p>citat</p></blockquote>" +
        '<pre><code class="language-cfg">cl_crosshairsize 2</code></pre><hr>' +
        '<blockquote class="gcs-quote" data-post="12" data-author="ShadowRO"><p>Ce setări?</p></blockquote>' +
        '<div class="gcs-spoiler"><p>final</p></div><div data-embed-url="https://youtu.be/dQw4w9WgXcQ"></div>',
    );
    const end = () => editor.state.doc.content.size;
    editor.commands.insertContentAt(end(), { type: "image", attrs: { attachmentId: "att_1", alt: "poză", width: 640, height: 360 } });
    editor.commands.insertContentAt(end(), {
      type: "paragraph",
      content: [{ type: "mention", attrs: { id: "user_1", label: "Krypt", mentionSuggestionChar: "@" } }],
    });

    const out = new GcsContentRenderer().render(editor.getJSON(), {
      embeds: ["youtube", "twitch", "medal", "image"],
      siteHost: "forum.test",
      labels: { quoteWrote: "{name} a scris:", spoiler: "Spoiler" },
    });
    expect(out.attachments.sort()).toEqual(["att_1", "att_2"]);
    expect(out.mentions).toEqual(["user_1"]);
    expect(out.quotes).toEqual([12]);
    expect(out.html).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    editor.destroy();
  });
});
