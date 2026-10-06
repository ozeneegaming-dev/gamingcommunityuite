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

describe("schema etapa 5", () => {
  test("permisiunile individuale: una pe (user, cheie), șterse odată cu userul", async () => {
    const u = await user();
    await db.userPermission.create({ data: { userId: u.id, key: "chat.create_private", value: true } });
    await expect(db.userPermission.create({ data: { userId: u.id, key: "chat.create_private", value: false } })).rejects.toThrow();
    await db.user.delete({ where: { id: u.id } });
    expect(await db.userPermission.count()).toBe(0);
  });

  test("camerele private: membri unici, reacții unice pe (mesaj, user, reacție), totul șters cu camera", async () => {
    const owner = await user("Owner");
    const guest = await user("Guest");
    const room = await db.chatChannel.create({ data: { key: "privat-1", name: "Privat", type: "PRIVATE", ownerId: owner.id } });
    expect(room.type).toBe("PRIVATE");
    await db.chatRoomMember.create({ data: { channelId: room.id, userId: guest.id, invitedById: owner.id } });
    await expect(db.chatRoomMember.create({ data: { channelId: room.id, userId: guest.id } })).rejects.toThrow();
    const msg = await db.chatMessage.create({ data: { channelId: room.id, authorId: owner.id, body: "salut" } });
    await db.chatMessageReaction.create({ data: { messageId: msg.id, userId: guest.id, reactionId: 1 } });
    await expect(db.chatMessageReaction.create({ data: { messageId: msg.id, userId: guest.id, reactionId: 1 } })).rejects.toThrow();
    await db.chatMessageReaction.create({ data: { messageId: msg.id, userId: guest.id, reactionId: 2 } });

    await db.chatChannel.delete({ where: { id: room.id } });
    expect(await db.chatRoomMember.count()).toBe(0);
    expect(await db.chatMessageReaction.count()).toBe(0);
  });

  test("ștergerea proprietarului lasă camera fără proprietar", async () => {
    const owner = await user("Owner");
    const room = await db.chatChannel.create({ data: { key: "privat-2", name: "Privat", type: "PRIVATE", ownerId: owner.id } });
    await db.user.delete({ where: { id: owner.id } });
    expect((await db.chatChannel.findUniqueOrThrow({ where: { id: room.id } })).ownerId).toBeNull();
  });

  test("meniul: copiii se șterg cu părintele; temele au cheie unică; valorile implicite noi", async () => {
    const parent = await db.navItem.create({ data: { label: { key: "nav.community" }, groups: [] } });
    await db.navItem.create({ data: { parentId: parent.id, label: { ro: "Reguli", en: "Rules" }, href: "/rules", groups: [1, 2] } });
    await db.navItem.delete({ where: { id: parent.id } });
    expect(await db.navItem.count()).toBe(0);

    await db.theme.create({ data: { key: "default", name: "Implicită", isDefault: true } });
    await expect(db.theme.create({ data: { key: "default", name: "Alta" } })).rejects.toThrow();

    const u = await user();
    expect(u).toMatchObject({ prefs: {}, signatureHtml: "", customTitle: null });
    const group = await db.group.findUniqueOrThrow({ where: { id: u.primaryGroupId } });
    expect(group.inLegend).toBe(true);
  });
});
