import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { snapshotCounters } from "../../test/world";
import { seedForumDemo } from "../forums/seed";
import { seedProfileDemo } from "./demo";

let w: GcsProfileWorld;
let adminEmail: string;

beforeEach(async () => {
  w = await createProfileWorld();
  adminEmail = (await w.db.user.findUniqueOrThrow({ where: { id: w.root.userId! } })).email;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const demo = async (variant: "demo" | "empty") => {
  const ctx = { db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, variant, adminEmail } as const;
  await seedForumDemo(ctx);
  await seedProfileDemo(ctx);
};

describe("seedProfileDemo", () => {
  test("Krypt (VIP Legend permanent, Neon) și ShadowRO (VIP Gold 30 de zile, Gold), cu răspunsuri în topicul de bun venit și contoare corecte", async () => {
    await demo("demo");
    const krypt = await w.db.user.findUniqueOrThrow({
      where: { email: "krypt@demo.invalid" },
      include: { primaryGroup: true, avatarFrame: true, badges: { include: { badge: true } }, vipSubscriptions: true, accounts: true },
    });
    expect(krypt).toMatchObject({ primaryGroup: { key: "vip_legend" }, avatarFrame: { key: "neon" }, postsCount: 1 });
    expect(krypt.vipSubscriptions).toMatchObject([{ status: "ACTIVE", expiresAt: null }]);
    expect(krypt.badges.map((b) => b.badge.key).sort()).toEqual(["first_post", "rp_veteran", "tournament_champion", "vip"]);
    // Fără parolă și fără cont legat: nimeni nu se poate autentifica în contul demo.
    expect(krypt.accounts).toEqual([]);

    const shadow = await w.db.user.findUniqueOrThrow({ where: { email: "shadowro@demo.invalid" }, include: { primaryGroup: true, avatarFrame: true, vipSubscriptions: true } });
    expect(shadow).toMatchObject({ primaryGroup: { key: "vip_gold" }, avatarFrame: { key: "gold" } });
    expect(shadow.vipSubscriptions[0]!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const admin = await w.db.user.findUniqueOrThrow({ where: { id: w.root.userId! }, include: { avatarFrame: true, profileValues: true } });
    expect(admin.avatarFrame?.key).toBe("fire");
    expect(admin.profileValues.length).toBeGreaterThanOrEqual(2);
    expect(await w.db.profileField.findUnique({ where: { key: "rank_cs2" } })).not.toBeNull();

    const welcome = await w.db.topic.findFirstOrThrow({ where: { authorId: w.root.userId! } });
    expect(welcome.repliesCount).toBe(2);
    const before = await snapshotCounters(w.db);
    await w.db.$transaction((tx) => w.counters.recountAll(tx));
    expect(await snapshotCounters(w.db)).toEqual(before);
  });

  test("a doua rulare nu dublează nimic", async () => {
    await demo("demo");
    const counts = async () => [await w.db.user.count(), await w.db.post.count(), await w.db.vipSubscription.count(), await w.db.userBadge.count()];
    const first = await counts();
    await demo("demo");
    expect(await counts()).toEqual(first);
  });

  test("varianta „empty” nu creează membri demo", async () => {
    await demo("empty");
    expect(await w.db.user.findUnique({ where: { email: "krypt@demo.invalid" } })).toBeNull();
  });
});
