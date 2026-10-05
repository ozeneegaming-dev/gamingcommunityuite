import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import type { GcsEvent } from "../events";
import type { GcsModule } from "../modules/registry";
import { GcsNotificationService } from "./service";

const notifModule: GcsModule = {
  key: "notiftest",
  settings: [],
  eventListeners: [],
  permissions: [],
  acpMenu: [],
  notificationTypes: [
    { key: "forums.reaction", labelKey: "n.reaction", important: false, defaultEmail: "OFF" },
    { key: "forums.reply", labelKey: "n.reply", important: false, defaultEmail: "DIGEST" },
    { key: "pm.message", labelKey: "n.pm", important: true, defaultEmail: "INSTANT" },
  ],
};

let w: GcsTestWorld;
let svc: GcsNotificationService;
let hidden: Set<string>;
let created: GcsEvent[];

beforeEach(async () => {
  w = await createWorld([notifModule]);
  svc = new GcsNotificationService({ db: w.db, bus: w.bus, cache: w.cache, registry: w.registry });
  hidden = new Set();
  svc.registerTarget("post", {
    canView: async (userId) => !hidden.has(userId),
    describe: async (id) => ({ title: `Topic ${id}`, href: `/topic/${id}`, snippet: "salut" }),
  });
  created = [];
  w.bus.on("notification.created", async (e) => {
    created.push(e);
  });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("GcsNotificationService", () => {
  test("seed-ul scrie valorile implicite ale tipurilor declarate de module", async () => {
    const rows = await w.db.notificationDefault.findMany({ orderBy: { type: "asc" } });
    expect(rows.map((r) => [r.type, r.email])).toEqual([
      ["forums.reaction", "OFF"],
      ["forums.reply", "DIGEST"],
      ["pm.message", "INSTANT"],
    ]);
  });

  test("3 reacții de la actori diferiți pe aceeași postare → o notificare cu count 3 și ultimii actori", async () => {
    const owner = await w.createUser("Owner", "member");
    const [a, b, c] = await Promise.all(["A1", "B1", "C1"].map((n) => w.createUser(n, "member")));
    for (const actor of [a!, b!, c!]) await svc.notify({ userIds: [owner.id], type: "forums.reaction", targetType: "post", targetId: "7", actorId: actor.id });
    // Același actor din nou: nu crește numărul, dar urcă în fața listei.
    await svc.notify({ userIds: [owner.id], type: "forums.reaction", targetType: "post", targetId: "7", actorId: a!.id });

    const list = await svc.list(owner.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: "forums.reaction", count: 3, actorIds: [a!.id, c!.id, b!.id], read: false });
    expect(list[0]!.data).toMatchObject({ title: "Topic 7", href: "/topic/7" });
    expect(created).toHaveLength(4);
    expect(created[0]!.payload).toMatchObject({ userId: owner.id, inserted: true, important: false, email: "OFF" });
    expect(created[1]!.payload).toMatchObject({ inserted: false });
  });

  test("după citire, o nouă reacție începe un grup nou", async () => {
    const owner = await w.createUser("Owner", "member");
    const a = await w.createUser("A1", "member");
    await svc.notify({ userIds: [owner.id], type: "forums.reaction", targetType: "post", targetId: "7", actorId: a.id });
    await svc.markRead(owner.id, "all");
    await svc.notify({ userIds: [owner.id], type: "forums.reaction", targetType: "post", targetId: "7", actorId: a.id });
    const list = await svc.list(owner.id);
    expect(list.map((n) => [n.count, n.read])).toEqual([
      [1, false],
      [1, true],
    ]);
  });

  test("fără auto-notificare, fără notificări de la ignorați, fără ținte invizibile, fără tipuri oprite pe site", async () => {
    const actor = await w.createUser("Actor", "member");
    const ignorer = await w.createUser("Ignorer", "member");
    const blind = await w.createUser("Blind", "member");
    const off = await w.createUser("Off", "member");
    const ok = await w.createUser("Ok", "member");
    await w.db.userIgnore.create({ data: { userId: ignorer.id, ignoredId: actor.id } });
    hidden.add(blind.id);
    await svc.setPreferences(off.id, { "forums.reply": { site: false, email: "OFF" } });

    const ids = await svc.notify({
      userIds: [actor.id, ignorer.id, blind.id, off.id, ok.id, ok.id],
      type: "forums.reply",
      targetType: "post",
      targetId: "1",
      actorId: actor.id,
    });
    expect(ids).toHaveLength(1);
    const owners = await w.db.notification.findMany({ select: { userId: true } });
    expect(owners).toEqual([{ userId: ok.id }]);
  });

  test("tip sau țintă necunoscute nu creează nimic", async () => {
    const u = await w.createUser("U1", "member");
    expect(await svc.notify({ userIds: [u.id], type: "nope", targetType: "post", targetId: "1", actorId: null })).toEqual([]);
    expect(await svc.notify({ userIds: [u.id], type: "forums.reply", targetType: "nope", targetId: "1", actorId: null })).toEqual([]);
  });

  test("unreadCount e în cache și se actualizează la notificare și la markRead", async () => {
    const u = await w.createUser("U1", "member");
    const a = await w.createUser("A1", "member");
    expect(await svc.unreadCount(u.id)).toBe(0);
    expect(await svc.unreadCount(null)).toBe(0);
    await svc.notify({ userIds: [u.id], type: "forums.reply", targetType: "post", targetId: "1", actorId: a.id });
    await svc.notify({ userIds: [u.id], type: "pm.message", targetType: "post", targetId: "2", actorId: a.id });
    expect(await svc.unreadCount(u.id)).toBe(2);

    const [first] = await svc.list(u.id);
    expect(await svc.markRead(u.id, [first!.id])).toBe(1);
    // Id-ul altui user nu se marchează.
    const other = await w.createUser("Other", "member");
    await svc.notify({ userIds: [other.id], type: "forums.reply", targetType: "post", targetId: "1", actorId: a.id });
    const [theirs] = await svc.list(other.id);
    await svc.markRead(u.id, [theirs!.id]);
    expect(await svc.unreadCount(other.id)).toBe(1);

    expect(await svc.markRead(u.id, "all")).toBe(0);
    expect(await svc.list(u.id, { unreadOnly: true })).toEqual([]);
  });

  test("preferințe: implicite din ACP, suprascrise de user; tipurile necunoscute se ignoră", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const u = await w.createUser("U1", "member");
    expect((await svc.preferences(u.id))["forums.reply"]).toEqual({ site: true, email: "DIGEST" });

    await svc.setDefaults(root, { "forums.reply": { site: true, email: "INSTANT" } });
    expect((await svc.preferences(u.id))["forums.reply"]).toEqual({ site: true, email: "INSTANT" });
    expect(await w.db.auditLog.count({ where: { action: "notifications.defaults" } })).toBe(1);
    await expect(svc.setDefaults(root, { nope: { site: true, email: "OFF" } })).rejects.toThrow();

    await svc.setPreferences(u.id, { "forums.reply": { site: true, email: "OFF" }, nope: { site: false, email: "OFF" } });
    const prefs = await svc.preferences(u.id);
    expect(prefs["forums.reply"]).toEqual({ site: true, email: "OFF" });
    expect(prefs.nope).toBeUndefined();
    expect(prefs["pm.message"]).toEqual({ site: true, email: "INSTANT" });
  });

  test("cleanup șterge doar notificările citite mai vechi de 90 de zile", async () => {
    const u = await w.createUser("U1", "member");
    const base = { userId: u.id, type: "forums.reply", targetType: "post", actorIds: [], data: {} };
    await w.db.notification.createMany({
      data: [
        { ...base, targetId: "1", groupKey: "g1", readAt: new Date("2026-01-01T00:00:00Z") },
        { ...base, targetId: "2", groupKey: "g2", readAt: new Date("2026-09-01T00:00:00Z") },
        { ...base, targetId: "3", groupKey: "g3" },
      ],
    });
    expect(await svc.cleanup(new Date("2026-10-06T00:00:00Z"))).toBe(1);
    expect(await w.db.notification.count()).toBe(2);
  });
});
