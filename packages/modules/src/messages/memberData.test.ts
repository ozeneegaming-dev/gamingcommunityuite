import type { GcsActor } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { doc } from "../../test/world";

let w: GcsRemovalWorld;
let root: GcsActor;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  root = await w.user("Fondator", "root_admin");
});

/** O conversație între participanți, cu mesajele date (autor, în ordine), direct în bază. */
async function conversation(participants: string[], messages: string[]) {
  const c = await w.s.db.conversation.create({ data: { title: "Discuție", starterId: participants[0]!, participants: { create: participants.map((userId) => ({ userId })) } } });
  let last = 0;
  for (const authorId of messages) {
    last = (await w.s.db.conversationMessage.create({ data: { conversationId: c.id, authorId, contentJson: doc("m"), contentHtml: "<p>m</p>", ip: "198.51.100.8" } })).id;
  }
  await w.s.db.conversation.update({ where: { id: c.id }, data: { messagesCount: messages.length, lastMessageId: last || null } });
  return c.id;
}

describe("mesajele private la ștergerea unui cont", () => {
  test("implicit, mesajele lui se șterg (cu contoarele conversației); o conversație fără alt participant activ dispare", async () => {
    const leaving = await w.user("Pleaca");
    const other = await w.user("Altul");
    const shared = await conversation([leaving.userId!, other.userId!], [other.userId!, leaving.userId!]);
    const alone = await conversation([leaving.userId!, other.userId!], [leaving.userId!]);
    await w.s.db.conversationParticipant.update({ where: { conversationId_userId: { conversationId: alone, userId: other.userId! } }, data: { leftAt: new Date() } });
    await w.s.db.attachment.create({ data: { ownerId: leaving.userId, storageKey: "pm.png", filename: "pm.png", mime: "image/png", size: 1, contentType: "pm.message", contentId: String((await w.s.db.conversationMessage.findFirstOrThrow({ where: { conversationId: shared, authorId: leaving.userId } })).id) } });

    await w.s.memberRemoval.requestDelete(root, leaving.userId!, { mode: "KEEP_CONTENT", keepMessages: false });

    expect(await w.s.db.conversation.findUnique({ where: { id: alone } })).toBeNull();
    const c = await w.s.db.conversation.findUniqueOrThrow({ where: { id: shared }, include: { messages: true, participants: true } });
    expect(c.messages.map((m) => m.authorId)).toEqual([other.userId]);
    expect(c).toMatchObject({ messagesCount: 1, lastMessageId: c.messages[0]!.id, starterId: null });
    expect(c.participants.map((p) => p.userId)).toEqual([other.userId]);
    expect(await w.s.db.attachment.count()).toBe(0);
  });

  test("„Păstrează mesajele private”: rămân în conversațiile celorlalți, fără autor și fără IP", async () => {
    const leaving = await w.user("Pleaca");
    const other = await w.user("Altul");
    const shared = await conversation([leaving.userId!, other.userId!], [leaving.userId!]);
    await w.s.memberRemoval.requestDelete(root, leaving.userId!, { mode: "KEEP_CONTENT", keepMessages: true });
    const messages = await w.s.db.conversationMessage.findMany({ where: { conversationId: shared } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ authorId: null, ip: null });
  });
});

describe("mesajele private la unirea conturilor", () => {
  test("conversațiile sursei trec la țintă (un singur participant); mesajele au autorul ținta", async () => {
    const source = await w.user("Dublura");
    const target = await w.user("Principal");
    const other = await w.user("Altul");
    const both = await conversation([source.userId!, target.userId!, other.userId!], [source.userId!, target.userId!]);
    const only = await conversation([source.userId!, other.userId!], [other.userId!, source.userId!]);
    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);
    const parts = async (id: number) => (await w.s.db.conversationParticipant.findMany({ where: { conversationId: id } })).map((p) => p.userId).sort();
    expect(await parts(both)).toEqual([target.userId!, other.userId!].sort());
    expect(await parts(only)).toEqual([target.userId!, other.userId!].sort());
    expect(await w.s.db.conversationMessage.count({ where: { authorId: target.userId } })).toBe(3);
    expect(await w.s.db.conversation.findUniqueOrThrow({ where: { id: only } })).toMatchObject({ starterId: target.userId });
  });
});
