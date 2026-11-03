// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { avatarAnchorOf, hoverAnchorKey, hoverAnchorOf, OPEN_CARD_EVENT, openMemberCard } from "./hover-anchor";

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

  test("nimic în zonele care refuză cardul (`data-gcs-card-off`, ex. avatarul din meniul contului)", () => {
    const box = html(
      '<span class="ava" data-gcs-card-off=""><a data-user-id="u1"><img alt="Ana"></a></span>' +
        '<a class="own" data-user-id="u2" data-gcs-card-off="">Bogdan</a>' +
        '<a class="ok" data-user-id="u3">Carmen</a>',
    );
    expect(hoverAnchorOf(box.querySelector("img"))).toBeNull();
    expect(hoverAnchorOf(box.querySelector(".own"))).toBeNull();
    // În afara zonei, numele deschide cardul ca oriunde.
    expect(hoverAnchorKey(hoverAnchorOf(box.querySelector(".ok"))!)).toBe("u:u3");
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

describe("avatarul atins pe telefon (cardul ca foaie de jos)", () => {
  const avatar = (user: string) => `<span class="gcs-avatar gcs-avatar--l" data-avatar-user="${user}"><img class="gcs-avatar__img" alt="Ana"></span>`;

  test("avatarul din postbit (fără link), din ramă și din linkul spre profilul aceluiași membru deschide cardul lui", () => {
    const box = html(
      `<div id="postbit">${avatar("u1")}</div>` +
        `<span id="frame" class="gcs-avatarFrame gcs-avatarFrame--gold">${avatar("u2")}</span>` +
        `<a id="chat" href="/members/u3-ana?tab=activity">${avatar("u3")}</a>` +
        `<a id="plain" href="/members/u4">${avatar("u4")}</a>`,
    );
    expect(hoverAnchorKey(avatarAnchorOf(box.querySelector("#postbit img"))!)).toBe("u:u1");
    // Atingerea pe marginea ramei (în afara avatarului) găsește avatarul din ea.
    expect(hoverAnchorKey(avatarAnchorOf(box.querySelector("#frame"))!)).toBe("u:u2");
    expect(hoverAnchorKey(avatarAnchorOf(box.querySelector("#chat img"))!)).toBe("u:u3");
    expect(hoverAnchorKey(avatarAnchorOf(box.querySelector("#plain img"))!)).toBe("u:u4");
  });

  test("atingerea își păstrează rostul: linkul spre altceva, butoanele, meniurile, dialogurile, zonele refuzate, cardul", () => {
    const box = html(
      `<a id="notif" href="/notifications/7">${avatar("u1")}</a>` +
        `<a id="other" href="/members/u9-bogdan">${avatar("u1")}</a>` +
        `<button id="menu" type="button" aria-haspopup="dialog">${avatar("u1")}</button>` +
        `<div id="dialog" role="dialog">${avatar("u1")}</div>` +
        `<div id="off" data-gcs-card-off>${avatar("u1")}</div>` +
        `<div id="card" class="gcs-hoverCardLayer">${avatar("u1")}</div>` +
        '<p id="text">text</p>',
    );
    for (const id of ["notif", "other", "menu", "dialog", "off", "card", "text"]) expect([id, avatarAnchorOf(box.querySelector(`#${id} img`) ?? box.querySelector(`#${id}`))]).toEqual([id, null]);
    expect(avatarAnchorOf(null)).toBeNull();
  });
});
