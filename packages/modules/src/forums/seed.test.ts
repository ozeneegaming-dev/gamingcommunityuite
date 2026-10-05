import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, snapshotCounters, type GcsForumWorld } from "../../test/world";
import { seedForumDemo } from "./seed";

let w: GcsForumWorld;
let adminEmail: string;

beforeEach(async () => {
  w = await createForumWorld();
  adminEmail = (await w.db.user.findUniqueOrThrow({ where: { id: w.root.userId! } })).email;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const demo = (variant: "demo" | "empty") =>
  seedForumDemo({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, variant, adminEmail });

describe("seedForumDemo", () => {
  test("„demo” creează structura din macheta Main, prefixele și topicul de bun venit", async () => {
    await demo("demo");
    const forums = await w.db.forum.findMany({ select: { name: true, type: true, parentId: true } });
    const names = forums.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(["RED-LINE", "Anunțuri", "Regulament", "Cereri & reclamații", "Cereri unban", "Servere de joc", "Counter-Strike 2", "FiveM RolePlay", "Minecraft", "Ajutor tehnic", "Comunitate", "Recrutări clan", "Off-topic"]),
    );
    expect(forums.find((f) => f.name === "Ajutor tehnic")?.type).toBe("QA");
    expect(forums.filter((f) => f.type === "CATEGORY").map((f) => f.name).sort()).toEqual(["Comunitate", "RED-LINE", "Servere de joc"]);
    expect((await w.db.topicPrefix.findMany()).map((p) => p.name)).toEqual(["Anunț", "Ajutor", "Rezolvat"]);

    const welcome = await w.db.topic.findFirstOrThrow({ include: { forum: true } });
    expect(welcome).toMatchObject({ forum: { name: "Anunțuri" }, authorId: w.root.userId, visibility: "VISIBLE" });

    // Vizitatorii văd forumurile demo (permisiunile implicite + moștenirea).
    const index = await w.queries.index(w.guest);
    expect(index.map((c) => c.name)).toEqual(["RED-LINE", "Servere de joc", "Comunitate"]);

    // Contoarele sunt corecte.
    const before = await snapshotCounters(w.db);
    await w.db.$transaction((tx) => w.counters.recountAll(tx));
    expect(await snapshotCounters(w.db)).toEqual(before);
  });

  test("rularea de două ori nu dublează nimic", async () => {
    await demo("demo");
    const counts = async () => [await w.db.forum.count(), await w.db.topic.count(), await w.db.topicPrefix.count()];
    const first = await counts();
    await demo("demo");
    expect(await counts()).toEqual(first);
  });

  test("„empty” creează doar categoria General cu forumul Discuții", async () => {
    await demo("empty");
    expect((await w.db.forum.findMany({ orderBy: { id: "asc" } })).map((f) => [f.name, f.type])).toEqual([
      ["General", "CATEGORY"],
      ["Discuții", "FORUM"],
    ]);
    expect(await w.db.topic.count()).toBe(0);
  });
});
