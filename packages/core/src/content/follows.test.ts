import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden } from "../errors";
import type { GcsActor } from "../permissions/types";
import { GcsFollowService } from "./follows";

let world: GcsTestWorld;
let follows: GcsFollowService;
let mara: GcsActor;
let krypt: GcsActor;

beforeEach(async () => {
  world = await createWorld();
  follows = new GcsFollowService({ db: world.db });
  mara = await world.actorFor(await world.createUser("Mara", "member"));
  krypt = await world.actorFor(await world.createUser("Krypt", "member"));
});

afterAll(async () => {
  await world.db.$disconnect();
  world.redis.disconnect();
});

describe("GcsFollowService", () => {
  test("follow e idempotent; contorul și isFollowing sunt corecte", async () => {
    await follows.follow(mara, "topic", "7");
    await follows.follow(mara, "topic", "7");
    await follows.follow(krypt, "topic", "7");
    await follows.follow(krypt, "forum", "7");

    await expect(follows.count("topic", "7")).resolves.toBe(2);
    await expect(follows.isFollowing(mara.userId, "topic", "7")).resolves.toBe(true);
    await expect(follows.isFollowing(mara.userId, "forum", "7")).resolves.toBe(false);
    await expect(follows.isFollowing(null, "topic", "7")).resolves.toBe(false);
  });

  test("unfollow șterge doar urmărirea actorului", async () => {
    await follows.follow(mara, "topic", "7");
    await follows.follow(krypt, "topic", "7");
    await follows.unfollow(mara, "topic", "7");
    await follows.unfollow(mara, "topic", "7");
    await expect(follows.count("topic", "7")).resolves.toBe(1);
    await expect(follows.isFollowing(krypt.userId, "topic", "7")).resolves.toBe(true);
  });

  test("vizitatorul nu poate urmări", async () => {
    const guest: GcsActor = { ...mara, userId: null };
    await expect(follows.follow(guest, "topic", "7")).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("followers întoarce id-urile userilor (pentru notificările din etapa 4)", async () => {
    await follows.follow(mara, "topic", "7");
    await follows.follow(krypt, "topic", "7");
    await expect(follows.followers("topic", "7")).resolves.toEqual(expect.arrayContaining([mara.userId, krypt.userId]));
  });
});
