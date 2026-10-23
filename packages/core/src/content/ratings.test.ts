import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { GcsContentRatingService, type GcsRatingDenial } from "./ratings";

let world: GcsTestWorld;
let ratings: GcsContentRatingService;
let author: GcsActor;
let a: GcsActor;
let b: GcsActor;
let mod: GcsActor;
let changeVote: boolean;
const onChange: { id: string; avg: number; count: number }[] = [];
const GUEST: GcsActor = { userId: null, groupIds: [], primaryGroupId: 0, isBanned: false, ip: "203.0.113.9" };

/** Un tip de conținut de test: „secret” nu se vede; autorul nu-și poate nota conținutul; doar `mod` moderează. */
beforeEach(async () => {
  world = await createWorld();
  ratings = new GcsContentRatingService({ db: world.db, bus: world.bus });
  author = await world.actorFor(await world.createUser("ShadowRO", "member"));
  a = await world.actorFor(await world.createUser("Krypt", "member"));
  b = await world.actorFor(await world.createUser("Mara", "member"));
  mod = await world.actorFor(await world.createUser("Fondator", "root_admin"));
  changeVote = true;
  onChange.length = 0;
  ratings.register("test.item", {
    canView: async (_actor, id) => id !== "secret",
    check: async (actor, _id): Promise<GcsRatingDenial | null> => (!actor.userId ? "guest" : actor.userId === author.userId ? "own_content" : null),
    changeVote: async () => changeVote,
    canModerate: async (actor) => actor.userId === mod.userId,
    onChange: async (_tx, id, s) => void onChange.push({ id, ...s }),
    tags: (id) => [`item:${id}`],
  });
});

afterAll(async () => {
  await world.db.$disconnect();
  world.redis.disconnect();
});

describe("serviciul generic de note (contentRating)", () => {
  test("media, numărul voturilor, votul vizitatorului și distribuția (5★ … 1★)", async () => {
    expect(await ratings.rate(a, "test.item", "1", 5)).toEqual({ avg: 5, count: 1 });
    expect(await ratings.rate(b, "test.item", "1", 4)).toEqual({ avg: 4.5, count: 2 });
    expect(await ratings.view(a, "test.item", "1")).toEqual({ avg: 4.5, count: 2, mine: 5, canRate: true, reason: null, canChange: true });
    expect(await ratings.distribution("test.item", "1")).toEqual([
      { stars: 5, count: 1 },
      { stars: 4, count: 1 },
      { stars: 3, count: 0 },
      { stars: 2, count: 0 },
      { stars: 1, count: 0 },
    ]);
    expect(await ratings.summaries("test.item", ["1", "2"])).toEqual({ "1": { avg: 4.5, count: 2 }, "2": { avg: 0, count: 0 } });
    // Aplicația își ține la zi coloanele (ex. `topics.ratingAvg`), în aceeași tranzacție.
    expect(onChange.at(-1)).toEqual({ id: "1", avg: 4.5, count: 2 });
  });

  test("schimbarea votului după setare; retragerea; cu schimbarea oprită, al doilea vot e refuzat", async () => {
    await ratings.rate(a, "test.item", "1", 2);
    expect(await ratings.rate(a, "test.item", "1", 5)).toEqual({ avg: 5, count: 1 });
    expect(await ratings.unrate(a, "test.item", "1")).toEqual({ avg: 0, count: 0 });
    changeVote = false;
    await ratings.rate(a, "test.item", "1", 3);
    await expect(ratings.rate(a, "test.item", "1", 4)).rejects.toBeInstanceOf(GcsConflict);
    await expect(ratings.unrate(a, "test.item", "1")).rejects.toBeInstanceOf(GcsConflict);
    // Același vot din nou nu e o schimbare.
    expect(await ratings.rate(a, "test.item", "1", 3)).toEqual({ avg: 3, count: 1 });
    expect((await ratings.view(a, "test.item", "1")).reason).toBe("already_rated");
  });

  test("permisiunile: vizitatorii, autorul, conținutul invizibil, valorile din afara 1–5", async () => {
    await expect(ratings.rate(GUEST, "test.item", "1", 4)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(ratings.rate(author, "test.item", "1", 4)).rejects.toMatchObject({ params: { reason: "own_content" } });
    await expect(ratings.rate(a, "test.item", "secret", 4)).rejects.toBeInstanceOf(GcsNotFound);
    await expect(ratings.rate(a, "test.item", "1", 6)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(ratings.rate(a, "test.item", "1", 2.5)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(ratings.rate(a, "unknown.type", "1", 4)).rejects.toBeInstanceOf(GcsNotFound);
    expect(await ratings.view(GUEST, "test.item", "1")).toMatchObject({ canRate: false, reason: "guest", mine: null });
  });

  test("moderarea: lista voturilor, scoaterea unui vot abuziv și resetarea notei, cu jurnal", async () => {
    await ratings.rate(a, "test.item", "1", 1);
    await ratings.rate(b, "test.item", "1", 5);
    await expect(ratings.votes(a, "test.item", "1")).rejects.toBeInstanceOf(GcsForbidden);
    expect((await ratings.votes(mod, "test.item", "1")).map((v) => [v.name, v.value]).sort()).toEqual([
      ["Krypt", 1],
      ["Mara", 5],
    ]);
    expect(await ratings.removeVotes(mod, "test.item", "1", a.userId)).toEqual({ avg: 5, count: 1 });
    expect(await ratings.removeVotes(mod, "test.item", "1", null)).toEqual({ avg: 0, count: 0 });
    const audit = await world.db.auditLog.findMany({ where: { targetType: "test.item", targetId: "1" } });
    expect(audit.map((x) => x.action).sort()).toEqual(["rating.reset", "rating.vote.remove"]);
  });

  test("cele mai bine notate: media, apoi numărul voturilor, cu un prag minim de voturi", async () => {
    await ratings.rate(a, "test.item", "1", 5);
    await ratings.rate(a, "test.item", "2", 4);
    await ratings.rate(b, "test.item", "2", 5);
    await ratings.rate(a, "test.item", "3", 5);
    await ratings.rate(b, "test.item", "3", 5);
    expect((await ratings.top("test.item", { limit: 5 })).map((r) => r.contentId)).toEqual(["3", "1", "2"]);
    expect((await ratings.top("test.item", { limit: 5, minVotes: 2 })).map((r) => r.contentId)).toEqual(["3", "2"]);
    expect((await ratings.top("test.item", { limit: 5, ids: ["1", "2"] })).map((r) => r.contentId)).toEqual(["1", "2"]);
  });
});
