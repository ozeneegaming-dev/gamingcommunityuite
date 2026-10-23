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
    { key: "pm.message", labelKey: "n.pm", important: true, defaultEmail: "INSTANT", countEach: true },
    { key: "forums.mention", labelKey: "n.mention", important: false, defaultEmail: "DIGEST", mention: true },
  ],
};

let w: GcsTestWorld;
let svc: GcsNotificationService;
let hidden: Set<string>;
let created: GcsEvent[];
let settings: Record<string, unknown>;

beforeEach(async () => {
  w = await createWorld([notifModule]);
  settings = {};
  svc = new GcsNotificationService({
    db: w.db,
    bus: w.bus,
    cache: w.cache,
    registry: w.registry,
    settings: {
      get: async <T,>(key: string) => {
        if (!(key in settings)) throw new Error("unknown");
        return settings[key] as T;
      },
    },
  });
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
  w.kv.disconnect();
});

const reply = (userIds: string[], actorId: string | null, targetId = "1", extra: { important?: boolean } = {}) =>
  svc.notify({ userIds, type: "forums.reply", targetType: "post", targetId, actorId, ...extra });

describe("GcsNotificationService — crearea și gruparea", () => {
  test("3 reacții de la actori diferiți pe aceeași postare → o notificare cu count 3 și ultimii actori", async () => {
    const owner = await w.createUser("Owner", "member");
    const [a, b, c] = await Promise.all(["A1", "B1", "C1"].map((n) => w.createUser(n, "member")));
    for (const actor of [a!, b!, c!]) await svc.notify({ userIds: [owner.id], type: "forums.reaction", targetType: "post", targetId: "7", actorId: actor.id });
    // Același actor din nou: nu crește numărul, dar urcă în fața listei.
    await svc.notify({ userIds: [owner.id], type: "forums.reaction", targetType: "post", targetId: "7", actorId: a!.id });

    const list = await svc.list(owner.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: "forums.reaction", count: 3, actorIds: [a!.id, c!.id, b!.id], read: false, site: true, important: false });
    expect(list[0]!.data).toMatchObject({ title: "Topic 7", href: "/topic/7" });
    expect(created).toHaveLength(4);
    expect(created[0]!.payload).toMatchObject({ userId: owner.id, inserted: true, important: false, site: true, toast: true, push: false, emailMode: null, email: "OFF" });
    expect(created[1]!.payload).toMatchObject({ inserted: false });
  });

  test("countEach: fiecare mesaj crește numărul, chiar de la același actor; tipul important trece pe push", async () => {
    const owner = await w.createUser("Owner", "member");
    const a = await w.createUser("A1", "member");
    for (let i = 0; i < 3; i++) await svc.notify({ userIds: [owner.id], type: "pm.message", targetType: "post", targetId: "9", actorId: a.id });
    expect(await svc.list(owner.id)).toMatchObject([{ type: "pm.message", count: 3, actorIds: [a.id], important: true }]);
    expect(created[0]!.payload).toMatchObject({ push: true, emailMode: "instant", email: "INSTANT" });
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

  test("fără auto-notificare, fără notificări de la ignorați, fără ținte invizibile, fără tipuri oprite pe toate canalele", async () => {
    const actor = await w.createUser("Actor", "member");
    const ignorer = await w.createUser("Ignorer", "member");
    const blind = await w.createUser("Blind", "member");
    const off = await w.createUser("Off", "member");
    const ok = await w.createUser("Ok", "member");
    await w.db.userIgnore.create({ data: { userId: ignorer.id, ignoredId: actor.id } });
    hidden.add(blind.id);
    await svc.setPreferences(off.id, { "forums.reply": { site: "off", toast: "off", email: "off", push: "off" } });

    const ids = await reply([actor.id, ignorer.id, blind.id, off.id, ok.id, ok.id], actor.id);
    expect(ids).toHaveLength(1);
    expect(await w.db.notification.findMany({ select: { userId: true } })).toEqual([{ userId: ok.id }]);
  });

  test("tip sau țintă necunoscute nu creează nimic", async () => {
    const u = await w.createUser("U1", "member");
    expect(await svc.notify({ userIds: [u.id], type: "nope", targetType: "post", targetId: "1", actorId: null })).toEqual([]);
    expect(await svc.notify({ userIds: [u.id], type: "forums.reply", targetType: "nope", targetId: "1", actorId: null })).toEqual([]);
  });
});

describe("GcsNotificationService — canalele: valori implicite, blocări, alegerile membrului", () => {
  test("site oprit, email pornit: notificarea e creată doar pentru email (citită, fără clopoțel, fără număr)", async () => {
    const u = await w.createUser("U1", "member");
    const a = await w.createUser("A1", "member");
    await svc.setPreferences(u.id, { "forums.reply": { site: "off", toast: "off", push: "off" } });
    const [id] = await reply([u.id], a.id);
    expect(await svc.list(u.id)).toEqual([]);
    expect(await svc.unreadCount(u.id)).toBe(0);
    const row = await w.db.notification.findUniqueOrThrow({ where: { id: id! } });
    expect(row).toMatchObject({ site: false, emailedAt: null, channels: { toast: false, push: false, email: "daily" } });
    expect(row.readAt).not.toBeNull();
    expect(await svc.get(u.id, id!)).toMatchObject({ site: false });
    expect(created[0]!.payload).toMatchObject({ site: false, toast: false, emailMode: "daily" });
  });

  test("„doar important”: o notificare obișnuită nu trece, una marcată importantă trece", async () => {
    const u = await w.createUser("U1", "member");
    const a = await w.createUser("A1", "member");
    await svc.setPreferences(u.id, { "forums.reply": { site: "important", toast: "important", email: "off", push: "off" } });
    expect(await reply([u.id], a.id, "1")).toEqual([]);
    expect(await reply([u.id], a.id, "2", { important: true })).toHaveLength(1);
    expect(await svc.list(u.id)).toMatchObject([{ important: true, data: { title: "Topic 2" } }]);
  });

  test("emailul oprit: notificarea e marcată trimisă (nu intră în digesturi)", async () => {
    const u = await w.createUser("U1", "member");
    const a = await w.createUser("A1", "member");
    await svc.setPreferences(u.id, { "forums.reply": { email: "off" } });
    const [id] = await reply([u.id], a.id);
    expect((await w.db.notification.findUniqueOrThrow({ where: { id: id! } })).emailedAt).not.toBeNull();
  });

  test("ACP: valorile implicite noi ajung la membrii fără alegeri; o blocare bate alegerea membrului", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const u = await w.createUser("U1", "member");
    const a = await w.createUser("A1", "member");
    expect((await svc.preferences(u.id))["forums.reply"]!.effective).toEqual({ site: "on", toast: "on", email: "on", push: "important", emailMode: "daily" });

    await svc.setPreferences(u.id, { "forums.reply": { site: "on", toast: "on", email: "on", push: "on", emailMode: "daily" } });
    await svc.setDefaults(root, { "forums.reply": { channels: { toast: "off", emailMode: "instant" }, locks: { site: "disabled" } } });
    const prefs = (await svc.preferences(u.id))["forums.reply"]!;
    expect(prefs.override).toEqual({ push: "on" });
    expect(prefs.defaults.locks).toEqual({ site: "disabled" });
    expect(prefs.effective).toEqual({ site: "off", toast: "off", email: "on", push: "on", emailMode: "instant" });
    expect(await w.db.auditLog.count({ where: { action: "notifications.defaults" } })).toBe(1);
    await expect(svc.setDefaults(root, { nope: { channels: {} } })).rejects.toThrow();

    // Membrul nu poate porni un canal blocat: alegerea lui nu se salvează.
    await svc.setPreferences(u.id, { "forums.reply": { site: "on", toast: "on" } });
    expect((await svc.preferences(u.id))["forums.reply"]!.override).toEqual({ toast: "on" });
    const [id] = await reply([u.id], a.id);
    expect(await w.db.notification.findUniqueOrThrow({ where: { id: id! } })).toMatchObject({ site: false, channels: { toast: true, push: false, email: "instant" } });
  });

  test("forțat: membrul nu-l poate opri; „Oprește toate emailurile” oprește și emailul forțat", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const u = await w.createUser("U1", "member");
    const a = await w.createUser("A1", "member");
    await svc.setDefaults(root, { "forums.reply": { locks: { email: "forced" } } });
    await svc.setPreferences(u.id, { "forums.reply": { email: "off" } });
    expect((await svc.preferences(u.id))["forums.reply"]!.effective.email).toBe("on");
    await reply([u.id], a.id, "1");
    expect(created.at(-1)!.payload).toMatchObject({ emailMode: "daily" });

    await svc.setEmailsOff(root, u.id, true);
    expect(await svc.emailsOff(u.id)).toBe(true);
    await reply([u.id], a.id, "2");
    expect(created.at(-1)!.payload).toMatchObject({ emailMode: null, site: true });
    expect(await svc.deliveryFor(u.id, "forums.reply", false)).toMatchObject({ email: null });
    await svc.setEmailsOff(root, u.id, false);
    expect(await svc.deliveryFor(u.id, "forums.reply", false)).toMatchObject({ email: "daily" });
    expect(await w.db.auditLog.count({ where: { action: { in: ["notifications.emails_off", "notifications.emails_on"] } } })).toBe(2);
  });

  test("„Resetează la implicit”: membrul își pierde alegerile; ACP-ul resetează toți membrii și valorile implicite", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const [u, v] = await Promise.all([w.createUser("U1", "member"), w.createUser("V1", "member")]);
    for (const x of [u, v]) await svc.setPreferences(x.id, { "forums.reply": { site: "off" }, "pm.message": { push: "off" } });
    expect(await svc.resetPreferences(u.id)).toBe(2);
    expect((await svc.preferences(u.id))["forums.reply"]!.override).toEqual({});
    expect((await svc.preferences(v.id))["forums.reply"]!.override).toEqual({ site: "off" });

    expect(await svc.resetAllPreferences(root)).toBe(2);
    expect(await w.db.notificationPreference.count()).toBe(0);
    await svc.setDefaults(root, { "pm.message": { channels: { push: "off" }, locks: { site: "forced" } } });
    await svc.resetDefaults(root);
    expect((await svc.defaults())["pm.message"]).toMatchObject({ push: "important", locks: {} });
    expect(await w.db.auditLog.count({ where: { action: { in: ["notifications.reset_all", "notifications.defaults_reset"] } } })).toBe(2);
  });
});

describe("GcsNotificationService — lista, taburile, citirea, ștergerea", () => {
  test("unreadCount e în cache și se actualizează la notificare și la markRead", async () => {
    const u = await w.createUser("U1", "member");
    const a = await w.createUser("A1", "member");
    expect(await svc.unreadCount(u.id)).toBe(0);
    expect(await svc.unreadCount(null)).toBe(0);
    await reply([u.id], a.id);
    await svc.notify({ userIds: [u.id], type: "pm.message", targetType: "post", targetId: "2", actorId: a.id });
    expect(await svc.unreadCount(u.id)).toBe(2);

    const [first] = await svc.list(u.id);
    expect(await svc.markRead(u.id, [first!.id])).toBe(1);
    const other = await w.createUser("Other", "member");
    await reply([other.id], a.id);
    const [theirs] = await svc.list(other.id);
    await svc.markRead(u.id, [theirs!.id]);
    expect(await svc.unreadCount(other.id)).toBe(1);

    expect(await svc.markRead(u.id, "all")).toBe(0);
    expect(await svc.list(u.id, { unreadOnly: true })).toEqual([]);
  });

  test("filtrele (citite / necitite, tipurile unui tab), marchează toate din tab, necitită din nou, ștergerea", async () => {
    const u = await w.createUser("U1", "member");
    const a = await w.createUser("A1", "member");
    await reply([u.id], a.id, "1");
    await svc.notify({ userIds: [u.id], type: "forums.mention", targetType: "post", targetId: "2", actorId: a.id });
    await svc.notify({ userIds: [u.id], type: "forums.mention", targetType: "post", targetId: "3", actorId: a.id });
    expect(await svc.unreadByType(u.id)).toEqual({ "forums.reply": 1, "forums.mention": 2 });

    expect(await svc.markRead(u.id, "all", { types: ["forums.mention"] })).toBe(1);
    expect((await svc.list(u.id, { unreadOnly: true })).map((n) => n.type)).toEqual(["forums.reply"]);
    expect((await svc.list(u.id, { readOnly: true })).map((n) => n.type)).toEqual(["forums.mention", "forums.mention"]);
    expect((await svc.list(u.id, { types: ["forums.mention"] })).length).toBe(2);

    const [m] = await svc.list(u.id, { readOnly: true });
    expect(await svc.markUnread(u.id, m!.id)).toBe(2);
    expect(await svc.remove(u.id, "read")).toBe(2);
    expect(await w.db.notification.count({ where: { userId: u.id } })).toBe(2);
    expect(await svc.remove(u.id, [m!.id])).toBe(1);
    expect(await svc.remove(u.id, "all")).toBe(0);
    expect(await w.db.notification.count({ where: { userId: u.id } })).toBe(0);
  });

  test("necitită din nou nu dublează un grup necitit", async () => {
    const u = await w.createUser("U1", "member");
    const a = await w.createUser("A1", "member");
    await reply([u.id], a.id);
    await svc.markRead(u.id, "all");
    await reply([u.id], a.id);
    const read = (await svc.list(u.id, { readOnly: true }))[0]!;
    expect(await svc.markUnread(u.id, read.id)).toBe(1);
    expect((await svc.get(u.id, read.id))!.read).toBe(true);
  });
});

describe("GcsNotificationService — statisticile și curățenia", () => {
  test("trimise pe canal (site, toast) și deschise o singură dată pe notificare, pe canalul click-ului", async () => {
    const u = await w.createUser("U1", "member");
    const a = await w.createUser("A1", "member");
    const [id] = await reply([u.id], a.id);
    await svc.recordSent("forums.reply", "email", 2);
    expect(await svc.recordClick(u.id, id!, "email")).toBe(true);
    expect(await svc.recordClick(u.id, id!, "site")).toBe(false);
    const other = await w.createUser("Other", "member");
    expect(await svc.recordClick(other.id, id!, "site")).toBe(false);
    const stats = await svc.stats(30);
    expect(stats.channels).toEqual([
      { channel: "site", sent: 1, clicked: 0 },
      { channel: "toast", sent: 1, clicked: 0 },
      { channel: "email", sent: 2, clicked: 1 },
      { channel: "push", sent: 0, clicked: 0 },
    ]);
    expect(stats.types).toEqual([{ type: "forums.reply", sent: 4, clicked: 1 }]);
  });

  test("prune: citite mai vechi de N zile (setarea, implicit 90); cu „și necitite”, și pe cele vechi necitite", async () => {
    const u = await w.createUser("U1", "member");
    const base = { userId: u.id, type: "forums.reply", targetType: "post", actorIds: [], data: {} };
    const now = new Date("2026-10-06T00:00:00Z");
    await w.db.notification.createMany({
      data: [
        { ...base, targetId: "1", groupKey: "g1", readAt: new Date("2026-01-01T00:00:00Z") },
        { ...base, targetId: "2", groupKey: "g2", readAt: new Date("2026-09-20T00:00:00Z") },
        { ...base, targetId: "3", groupKey: "g3", updatedAt: new Date("2026-01-01T00:00:00Z") },
        { ...base, targetId: "4", groupKey: "g4" },
      ],
    });
    await w.db.notificationStat.create({ data: { day: new Date("2025-01-01T00:00:00Z"), type: "forums.reply", channel: "site", sent: 3 } });
    expect(await svc.prune(now)).toBe(1);
    expect(await w.db.notificationStat.count()).toBe(0);
    settings["notifications.prune_days"] = 10;
    expect(await svc.prune(now)).toBe(1);
    settings["notifications.prune_unread"] = true;
    expect(await svc.cleanup(now)).toBe(1);
    expect((await w.db.notification.findMany({ select: { targetId: true } })).map((r) => r.targetId)).toEqual(["4"]);
  });
});
