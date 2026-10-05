import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { GcsReactionService } from "./reactions";

let world: GcsTestWorld;
let reactions: GcsReactionService;
let author: GcsActor;
let fan: GcsActor;
let root: GcsActor;
let ids: Record<string, number>;

/** Conținutul de test: „item-ul N” e scris de autor; „secret” nu e vizibil nimănui. */
beforeEach(async () => {
  world = await createWorld();
  reactions = new GcsReactionService({ db: world.db, bus: world.bus, cache: world.cache, acp: world.acp });
  author = await world.actorFor(await world.createUser("ShadowRO", "member"));
  fan = await world.actorFor(await world.createUser("Krypt", "member"));
  root = await world.actorFor(await world.createUser("Fondator", "root_admin"));
  reactions.registerContent("test.item", {
    author: async (id) => (id === "secret" ? null : author.userId),
    canView: async (_actor, id) => id !== "secret",
    tags: (id) => [`item:${id}`],
  });
  const defaults = [
    { key: "like", label: "Like", symbol: "▲", color: "#FF6B74", weight: 1, position: 0 },
    { key: "disagree", label: "Dezacord", symbol: "👎", color: "#A1A7B4", weight: -1, position: 1 },
    { key: "haha", label: "Haha", symbol: "😂", color: "#F4B740", weight: 0, position: 2, enabled: false },
  ];
  await world.db.reaction.createMany({ data: defaults });
  ids = Object.fromEntries((await world.db.reaction.findMany()).map((r) => [r.key, r.id]));
});

afterAll(async () => {
  await world.db.$disconnect();
  world.redis.disconnect();
});

const reputation = async () => (await world.db.user.findUniqueOrThrow({ where: { id: author.userId! } })).reputation;
const ref = (reactionId: number | null, contentId = "1") => ({ contentType: "test.item", contentId, reactionId });

describe("GcsReactionService.react", () => {
  test("Like → +1 reputație; schimbat pe Dezacord → −1 în total; retras → 0", async () => {
    await reactions.react(fan, ref(ids.like!));
    expect(await reputation()).toBe(1);
    await reactions.react(fan, ref(ids.disagree!));
    expect(await reputation()).toBe(-1);
    await reactions.react(fan, ref(null));
    expect(await reputation()).toBe(0);
    expect(await world.db.contentReaction.count()).toBe(0);
  });

  test("o singură reacție per user per conținut; sumarul și reacția proprie", async () => {
    await reactions.react(fan, ref(ids.like!));
    await reactions.react(fan, ref(ids.like!));
    await reactions.react(root, ref(ids.like!));
    await reactions.react(root, ref(ids.disagree!, "2"));

    const summary = await reactions.summary("test.item", ["1", "2", "3"]);
    expect(summary).toEqual({ "1": [{ reactionId: ids.like, count: 2 }], "2": [{ reactionId: ids.disagree, count: 1 }] });
    await expect(reactions.mine(fan.userId, "test.item", ["1", "2"])).resolves.toEqual({ "1": ids.like });
  });

  test("pe propriul conținut, ca vizitator sau pe conținut invizibil → refuzat", async () => {
    await expect(reactions.react(author, ref(ids.like!))).rejects.toBeInstanceOf(GcsForbidden);
    await expect(reactions.react({ ...fan, userId: null }, ref(ids.like!))).rejects.toBeInstanceOf(GcsForbidden);
    await expect(reactions.react(fan, ref(ids.like!, "secret"))).rejects.toBeInstanceOf(GcsNotFound);
    await expect(reactions.react(fan, { contentType: "necunoscut", contentId: "1", reactionId: ids.like! })).rejects.toBeInstanceOf(GcsNotFound);
  });

  test("o reacție dezactivată sau inexistentă → GcsValidationError", async () => {
    await expect(reactions.react(fan, ref(ids.haha!))).rejects.toBeInstanceOf(GcsValidationError);
    await expect(reactions.react(fan, ref(9999))).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("reacții simultane ale aceluiași user → una singură, reputația corectă", async () => {
    await Promise.allSettled([reactions.react(fan, ref(ids.like!)), reactions.react(fan, ref(ids.like!)), reactions.react(fan, ref(ids.like!))]);
    expect(await world.db.contentReaction.count()).toBe(1);
    expect(await reputation()).toBe(1);
  });
});

describe("GcsReactionService — ACP", () => {
  test("lista activă e în ordine; adăugare, editare, reordonare, dezactivare", async () => {
    await expect(reactions.list()).resolves.toMatchObject([{ key: "like" }, { key: "disagree" }]);
    const fire = await reactions.upsert(root, { key: "fire", label: "Fire", symbol: "🔥", color: "#FF9F1C", weight: 2, enabled: true });
    await reactions.reorder(root, [fire.id, ids.like!, ids.disagree!, ids.haha!]);
    expect((await reactions.list()).map((r) => r.key)).toEqual(["fire", "like", "disagree"]);
    await reactions.upsert(root, { id: ids.like!, key: "like", label: "Apreciez", symbol: "▲", color: "#FF6B74", weight: 1, enabled: false });
    expect((await reactions.list()).map((r) => r.key)).toEqual(["fire", "disagree"]);
  });

  test("validări și drept ACP", async () => {
    const bad = { key: "Fire!", label: "", symbol: "", color: "rosu", weight: 99, enabled: true };
    await expect(reactions.upsert(root, bad)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(
      reactions.upsert(fan, { key: "fire", label: "Fire", symbol: "🔥", color: "#FF9F1C", weight: 2, enabled: true }),
    ).rejects.toBeInstanceOf(GcsForbidden);
  });
});
