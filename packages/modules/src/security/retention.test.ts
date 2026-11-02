import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { GcsRetentionService, RETENTION_BATCH } from "./retention";

const db = testDb();
let values: Record<string, number> = {};
const settings = { get: async <T,>(key: string): Promise<T> => (values[key] ?? 0) as T };
const retention = new GcsRetentionService({ db, settings });

const NOW = new Date("2026-11-02T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

beforeEach(async () => {
  await truncateAll(db);
  values = {};
});

afterAll(async () => {
  await db.$disconnect();
});

async function member(name: string) {
  const group = (await db.group.findFirst({ where: { key: "member" } })) ?? (await db.group.create({ data: { key: "member", name: "Membru" } }));
  return db.user.create({ data: { name, nameNormalized: name.toLowerCase(), email: `${name.toLowerCase()}@example.com`, primaryGroupId: group.id } });
}

describe("GcsRetentionService", () => {
  test("0 zile peste tot = nu se șterge nimic", async () => {
    await db.auditLog.create({ data: { action: "settings.update", targetType: "setting", targetId: "x", createdAt: daysAgo(4000) } });
    await db.spamLog.create({ data: { kind: "captcha", createdAt: daysAgo(4000) } });
    expect(await retention.run(NOW)).toEqual({ audit_days: 0, login_days: 0, spam_log_days: 0, plugin_log_days: 0, sessions_days: 0 });
    expect(await db.auditLog.count()).toBe(1);
    expect(await db.spamLog.count()).toBe(1);
  });

  test("jurnalul ACP: doar intrările mai vechi; cele de autentificare urmează perioada lor", async () => {
    values = { "retention.audit_days": 30 };
    await db.auditLog.createMany({
      data: [
        { action: "settings.update", targetType: "setting", targetId: "old", createdAt: daysAgo(31) },
        { action: "settings.update", targetType: "setting", targetId: "new", createdAt: daysAgo(29) },
        { action: "acp.login", targetType: "user", targetId: "u", createdAt: daysAgo(400) },
      ],
    });
    expect((await retention.run(NOW)).audit_days).toBe(1);
    expect((await db.auditLog.findMany({ orderBy: { targetId: "asc" } })).map((r) => r.targetId)).toEqual(["new", "u"]);

    values = { "retention.login_days": 90 };
    expect((await retention.run(NOW)).login_days).toBe(1);
    expect(await db.auditLog.count({ where: { action: "acp.login" } })).toBe(0);
  });

  test("autentificările: dispozitivele nevăzute de N zile", async () => {
    values = { "retention.login_days": 60 };
    const u = await member("Mara");
    await db.userDevice.createMany({
      data: [
        { userId: u.id, key: "old", browser: "Chrome", os: "Windows", method: "password", ip: "203.0.113.1", lastSeenAt: daysAgo(61) },
        { userId: u.id, key: "new", browser: "Firefox", os: "Linux", method: "password", ip: "203.0.113.2", lastSeenAt: daysAgo(1) },
      ],
    });
    expect((await retention.run(NOW)).login_days).toBe(1);
    expect((await db.userDevice.findMany()).map((d) => d.key)).toEqual(["new"]);
  });

  test("jurnalul anti-spam și jurnalul pluginurilor", async () => {
    values = { "retention.spam_log_days": 7, "retention.plugin_log_days": 14 };
    await db.spamLog.createMany({ data: [{ kind: "captcha", createdAt: daysAgo(8) }, { kind: "captcha", createdAt: daysAgo(6) }] });
    await db.plugin.create({ data: { key: "demo", name: "Demo", version: "1.0.0", manifest: {} } });
    await db.pluginLog.createMany({
      data: [
        { pluginKey: "demo", level: "error", message: "vechi", createdAt: daysAgo(15) },
        { pluginKey: "demo", level: "info", message: "nou", createdAt: daysAgo(13) },
      ],
    });
    const result = await retention.run(NOW);
    expect(result).toMatchObject({ spam_log_days: 1, plugin_log_days: 1 });
    expect((await db.pluginLog.findMany()).map((l) => l.message)).toEqual(["nou"]);
  });

  test("sesiunile și tokenurile expirate de N zile; cele active rămân", async () => {
    values = { "retention.sessions_days": 30 };
    const u = await member("Ana");
    await db.session.createMany({
      data: [
        { userId: u.id, token: "expired-long-ago", expiresAt: daysAgo(31) },
        { userId: u.id, token: "expired-recently", expiresAt: daysAgo(2) },
        { userId: u.id, token: "active", expiresAt: new Date(NOW.getTime() + 86_400_000) },
      ],
    });
    await db.verification.createMany({
      data: [
        { identifier: "old", value: "x", expiresAt: daysAgo(40) },
        { identifier: "fresh", value: "y", expiresAt: daysAgo(1) },
      ],
    });
    expect((await retention.run(NOW)).sessions_days).toBe(2);
    expect((await db.session.findMany({ orderBy: { token: "asc" } })).map((s) => s.token)).toEqual(["active", "expired-recently"]);
    expect((await db.verification.findMany()).map((v) => v.identifier)).toEqual(["fresh"]);
  });

  test("șterge pe loturi: mai multe rânduri decât un lot", async () => {
    values = { "retention.spam_log_days": 1 };
    await db.spamLog.createMany({ data: Array.from({ length: RETENTION_BATCH + 5 }, () => ({ kind: "captcha", createdAt: daysAgo(3) })) });
    expect((await retention.run(NOW)).spam_log_days).toBe(RETENTION_BATCH + 5);
    expect(await db.spamLog.count()).toBe(0);
  });
});
