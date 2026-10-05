import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testDb, truncateAll } from "./helpers";

const db = testDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function user(name = "Mara") {
  const group = await db.group.create({ data: { key: `g_${name.toLowerCase()}`, name } });
  return db.user.create({ data: { name, nameNormalized: name.toLowerCase(), email: `${name.toLowerCase()}@example.com`, primaryGroupId: group.id } });
}

describe("schema etapa 4", () => {
  test("o singură notificare necitită pe (user, groupKey); după citire se poate crea alta", async () => {
    const u = await user();
    const base = { userId: u.id, type: "forums.reaction", targetType: "forums.post", targetId: "1", groupKey: "forums.reaction:forums.post:1", data: {} };
    const first = await db.notification.create({ data: base });
    await expect(db.notification.create({ data: base })).rejects.toThrow();
    await db.notification.update({ where: { id: first.id }, data: { readAt: new Date() } });
    await db.notification.create({ data: base });
    expect(await db.notification.count()).toBe(2);
  });

  test("preferințele sunt unice pe (user, tip), cu valorile implicite", async () => {
    const u = await user();
    const pref = await db.notificationPreference.create({ data: { userId: u.id, type: "forums.reply" } });
    expect(pref).toMatchObject({ site: true, email: "DIGEST" });
    await expect(db.notificationPreference.create({ data: { userId: u.id, type: "forums.reply" } })).rejects.toThrow();
  });

  test("ștergerea unui canal șterge mesajele; ștergerea userului păstrează mesajele fără autor", async () => {
    const u = await user();
    const channel = await db.chatChannel.create({ data: { key: "general", name: "General" } });
    expect(channel).toMatchObject({ retentionDays: 7, slowModeSeconds: 0, enabled: true });
    await db.chatMessage.create({ data: { channelId: channel.id, authorId: u.id, body: "salut" } });
    await db.user.delete({ where: { id: u.id } });
    expect(await db.chatMessage.findFirstOrThrow()).toMatchObject({ authorId: null });
    await db.chatChannel.delete({ where: { id: channel.id } });
    expect(await db.chatMessage.count()).toBe(0);
  });

  test("mute-urile: pe canal sau global (channelId null)", async () => {
    const u = await user();
    await db.chatMute.create({ data: { userId: u.id, channelId: null, until: null, reason: "spam" } });
    expect(await db.chatMute.count({ where: { userId: u.id, channelId: null } })).toBe(1);
  });
});
