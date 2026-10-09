import { describe, expect, test } from "vitest";
import { mentionIndex, mentionQueryAt, mentionTokens, parseMentionHints, parseTextMentions, splitMentions } from "./textMentions";

describe("mențiunile din textul simplu", () => {
  test("cuvântul `@…` scris acum, până la cursor", () => {
    expect(mentionQueryAt("salut @Bo", 9)).toEqual({ start: 6, query: "Bo" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("(@an", 4)).toEqual({ start: 1, query: "an" });
    // Un e-mail sau un cuvânt terminat nu deschid sugestiile.
    expect(mentionQueryAt("a@b.ro", 6)).toBeNull();
    expect(mentionQueryAt("@Bogdan vino", 12)).toBeNull();
    // Cursorul la mijloc: contează doar ce e înaintea lui.
    expect(mentionQueryAt("@Bo text", 3)).toEqual({ start: 0, query: "Bo" });
  });

  test("`@Nume` întreg, fără să conteze literele mari; numele cu spațiu", () => {
    expect(mentionIndex("hei @bogdan!", "Bogdan")).toBe(4);
    expect(mentionIndex("hei @Bogdanel", "Bogdan")).toBe(-1);
    expect(mentionIndex("x@Bogdan", "Bogdan")).toBe(-1);
    expect(mentionIndex("cu @Ana Maria azi", "Ana Maria")).toBe(3);
    expect(mentionIndex("@Ana și @Ana", "Ana", 1)).toBe(8);
  });

  test("cuvintele `@…`, indiciile și mențiunile salvate", () => {
    expect(mentionTokens("@Ana, @bogdan. și @Ana")).toEqual(["Ana", "bogdan"]);
    expect(parseMentionHints([{ kind: "user", id: "u1" }, { kind: "group", id: 3 }, { kind: "x", id: "1" }, { kind: "user", id: "u1" }, "bad", { kind: "user", id: "a b" }])).toEqual([
      { kind: "user", id: "u1" },
      { kind: "group", id: "3" },
    ]);
    expect(parseTextMentions([{ kind: "user", id: "u1", name: "Ana", extra: 1 }, { kind: "user", id: 2, name: "x" }])).toEqual([{ kind: "user", id: "u1", name: "Ana" }]);
  });

  test("împărțirea în bucăți: toate aparițiile, numele mai lungi întâi, fără suprapuneri", () => {
    const ana = { kind: "user" as const, id: "u1", name: "Ana" };
    const anaMaria = { kind: "user" as const, id: "u2", name: "Ana Maria" };
    const mods = { kind: "group" as const, id: "7", name: "Moderatori" };
    expect(splitMentions("@Ana Maria și @ana, @Moderatori!", [ana, anaMaria, mods])).toEqual([
      { text: "@Ana Maria", mention: anaMaria },
      { text: " și " },
      { text: "@ana", mention: ana },
      { text: ", " },
      { text: "@Moderatori", mention: mods },
      { text: "!" },
    ]);
    expect(splitMentions("fără mențiuni", [ana])).toEqual([{ text: "fără mențiuni" }]);
  });
});
