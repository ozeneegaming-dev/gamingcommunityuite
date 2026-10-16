import { GcsRealtime, REALTIME_CHANNEL } from "@gcs/core";
import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, inject, test } from "vitest";
import { createForumWorld, doc, type GcsForumWorld } from "../../test/world";
import { registerLiveEvents } from "./live";

let w: GcsForumWorld;
let sub: Redis;
let received: { room: string; event: string; data: unknown }[];

beforeEach(async () => {
  w = await createForumWorld();
  registerLiveEvents(w.bus, { db: w.db, realtime: new GcsRealtime(w.redis) });
  sub?.disconnect();
  sub = new Redis(inject("redisUrl"), { db: Number(process.env.VITEST_POOL_ID ?? "1") });
  received = [];
  await sub.subscribe(REALTIME_CHANNEL);
  sub.on("message", (_c, raw: string) => received.push(JSON.parse(raw) as (typeof received)[number]));
});

afterAll(async () => {
  sub.disconnect();
  await w.db.$disconnect();
  w.redis.disconnect();
});

const settle = () => new Promise((r) => setTimeout(r, 100));

describe("evenimentele live ale topicului", () => {
  test("un răspuns vizibil → topic:{id} post:new; unul în așteptare abia la aprobare", async () => {
    const tree = await w.createTree();
    const t = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Live", content: doc("x") });
    const r = await w.posts.reply(w.member, { topicId: t.topicId, content: doc("salut") });
    await settle();
    expect(received.filter((m) => m.event === "post:new")).toEqual([
      { room: `topic:${t.topicId}`, event: "post:new", data: { topicId: t.topicId, postId: r.postId, authorId: w.member.userId } },
    ]);

    received.length = 0;
    const newbie = await w.actorFor(await w.createUser("Nou", "new_member"));
    const pending = await w.posts.reply(newbie, { topicId: t.topicId, content: doc("moderat") });
    expect(pending.pending).toBe(true);
    await settle();
    expect(received.filter((m) => m.event === "post:new")).toEqual([]);
    await w.moderation.approve(w.root, [pending.postId]);
    await settle();
    expect(received.filter((m) => m.event === "post:new").map((m) => (m.data as { postId: number }).postId)).toEqual([pending.postId]);
  });

  test("o postare vizibilă trimite și semnalul consolei (activitate nouă), fără date despre ea", async () => {
    const tree = await w.createTree();
    await w.topics.create(w.root, { forumId: tree.forum.id, title: "Semnal", content: doc("x") });
    await settle();
    expect(received.filter((m) => m.event === "activity:new")).toEqual([{ room: "presence", event: "activity:new", data: { kind: "forum" } }]);
  });
});
