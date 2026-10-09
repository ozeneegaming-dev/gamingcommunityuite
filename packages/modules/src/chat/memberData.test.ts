import type { GcsActor } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";

let w: GcsRemovalWorld;
let root: GcsActor;
let channelId: number;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  root = await w.user("Fondator", "root_admin");
  channelId = (await w.s.db.chatChannel.create({ data: { key: "test", name: "Test" } })).id;
});

const message = (authorId: string, body = "salut") => w.s.db.chatMessage.create({ data: { channelId, authorId, body } });

describe("chat-ul la ștergerea unui cont", () => {
  test("„Păstrează conținutul”: mesajele rămân fără autor; camera lui rămâne fără proprietar", async () => {
    const leaving = await w.user("Pleaca");
    await message(leaving.userId!);
    const room = await w.s.db.chatChannel.create({ data: { key: "camera", name: "Camera", type: "PRIVATE", ownerId: leaving.userId } });
    await w.s.memberRemoval.requestDelete(root, leaving.userId!, { mode: "KEEP_CONTENT", keepMessages: false });
    expect(await w.s.db.chatMessage.findMany({ select: { authorId: true } })).toEqual([{ authorId: null }]);
    expect(await w.s.db.chatChannel.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({ ownerId: null });
  });

  test("„Șterge și conținutul”: mesajele se șterg, cu fișierele lor", async () => {
    const leaving = await w.user("Pleaca");
    const other = await w.user("Altul");
    const m = await message(leaving.userId!);
    await message(other.userId!);
    await w.s.db.attachment.create({ data: { ownerId: leaving.userId, storageKey: "voce.webm", filename: "voce.webm", mime: "audio/webm", size: 1, contentType: "chat.message", contentId: String(m.id) } });
    await w.s.memberRemoval.requestDelete(root, leaving.userId!, { mode: "DELETE_CONTENT", keepMessages: false });
    expect(await w.s.db.chatMessage.findMany({ select: { authorId: true } })).toEqual([{ authorId: other.userId }]);
    expect(await w.s.db.attachment.count()).toBe(0);
  });
});

describe("chat-ul la unirea conturilor", () => {
  test("mesajele, reacțiile și camerele trec la țintă, fără dubluri", async () => {
    const source = await w.user("Dublura");
    const target = await w.user("Principal");
    const other = await w.user("Altul");
    const m = await message(other.userId!);
    const reaction = await w.s.db.reaction.findFirstOrThrow();
    await w.s.db.chatMessageReaction.createMany({ data: [{ messageId: m.id, userId: source.userId!, reactionId: reaction.id }, { messageId: m.id, userId: target.userId!, reactionId: reaction.id }] });
    await message(source.userId!);
    const room = await w.s.db.chatChannel.create({ data: { key: "camera", name: "Camera", type: "PRIVATE", ownerId: source.userId, members: { create: [{ userId: source.userId! }, { userId: target.userId! }] } } });
    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);
    expect(await w.s.db.chatMessage.count({ where: { authorId: target.userId } })).toBe(1);
    expect(await w.s.db.chatMessageReaction.findMany({ select: { userId: true } })).toEqual([{ userId: target.userId }]);
    expect(await w.s.db.chatChannel.findUniqueOrThrow({ where: { id: room.id }, include: { members: true } })).toMatchObject({ ownerId: target.userId, members: [expect.objectContaining({ userId: target.userId })] });
  });
});
