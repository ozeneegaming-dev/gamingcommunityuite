// @vitest-environment jsdom
import { GCS_DOC_MARKS, GCS_DOC_NODES, GCS_RICH_FIELDS, GcsContentRenderer, renderRichField } from "@gcs/core";
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

  test("mențiunile din editor (membru și grup, Mențiuni v2) sunt acceptate de server; HTML-ul editorului se citește înapoi", () => {
    const editor = new Editor({ element: document.createElement("div"), extensions: gcsEditorExtensions({ placeholder: "" }) });
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "5", label: "Moderator", kind: "group", mentionSuggestionChar: "@" } },
            { type: "text", text: " și " },
            { type: "mention", attrs: { id: "user_1", label: "Krypt", kind: "user", mentionSuggestionChar: "@" } },
          ],
        },
      ],
    });
    // Copiat și lipit: tipul mențiunii rămâne (din `data-kind`).
    editor.commands.setContent(editor.getHTML());
    const out = new GcsContentRenderer().render(editor.getJSON(), {
      embeds: [],
      siteHost: "forum.test",
      labels: { quoteWrote: "{name} a scris:", spoiler: "Spoiler" },
      groups: new Map([["5", { name: "Moderator" }]]),
    });
    expect(out.groupMentions).toEqual([5]);
    expect(out.mentions).toEqual(["user_1"]);
    expect(out.html).toContain('<a class="gcs-groupMention" href="/members?group=5" data-group-id="5">@Moderator</a>');
    editor.destroy();
  });
});

/**
 * Câmpurile formatate (specul `2026-10-07-editor-campuri`): editorul compact primește profilul serverului ca schemă,
 * deci tot ce poate scrie (sau lipi) trebuie să treacă de `renderRichField` cu același profil.
 */
describe("editorul compact ↔ profilurile câmpurilor", () => {
  test.each(Object.values(GCS_RICH_FIELDS))("$key: schema editorului are exact nodurile și mărcile profilului", (profile) => {
    const editor = new Editor({ element: document.createElement("div"), extensions: gcsEditorExtensions({ placeholder: "", allow: profile }) });
    expect(Object.keys(editor.schema.nodes).sort()).toEqual(["doc", "text", ...profile.nodes].sort());
    expect(Object.keys(editor.schema.marks).sort()).toEqual([...profile.marks].sort());
    editor.destroy();
  });

  test.each(Object.values(GCS_RICH_FIELDS))("$key: un document lipit cu de toate e redus la profil și acceptat de server", (profile) => {
    // Culori și mărimi cum vin din alte pagini (`rgb(…)`, mărimi din afara listei): editorul le aduce la forma serverului.
    const html =
      '<h2>Titlu</h2><p style="text-align:center"><strong>bold</strong> <em>italic</em> <u>sub</u> <s>tăiat</s> ' +
      '<a href="https://example.com">link</a> <span style="color:#FF6B74">roșu</span> <span style="color: rgb(61, 220, 151); font-size: 13px">verde</span> ' +
      '<span style="font-size:18px">mare</span> <mark data-color="#FDE68A">galben</mark> <mark style="background-color: rgb(1, 2, 3)">altă culoare</mark></p>' +
      '<ul><li><p>a</p></li></ul><blockquote><p>citat</p></blockquote><hr><pre><code>cod</code></pre>' +
      '<img src="https://cdn.example/banner.png"><div data-embed-url="https://youtu.be/dQw4w9WgXcQ"></div>';
    const editor = new Editor({ element: document.createElement("div"), extensions: gcsEditorExtensions({ placeholder: "", allow: profile }), content: html });
    const out = renderRichField(editor.getJSON(), profile, { maxImages: 1 });
    expect(out.text).toContain("bold");
    expect(out.html).not.toContain("<iframe");
    if (profile.marks.includes("textStyle")) expect(out.html).toContain('<span style="color:#3DDC97">verde</span>');
    editor.destroy();
  });
});
