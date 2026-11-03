import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { DEFAULT_SEARCH, SEARCH_SETTING, searchTerms } from "./searchConfig";

let w: GcsRemovalWorld;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
});

describe("setările căutării", () => {
  test("vizitatorii opriți, lungimea minimă, jurnalul anonim al termenilor (cu cei fără rezultate)", async () => {
    const member = await w.user("Cautator");
    const forum = await w.forum();
    await w.topic(member, forum, "Ghid de configurare pentru mix");
    const guest = { userId: null, groupIds: [w.group("guest")], primaryGroupId: w.group("guest"), isBanned: false, ip: "198.51.100.40" };

    await w.s.settings.set(SEARCH_SETTING, { ...DEFAULT_SEARCH, guests: false, minLength: 4 }, w.system());
    await expect(w.s.search.search(guest, { q: "configurare", type: "topics", page: 1 })).rejects.toMatchObject({ params: { reason: "login_required" } });
    await expect(w.s.search.search(member, { q: "mix", type: "topics", page: 1 })).rejects.toMatchObject({ fields: { q: "too_short" }, params: { min: "4" } });

    const hit = await w.s.search.search(member, { q: "configurare", type: "topics", page: 1 });
    expect(hit.pagination.total).toBe(1);
    await w.s.search.search(member, { q: "inexistent", type: "topics", page: 1 });
    await w.s.search.search(member, { q: "Inexistent", type: "topics", page: 1 });

    const log = await searchTerms(w.s.kv, Date.now() - 60_000);
    expect(log.total).toBe(3);
    expect(log.terms.map((x) => [x.q, x.count, x.zero])).toEqual([
      ["inexistent", 2, 2],
      ["configurare", 1, 0],
    ]);

    await w.s.settings.set(SEARCH_SETTING, { ...DEFAULT_SEARCH, logTerms: false }, w.system());
    await w.s.search.search(member, { q: "altceva", type: "topics", page: 1 });
    expect((await searchTerms(w.s.kv, 0)).total).toBe(3);
  });

  test("validarea: rezultatele pe pagină 0 sau 10–50", async () => {
    await expect(w.s.settings.set(SEARCH_SETTING, { ...DEFAULT_SEARCH, perPage: 5 }, w.system())).rejects.toThrow();
    await w.s.settings.set(SEARCH_SETTING, { ...DEFAULT_SEARCH, perPage: 10 }, w.system());
  });
});
