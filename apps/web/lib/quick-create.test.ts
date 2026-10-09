import { describe, expect, test } from "vitest";
import { deviceForWidth, guessDevice } from "./header-device";
import { buildQuickCreate, pageContext, QUICK_CREATE_FORUMS } from "./quick-create";

const forums = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, slug: `f${i + 1}`, name: `Forum ${i + 1}` }));
const none = { forum: null, forums: [], canMessage: false, clans: false, tickets: false, sanctions: false };

describe("meniul „+ Creează”", () => {
  test("în pagina unui forum, primul item e „Topic nou în <forum>”; restul forumurilor apar în submeniu", () => {
    const { items, forums: list } = buildQuickCreate({ ...none, forum: forums[2]!, forums, canMessage: true });
    expect(items[0]).toMatchObject({ key: "topicHere", href: "/forum/3-f3/new", labelKey: "topicIn", params: { forum: "Forum 3" }, context: true });
    expect(list.map((f) => f.href)).not.toContain("/forum/3-f3/new");
    expect(list).toHaveLength(QUICK_CREATE_FORUMS);
  });

  test("fiecare aplicație contribuie doar cu dreptul ei", () => {
    expect(buildQuickCreate(none).items).toEqual([]);
    expect(buildQuickCreate({ ...none, canMessage: true, clans: true }).items.map((i) => i.key)).toEqual(["message", "clan"]);
    expect(buildQuickCreate({ ...none, tickets: true, sanctions: true }).items.map((i) => [i.key, i.href])).toEqual([
      ["ticket", "/servers/tickets/new"],
      ["sanction", "/bans/new"],
    ]);
  });

  test("contextul paginii: forumul sau topicul din adresă", () => {
    expect(pageContext("/forum/12-anunturi")).toEqual({ forumId: 12 });
    expect(pageContext("/forum/12-anunturi/new")).toEqual({ forumId: 12 });
    expect(pageContext("/topic/345-titlu?page=2")).toEqual({ topicId: 345 });
    expect(pageContext("/topic/345/post/9")).toEqual({ topicId: 345 });
    expect(pageContext("/members/abc")).toBeNull();
    expect(pageContext("/forum")).toBeNull();
  });
});

describe("dispozitivul antetului", () => {
  test("lățimea: telefon < 768, tabletă < 1100, desktop", () => {
    expect([375, 767, 768, 1099, 1100, 1440].map(deviceForWidth)).toEqual(["mobile", "mobile", "tablet", "tablet", "desktop", "desktop"]);
  });
  test("prima randare: client hints, apoi user-agent", () => {
    expect(guessDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "?0")).toBe("desktop");
    expect(guessDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari", null)).toBe("mobile");
    expect(guessDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", null)).toBe("mobile");
    expect(guessDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", null)).toBe("tablet");
    expect(guessDevice("Mozilla/5.0 (Linux; Android 14; SM-X710) Safari", null)).toBe("tablet");
    expect(guessDevice("anything", "?1")).toBe("mobile");
    expect(guessDevice(null, null)).toBe("desktop");
  });
});
