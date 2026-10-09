import { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { gcsEditorExtensions } from "./extensions";
import { GcsMentionList, mentionItems, type GcsMentionAttrs } from "./mentions";

afterEach(cleanup);

const labels = { empty: "Niciun membru", group: "Grup", online: "Online" };
const shield = { width: 512, height: 512, path: "M0 0h512v512H0z" };

const items = mentionItems({
  users: [
    { id: "u1", name: "Ana", image: "/files/av1", nameKey: "moderator", online: true, clan: { tag: "AAA", name: "Alfa", color: "#D62839", color2: "#1B1E26", ink: "#FFFFFF" } },
    { id: "u2", name: "Bogdan", image: null, nameKey: "member", online: false, clan: null },
  ],
  groups: [{ id: 5, name: "Moderator", color: "#5EA2FF", icon: shield }],
});

describe("lista de sugestii", () => {
  test("grupurile primele; numele lungi scurtate la 40; culorile invalide ignorate", () => {
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(["group:5", "user:u1", "user:u2"]);
    const [g] = mentionItems({ groups: [{ id: 7, name: "G".repeat(64), color: "red", icon: null }] });
    expect(g).toEqual({ kind: "group", id: "7", label: "G".repeat(40), color: null, icon: null });
  });

  test("membrul: avatar (imaginea sau inițiala), numele în stilul grupului, punctul online și tagul clanului; grupul: iconița, culoarea și eticheta", () => {
    render(<GcsMentionList items={items} command={() => {}} labels={labels} />);
    const [group, ana, bogdan] = screen.getAllByRole("option");
    expect(group!.querySelector(".gcs-mentionList__group")!.getAttribute("style")).toContain("--gcs-gm-color: #5EA2FF");
    expect(group!.querySelector("svg path")!.getAttribute("d")).toBe(shield.path);
    expect(group!.textContent).toContain("@Moderator");
    expect(group!.textContent).toContain("Grup");

    expect(ana!.querySelector("img")!.getAttribute("src")).toBe("/files/av1");
    expect(ana!.querySelector(".gcs-name--moderator")!.textContent).toBe("@Ana");
    expect(ana!.querySelector('[role="img"][aria-label="Online"]')).not.toBeNull();
    expect(ana!.querySelector(".gcs-clanTag")!.textContent).toContain("AAA");

    expect(bogdan!.querySelector("img")).toBeNull();
    expect(bogdan!.querySelector(".gcs-avatar")!.textContent).toContain("B");
    expect(bogdan!.querySelector('[aria-label="Online"]')).toBeNull();
  });

  test("navigarea din tastatură: săgeți (circular), Enter alege; comanda primește doar id, etichetă și tip", () => {
    const ref = createRef<{ onKeyDown: (e: KeyboardEvent) => boolean }>();
    const command = vi.fn<(a: GcsMentionAttrs) => void>();
    render(<GcsMentionList ref={ref} items={items} command={command} labels={labels} />);
    const key = (k: string) => act(() => void ref.current!.onKeyDown(new KeyboardEvent("keydown", { key: k })));
    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
    key("ArrowDown");
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    key("ArrowUp");
    key("ArrowUp");
    expect(screen.getAllByRole("option")[2]!.getAttribute("aria-selected")).toBe("true");
    key("Enter");
    expect(command).toHaveBeenLastCalledWith({ id: "u2", label: "Bogdan", kind: "user" });
    key("ArrowDown");
    key("Tab");
    expect(command).toHaveBeenLastCalledWith({ id: "5", label: "Moderator", kind: "group" });
    expect(ref.current!.onKeyDown(new KeyboardEvent("keydown", { key: "a" }))).toBe(false);
  });

  test("click pe o sugestie o alege; fără rezultate apare mesajul", () => {
    const command = vi.fn();
    const { rerender } = render(<GcsMentionList items={items} command={command} labels={labels} />);
    fireEvent.mouseDown(screen.getByText("@Ana"));
    expect(command).toHaveBeenCalledWith({ id: "u1", label: "Ana", kind: "user" });
    rerender(<GcsMentionList items={[]} command={command} labels={labels} />);
    expect(screen.getByText("Niciun membru").tagName).toBe("LI");
  });
});

describe("nodul mention în editor", () => {
  test("`kind: group` → pastila grupului (clasă și data-group-id); mențiunea veche, fără kind, rămâne a unui membru", () => {
    const editor = new Editor({
      extensions: gcsEditorExtensions({ placeholder: "" }),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { id: "5", label: "Moderator", kind: "group" } },
              { type: "text", text: " și " },
              { type: "mention", attrs: { id: "u1", label: "Ana" } },
            ],
          },
        ],
      },
    });
    const html = editor.getHTML();
    expect(html).toContain('data-group-id="5"');
    expect(html).toMatch(/class="gcs-mention gcs-groupMention"/);
    const inline = (e: Editor) => (e.getJSON() as { content: { content: { attrs?: Record<string, unknown> }[] }[] }).content[0]!.content;
    expect(inline(editor)[0]!.attrs).toMatchObject({ id: "5", label: "Moderator", kind: "group" });
    expect(inline(editor)[2]!.attrs).toMatchObject({ id: "u1", label: "Ana", kind: null });
    // HTML-ul editorului se citește înapoi cu același tip.
    const again = new Editor({ extensions: gcsEditorExtensions({ placeholder: "" }), content: html });
    expect(inline(again)[0]!.attrs).toMatchObject({ id: "5", kind: "group" });
    editor.destroy();
    again.destroy();
  });
});
