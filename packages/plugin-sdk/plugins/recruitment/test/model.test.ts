import { describe, expect, test } from "vitest";
import { idOf, questionList, readApplication, readPosition, readSettings, safeUrl, statusTone } from "../src/model";
import { applyHref, renderIndexMeta } from "../src/views";
import type { Position } from "../src/store";

const opts = { groups: [3, 7], forums: [12] };
const base = { name: "  Moderator  ", description: "Moderezi\r\nforumul.", status: "open", groupId: "7", applyMode: "form", questions: "Câți ani ai?\n\nDe ce?" };

describe("formularul unui post (ACP)", () => {
  test("curăță textele și acceptă grupul existent", () => {
    expect(readPosition(base, opts)).toEqual({
      ok: true,
      value: { id: null, name: "Moderator", description: "Moderezi\nforumul.", status: "open", groupId: 7, icon: "", applyMode: "form", applyForumId: null, applyUrl: "", questions: "Câți ani ai?\n\nDe ce?", sort: 0 },
    });
  });

  test("refuză grupul, forumul, iconița sau linkul greșit și starea necunoscută", () => {
    expect(readPosition({ ...base, groupId: "99" }, opts)).toEqual({ ok: false, error: "group" });
    expect(readPosition({ ...base, status: "maybe" }, opts)).toEqual({ ok: false, error: "status" });
    expect(readPosition({ ...base, icon: "x onerror" }, opts)).toEqual({ ok: false, error: "icon" });
    expect(readPosition({ ...base, applyMode: "topic", applyForumId: "5" }, opts)).toEqual({ ok: false, error: "forum" });
    expect(readPosition({ ...base, applyMode: "link", applyUrl: "javascript:alert(1)" }, opts)).toEqual({ ok: false, error: "url" });
    expect(readPosition({ ...base, applyMode: "link", applyUrl: "" }, opts)).toEqual({ ok: false, error: "url" });
    expect(readPosition({ ...base, name: "x" }, opts)).toEqual({ ok: false, error: "name" });
  });

  test("forumul / linkul se păstrează doar pentru modul lor", () => {
    const topic = readPosition({ ...base, applyMode: "topic", applyForumId: "12", applyUrl: "https://a.ro" }, opts);
    expect(topic).toMatchObject({ ok: true, value: { applyForumId: 12, applyUrl: "" } });
    const link = readPosition({ ...base, applyMode: "link", applyUrl: "https://forms.exemplu.ro/x", applyForumId: "12" }, opts);
    expect(link).toMatchObject({ ok: true, value: { applyForumId: null, applyUrl: "https://forms.exemplu.ro/x" } });
  });

  test("adresele: interne sau https, fără `//`, ghilimele sau spații", () => {
    expect(safeUrl("/forum/12-recrutare")).toBe("/forum/12-recrutare");
    expect(safeUrl("//evil.ro")).toBeNull();
    expect(safeUrl("http://a.ro")).toBeNull();
    expect(safeUrl('https://a.ro/"x')).toBeNull();
    expect(idOf("12")).toBe(12);
    expect(idOf("0")).toBeNull();
    expect(idOf("1 OR 1=1")).toBeNull();
  });
});

describe("aplicația unui membru", () => {
  test("cu întrebări: toate obligatorii, răspunsurile se pun sub întrebare", () => {
    const q = questionList("Câți ani ai?\n\nDe ce?");
    expect(q).toEqual(["Câți ani ai?", "De ce?"]);
    expect(readApplication({ q0: "19", q1: "" }, q, 0)).toEqual({ ok: false, error: "missing" });
    expect(readApplication({ q0: "19", q1: "Îmi place comunitatea." }, q, 0)).toEqual({ ok: true, value: "Câți ani ai?\n19\n\nDe ce?\nÎmi place comunitatea." });
  });

  test("fără întrebări: un singur text, cu lungimea minimă din setări", () => {
    expect(readApplication({ answers: "scurt" }, [], 40)).toEqual({ ok: false, error: "short" });
    expect(readApplication({ answers: "x".repeat(6001) }, [], 0)).toEqual({ ok: false, error: "long" });
    expect(readApplication({ answers: "a\u0000b" }, [], 0)).toEqual({ ok: true, value: "ab" });
  });

  test("setările stricate primesc valorile implicite", () => {
    expect(readSettings({ minLength: "x" })).toEqual({ intro: "", oneOpen: true, minLength: 40 });
    expect(readSettings({ oneOpen: false, minLength: 5000 })).toMatchObject({ oneOpen: false, minLength: 2000 });
  });
});

describe("rândul „Recrutare” de pe index", () => {
  const pos = (p: Partial<Position>): Position => ({ id: 1, name: "Moderator", description: "", status: "open", groupId: null, icon: "", applyMode: "form", applyForumId: null, applyUrl: "", questions: "", sort: 0, pending: 0, ...p });
  const ctx = { t: (k: string) => k } as never;
  const forums = new Map([[12, { id: 12, name: "Aplicații", url: "/forum/12-aplicatii" }]]);

  test("etichetele ON / OFF / NOU și linkul de aplicare după mod", () => {
    expect([statusTone("open"), statusTone("new"), statusTone("closed")]).toEqual(["on", "new", "off"]);
    expect(applyHref(pos({}), forums)).toBe("/p/gcs.recruitment/apply/1");
    expect(applyHref(pos({ applyMode: "topic", applyForumId: 12 }), forums)).toBe("/forum/12-aplicatii/new");
    expect(applyHref(pos({ applyMode: "link", applyUrl: "https://a.ro" }), forums)).toBe("https://a.ro");
    expect(applyHref(pos({ status: "closed" }), forums)).toBeNull();
  });

  test("numele postului e escapat; un post închis duce la pagina posturilor", () => {
    const html = renderIndexMeta(ctx, [pos({ name: "<b>Admin</b>" }), pos({ id: 2, name: "Designer", status: "closed" })], forums);
    expect(html).toContain("&lt;b&gt;Admin&lt;/b&gt;");
    expect(html).toContain('gcsp-rec__tag--off');
    expect(html).toContain('href="/p/gcs.recruitment"');
  });
});
