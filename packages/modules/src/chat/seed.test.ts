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

  test("varianta „site gol” nu creează mesaje și nici camere demo", async () => {
    await demo("empty");
    expect(await w.db.chatMessage.count()).toBe(0);
    expect((await w.db.chatChannel.findMany()).map((c) => c.key)).toEqual(["general"]);
  });

  test("etapa 5: camerele publice demo (Off-topic, Caut echipă) se creează o singură dată, cu permisiuni", async () => {
    await demo("demo");
    await demo("demo");
    const keys = (await w.db.chatChannel.findMany({ orderBy: { position: "asc" } })).map((c) => c.key);
    expect(keys).toEqual(["general", "offtopic", "lfg"]);
    expect(await w.db.containerPermission.count({ where: { containerType: "chat", containerId: "lfg" } })).toBeGreaterThan(0);
  });

  test("etapa 5: câmpurile de profil au iconițe și apar în postbit; layout-ul paginii principale există în ambele variante", async () => {
    await demo("demo");
    const fields = await w.db.profileField.findMany({ where: { key: { in: ["country", "platform", "rank_cs2"] } } });
    expect(fields.every((f) => f.icon?.startsWith("fa-"))).toBe(true);
    expect(fields.every((f) => f.showInPostbit)).toBe(true);
    expect(await w.db.widgetPlacement.count({ where: { page: "index" } })).toBeGreaterThan(0);
    // Fără „RED-LINE” în datele demo.
    const texts = [
      ...(await w.db.forum.findMany({ select: { name: true } })).map((f) => f.name),
      ...(await w.db.chatMessage.findMany({ select: { body: true } })).map((m) => m.body),
      ...(await w.db.profileFieldValue.findMany({ select: { value: true } })).map((v) => v.value),
    ];
    expect(texts.some((x) => x.includes("RED-LINE"))).toBe(false);
  });
});
