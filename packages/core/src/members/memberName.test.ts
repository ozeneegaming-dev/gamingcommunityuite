import { describe, expect, test } from "vitest";
import { decorateMemberNamesHtml, MEMBER_NAME_MAX_LETTERS, memberNameHtml, memberNameParts, memberUserIdsInHtml, nameLetters } from "./memberName";

describe("numele unui membru (markup-ul comun)", () => {
  test("linkul spre profil: clasele, `data-user-id`, `data-text`, varianta mică", () => {
    expect(memberNameHtml({ id: "u1", name: "Ana", nameKey: "vip_gold", href: "/members/u1-ana" })).toBe(
      '<a class="gcs-userLink gcs-name gcs-name--vip_gold" href="/members/u1-ana" data-user-id="u1" data-text="Ana">Ana</a>',
    );
  });

  test("fără link: `span` cu `data-name-user` (fără hover card); varianta mare are `data-name-fx`", () => {
    expect(memberNameHtml({ id: "u1", name: "Ana", nameKey: "member", size: "full" })).toBe('<span class="gcs-name gcs-name--member" data-name-user="u1" data-text="Ana" data-name-fx="full">Ana</span>');
  });

  test("numele din hover card: link fără alt hover card (`data-name-user`)", () => {
    expect(memberNameHtml({ id: "u1", name: "Ana", href: "/m", hoverCard: false, size: "full" })).toBe(
      '<a class="gcs-userLink gcs-name gcs-name--member" href="/m" data-name-user="u1" data-text="Ana" data-name-fx="full">Ana</a>',
    );
  });

  test("valorile sunt escapate; cheile și id-urile nesigure sunt ignorate", () => {
    const html = memberNameHtml({ id: 'x" onclick="1', name: '<b>"Rău"</b>', nameKey: "a b", href: "/members/x", className: "ok gcs-hoverCard__name" });
    expect(html).toBe('<a class="gcs-userLink gcs-name gcs-name--member ok gcs-hoverCard__name" href="/members/x" data-text="&lt;b&gt;&quot;Rău&quot;&lt;/b&gt;">&lt;b&gt;&quot;Rău&quot;&lt;/b&gt;</a>');
    expect(memberNameHtml({ name: "" })).toBe("");
  });

  test("literele: textul simplu rămâne (numele accesibil), literele desenate sunt ascunse cititoarelor de ecran", () => {
    const html = memberNameHtml({ id: "u1", name: "Al B", nameKey: "member", href: "/m", letters: true });
    expect(html).toBe(
      '<a class="gcs-userLink gcs-name gcs-name--member" href="/m" data-user-id="u1" data-text="Al B" data-name-letters>' +
        '<span class="gcs-name__t">Al B</span><span class="gcs-name__ls" aria-hidden="true">' +
        '<b style="--i:0" data-c="A"></b><b style="--i:1" data-c="l"></b><b style="--i:2" data-c=" "></b><b style="--i:3" data-c="B"></b></span></a>',
    );
    // Literele sunt în `data-c` (desenate din CSS): textul elementului rămâne numele, o singură dată.
    expect(html.replace(/<[^>]+>/g, "")).toBe("Al B");
  });

  test("HTML-ul salvat (mențiunile): clasa stilului de acum, `data-text`, literele; restul rămâne neatins", () => {
    const html =
      '<p>Salut <a class="gcs-userLink gcs-mention" href="/members/u1" data-user="u1" data-user-id="u1">@Ana &amp; Co</a> și ' +
      '<a class="gcs-groupMention" href="/members?group=3" data-group-id="3">@Staff</a> ' +
      '<a class="gcs-userLink gcs-name gcs-name--admin" href="/m/u2" data-user-id="u2" data-text="Bob">Bob</a> <a href="/x" data-user-id="u3">x</a></p>';
    expect(memberUserIdsInHtml(html)).toEqual(["u1", "u2"]);
    const out = decorateMemberNamesHtml(html, { keys: new Map([["u1", "vip_gold"], ["u2", "member"]]), letters: new Set(["u1"]) });
    expect(out).toContain(
      '<a class="gcs-userLink gcs-mention gcs-name gcs-name--vip_gold" href="/members/u1" data-user="u1" data-user-id="u1" data-text="@Ana &amp; Co" data-name-letters><span class="gcs-name__t">@Ana &amp; Co</span><span class="gcs-name__ls" aria-hidden="true"><b style="--i:0" data-c="@"></b>',
    );
    // Clasa existentă rămâne; pastila grupului și linkurile oarecare nu se ating.
    expect(out).toContain('<a class="gcs-userLink gcs-name gcs-name--admin" href="/m/u2" data-user-id="u2" data-text="Bob">Bob</a>');
    expect(out).toContain('<a class="gcs-groupMention" href="/members?group=3" data-group-id="3">@Staff</a>');
    expect(out).toContain('<a href="/x" data-user-id="u3">x</a>');
  });

  test("grafemele (diacritice, emoji) rămân întregi; un nume prea lung nu se desparte", () => {
    expect(nameLetters("Ștefan")).toEqual(["Ș", "t", "e", "f", "a", "n"]);
    expect(nameLetters("A👍🏽")).toEqual(["A", "👍🏽"]);
    expect(nameLetters("x".repeat(MEMBER_NAME_MAX_LETTERS + 1))).toBeNull();
    expect(memberNameParts({ name: "x".repeat(MEMBER_NAME_MAX_LETTERS + 1), letters: true }).letters).toBeNull();
  });
});
