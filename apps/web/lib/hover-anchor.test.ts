// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { hoverAnchorKey, hoverAnchorOf, OPEN_CARD_EVENT, openMemberCard } from "./hover-anchor";

function html(markup: string): HTMLElement {
  const box = document.createElement("div");
  box.innerHTML = markup;
  document.body.replaceChildren(box);
  return box;
}

describe("ce deschide hover card-ul", () => {
  test("mențiunea salvată în formatul vechi (doar `data-user`) deschide cardul membrului", () => {
    const box = html('<p><a class="gcs-userLink gcs-mention" href="/members/u1" data-user="u1">@Ana</a></p>');
    const a = hoverAnchorOf(box.querySelector("a"))!;
    expect(a).not.toBeNull();
    expect(hoverAnchorKey(a)).toBe("u:u1");
  });

  test("mențiunea nouă (`data-user-id`) și un nume oarecare de membru", () => {
    const box = html('<a class="gcs-mention" data-user="u1" data-user-id="u1">@Ana</a><a class="gcs-userLink" data-user-id="u2"><span>Bogdan</span></a>');
    expect(hoverAnchorKey(hoverAnchorOf(box.querySelector(".gcs-mention"))!)).toBe("u:u1");
    // Ținta poate fi un copil al linkului.
    expect(hoverAnchorKey(hoverAnchorOf(box.querySelector("span"))!)).toBe("u:u2");
  });

  test("pastila unui grup deschide cardul grupului", () => {
    const box = html('<a class="gcs-groupMention" href="/members?group=5" data-group-id="5">@Moderator</a>');
    expect(hoverAnchorKey(hoverAnchorOf(box.querySelector("a"))!)).toBe("g:5");
  });

  test("nimic în editor, pe un `data-user` fără clasa mențiunii sau pe text simplu", () => {
    const box = html(
      '<div contenteditable="true"><span class="gcs-mention gcs-groupMention" data-group-id="5">@Moderator</span></div>' +
        '<div data-user="u1">x</div><p>text</p>',
    );
    expect(hoverAnchorOf(box.querySelector(".gcs-groupMention"))).toBeNull();
    expect(hoverAnchorOf(box.querySelector("[data-user]"))).toBeNull();
    expect(hoverAnchorOf(box.querySelector("p"))).toBeNull();
    expect(hoverAnchorOf(null)).toBeNull();
  });
});

describe("deschiderea cardului la click", () => {
  test("`openMemberCard` cere gazdei cardul ancorei, pe loc", () => {
    const box = html('<button type="button" data-user-id="u7">Ana</button>');
    const seen: HTMLElement[] = [];
    const listen = (e: Event) => seen.push((e as CustomEvent<{ anchor: HTMLElement }>).detail.anchor);
    document.addEventListener(OPEN_CARD_EVENT, listen);
    openMemberCard(box.querySelector("button")!);
    document.removeEventListener(OPEN_CARD_EVENT, listen);
    expect(seen).toHaveLength(1);
    expect(hoverAnchorKey(seen[0]!)).toBe("u:u7");
  });
});
