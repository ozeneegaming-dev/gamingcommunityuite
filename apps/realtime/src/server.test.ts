import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GcsRealtime, seedDefaults, serviceStatus, signRealtimeToken, normalizeUsername } from "@gcs/core";
import { testDbUrl, truncateAll } from "@gcs/db/test/helpers";
// Tipul lui `inject("redisUrl")` (declarat de setup-ul Redis din core).
import type {} from "@gcs/core/test/redis";
import { closeGcsServices, createGcsServices, type GcsServices } from "@gcs/modules/services";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { createRealtimeServer, type GcsRealtimeServer } from "./server";

const SECRET = "realtime-test-secret-0123456789abcdef";
let services: GcsServices;
let server: GcsRealtimeServer;
let url: string;
let configDir: string;
const sockets: Socket[] = [];
let users: Record<string, string>;
let topicId: number;
let closedTopicId: number;

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

beforeAll(async () => {
  configDir = await mkdtemp(path.join(os.tmpdir(), "gcs-realtime-"));
  process.env.DATABASE_URL = testDbUrl();
  const redis = new URL(inject("redisUrl"));
  redis.pathname = `/${process.env.VITEST_POOL_ID ?? "1"}`;
  process.env.REDIS_URL = redis.toString();
  services = createGcsServices({ configDir });
  server = createRealtimeServer({ services, secret: SECRET, corsOrigin: true });
  url = `http://127.0.0.1:${await server.listen(0)}`;
});

afterAll(async () => {
  await server.close();
  await closeGcsServices(services);
  await rm(configDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const { db, registry } = services;
  await truncateAll(db);
  await services.redis.flushdb();
  await seedDefaults(db, registry);
  const groups = Object.fromEntries((await db.group.findMany()).map((g) => [g.key, g.id]));
  users = {};
  for (const [name, group] of [["Root", "root_admin"], ["Ana", "member"], ["Bogdan", "member"]] as const) {
    const u = await db.user.create({ data: { name, nameNormalized: normalizeUsername(name), email: `${name}@mail.com`, primaryGroupId: groups[group]! } });
    users[name] = u.id;
  }
  const root = await services.actors.forUser(users.Root!, "127.0.0.1");
  const category = await services.forums.create({ parentId: null, type: "CATEGORY", name: "Cat" }, root);
  const forum = await services.forums.create({ parentId: category.id, type: "FORUM", name: "Public" }, root);
  topicId = (await services.topics.create(root, { forumId: forum.id, title: "Live", content: doc("x") })).topicId;
  // Un forum doar pentru staff: membrii nu au `forums.view`/`forums.read`.
  const staff = await services.forums.create({ parentId: category.id, type: "FORUM", name: "Staff" }, root);
  await services.groups.setContainerInherit("forum", String(staff.id), { inherits: false, parentId: null }, root);
  await services.groups.setContainerPermissions("forum", String(staff.id), { [groups.root_admin!]: ["forums.view", "forums.read", "forums.reply"] }, root);
  await services.redis.del(`gcs:rl:forum-post:${root.userId}`);
  closedTopicId = (await services.topics.create(root, { forumId: staff.id, title: "Secret", content: doc("y") })).topicId;
});

afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

async function client(auth: { token?: string }): Promise<Socket> {
  const s = connect(url, { auth, transports: ["websocket"], reconnection: false, forceNew: true });
  sockets.push(s);
  return s;
}

async function member(name: string): Promise<Socket> {
  const s = await client({ token: await signRealtimeToken({ userId: users[name]!, guestId: `g-${name}` }, SECRET) });
  await new Promise<void>((resolve, reject) => {
    s.once("connect", () => resolve());
    s.once("connect_error", reject);
  });
  return s;
}

async function guest(): Promise<Socket> {
  const s = await client({ token: await signRealtimeToken({ userId: null, guestId: "g-anon" }, SECRET) });
  await new Promise<void>((resolve) => s.once("connect", () => resolve()));
  return s;
}

const join = (s: Socket, room: string) => s.emitWithAck("join", room) as Promise<{ ok: boolean }>;

/** Așteaptă un eveniment; `null` dacă nu vine în `ms`. */
function next<T>(s: Socket, event: string, ms = 500): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.off(event, on);
      resolve(null);
    }, ms);
    const on = (data: T) => {
      clearTimeout(timer);
      resolve(data);
    };
    s.once(event, on);
  });
}

describe("gcs-realtime", () => {
  test("fără token sau cu un token falsificat → conexiunea e refuzată", async () => {
    for (const auth of [{}, { token: "x" }, { token: await signRealtimeToken({ userId: users.Ana!, guestId: "g" }, "alt-secret-0123456789") }]) {
      const s = await client(auth);
      const err = await new Promise<Error>((resolve) => s.once("connect_error", resolve));
      expect(err.message).toBe("unauthorized");
    }
  });

  test("un membru intră în camera proprie, nu și în a altcuiva", async () => {
    const ana = await member("Ana");
    expect(await join(ana, `user:${users.Ana}`)).toEqual({ ok: true });
    expect(await join(ana, `user:${users.Bogdan}`)).toEqual({ ok: false });
    expect(await join(ana, "nimic:1")).toEqual({ ok: false });
    expect(await join(ana, "acp")).toEqual({ ok: false });
    const root = await member("Root");
    expect(await join(root, "acp")).toEqual({ ok: true });
  });

  test("topic fără `forums.read` → { ok: false }", async () => {
    const ana = await member("Ana");
    expect(await join(ana, `topic:${topicId}`)).toEqual({ ok: true });
    expect(await join(ana, `topic:${closedTopicId}`)).toEqual({ ok: false });
    expect(await join(ana, "topic:abc")).toEqual({ ok: false });
  });

  test("un mesaj publicat pe gcs:rt ajunge doar la socket-urile din cameră", async () => {
    const ana = await member("Ana");
    const bogdan = await member("Bogdan");
    expect(await join(ana, `topic:${topicId}`)).toEqual({ ok: true });
    const got = next(ana, "post:new");
    const missed = next(bogdan, "post:new");
    await new GcsRealtime(services.redis).publish(`topic:${topicId}`, "post:new", { id: 42 });
    expect(await got).toEqual({ id: 42 });
    expect(await missed).toBeNull();

    // Camera `user:{id}` e automată.
    const personal = next(bogdan, "notification");
    await new GcsRealtime(services.redis).publish(`user:${users.Bogdan}`, "notification", { unread: 1 });
    expect(await personal).toEqual({ unread: 1 });
  });

  test("„scrie…”: de la un membru care poate răspunde ajunge la ceilalți; de la un vizitator e ignorat", async () => {
    const ana = await member("Ana");
    const bogdan = await member("Bogdan");
    const anon = await guest();
    for (const s of [ana, bogdan, anon]) expect(await join(s, `topic:${topicId}`)).toEqual({ ok: true });

    const seen = next<{ userId: string; name: string }>(bogdan, "typing");
    ana.emit("typing", topicId);
    expect(await seen).toMatchObject({ topicId, userId: users.Ana, name: "Ana" });

    const fromGuest = next(bogdan, "typing");
    anon.emit("typing", topicId);
    expect(await fromGuest).toBeNull();
  });

  test("prezența: conectarea și ping-ul notează userul; cititorii topicului", async () => {
    const ana = await member("Ana");
    await join(ana, `topic:${topicId}`);
    ana.emit("presence:ping");
    await new Promise((r) => setTimeout(r, 100));
    expect((await services.presence.online()).users).toContain(users.Ana);
    expect((await services.presence.topicReaders(topicId)).users).toEqual([users.Ana]);
  });

  test("heartbeat-ul marchează realtime-ul pornit", async () => {
    await services.redis.flushdb();
    const second = createRealtimeServer({ services, secret: SECRET, corsOrigin: true });
    await second.listen(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(await serviceStatus(services.redis, "realtime")).toMatchObject({ up: true });
    await second.close();
  });

  test("o cameră de chat privată: un străin nu intră; membrii intră și primesc lista celor online", async () => {
    const root = await services.actors.forUser(users.Root!, "127.0.0.1");
    const room = await services.chat.createRoom(root, { name: "Privat", type: "PRIVATE", invite: [users.Ana!] });
    const ana = await member("Ana");
    const bogdan = await member("Bogdan");
    expect(await join(bogdan, `chat:${room.key}`)).toEqual({ ok: false });
    const readers = next<{ channel: string; users: { name: string }[] }>(ana, "readers", 3000);
    expect(await join(ana, `chat:${room.key}`)).toEqual({ ok: true });
    const list = await readers;
    expect(list?.channel).toBe(room.key);
    expect(list?.users.map((u) => u.name)).toEqual(["Ana"]);
  });
});
