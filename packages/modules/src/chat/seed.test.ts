import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { seedForumDemo } from "../forums/seed";
import { seedProfileDemo } from "../profile/demo";
import { seedChatDemo } from "./seed";

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
  await seedChatDemo(ctx);
};

describe("seedChatDemo", () => {
  test("shoutbox-ul primește mesajele demo (Fondator, Krypt, ShadowRO), recente, o singură dată", async () => {
    await demo("demo");
    await demo("demo");
    const messages = await w.db.chatMessage.findMany({ orderBy: { id: "asc" }, include: { author: { select: { name: true } }, channel: { select: { key: true } } } });
    expect(messages).toHaveLength(4);
    expect(messages.every((m) => m.channel.key === "general")).toBe(true);
    expect(new Set(messages.map((m) => m.author?.name))).toEqual(new Set(["Fondator", "Krypt", "ShadowRO"]));
    // În retenția de 7 zile, în ordinea conversației.
    expect(messages.every((m) => m.createdAt.getTime() > Date.now() - 86_400_000)).toBe(true);
    expect(messages.map((m) => m.createdAt.getTime())).toEqual([...messages.map((m) => m.createdAt.getTime())].sort((a, b) => a - b));
  });

  test("varianta „site gol” nu creează mesaje", async () => {
    await demo("empty");
    expect(await w.db.chatMessage.count()).toBe(0);
  });
});
