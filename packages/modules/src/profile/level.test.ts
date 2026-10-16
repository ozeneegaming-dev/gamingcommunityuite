import { describe, expect, test } from "vitest";
import { levelProgress, type GcsLadderRank } from "./level";

const rank = (id: number, name: string, position: number, t: Partial<Pick<GcsLadderRank, "minPosts" | "minPoints" | "minReputation">> = {}): GcsLadderRank => ({
  id,
  name,
  position,
  minPosts: t.minPosts ?? null,
  minPoints: t.minPoints ?? null,
  minReputation: t.minReputation ?? null,
});

const ladder = [rank(3, "Veteran", 2, { minPoints: 1240 }), rank(1, "Nou", 0, { minPoints: 0 }), rank(2, "Activ", 1, { minPoints: 300 }), rank(4, "Elită", 3, { minPoints: 1800 })];

describe("nivelul membrului", () => {
  test("nivelul = locul rangului în scară; progresul spre rangul următor, pe XP", () => {
    const p = levelProgress({ rankId: 3, points: 1620, postsCount: 0, reputation: 0 }, ladder);
    expect(p.level).toBe(3);
    expect(p.rank).toBe("Veteran");
    expect(p.next).toEqual({ level: 4, name: "Elită", unit: "xp", have: 1620, need: 1800, remaining: 180 });
    // (1620 − 1240) / (1800 − 1240) = 67,8 % → 67.
    expect(p.percent).toBe(67);
    expect(p.xp).toBe(1620);
  });

  test("ultimul rang: 100 %, fără rang următor; fără ranguri: nivelul 0", () => {
    expect(levelProgress({ rankId: 4, points: 5000, postsCount: 0, reputation: 0 }, ladder)).toMatchObject({ level: 4, next: null, percent: 100 });
    expect(levelProgress({ rankId: null, points: 10, postsCount: 0, reputation: 0 }, [])).toEqual({ level: 0, rank: null, next: null, percent: 0, xp: 10 });
  });

  test("fără rang încă: primul rang e următorul; pragurile pe postări sau reputație contează când XP lipsește", () => {
    const posts = [rank(1, "Începător", 0, { minPosts: 10 }), rank(2, "Membru", 1, { minPosts: 50 })];
    expect(levelProgress({ rankId: null, points: 0, postsCount: 4, reputation: 0 }, posts)).toMatchObject({
      level: 0,
      next: { level: 1, name: "Începător", unit: "posts", remaining: 6 },
      percent: 40,
    });
    expect(levelProgress({ rankId: 1, points: 0, postsCount: 30, reputation: 0 }, posts).percent).toBe(50);
    const rep = [rank(1, "A", 0), rank(2, "B", 1, { minReputation: 20 })];
    expect(levelProgress({ rankId: 1, points: 0, postsCount: 0, reputation: 5 }, rep)).toMatchObject({ level: 1, next: { unit: "reputation", remaining: 15 }, percent: 25 });
  });

  test("un rang următor fără praguri (acordat manual) nu arată progres", () => {
    const manual = [rank(1, "A", 0, { minPoints: 0 }), rank(2, "Staff", 1)];
    expect(levelProgress({ rankId: 1, points: 50, postsCount: 0, reputation: 0 }, manual)).toMatchObject({ level: 1, percent: 100, next: { name: "Staff", remaining: 0 } });
  });
});
