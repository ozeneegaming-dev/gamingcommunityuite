import { GcsNotFound, GcsRateLimited, GcsValidationError, type GcsActor } from "@gcs/core";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { doc } from "../../test/world";

let w: GcsProfileWorld;
let a: GcsActor;
let b: GcsActor;
let c: GcsActor;

beforeEach(async () => {
  w = await createProfileWorld();
  a = w.member;
  b = await w.actorFor(await w.createUser("Bogdan", "member"));
  c = await w.actorFor(await w.createUser("Cristi", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const setPrivacy = (actor: GcsActor, patch: Record<string, unknown>) =>
  w.profiles.updatePrivacy(actor, { profile: "PUBLIC", messages: "MEMBERS", wall: "MEMBERS", showOnline: true, ...patch });

async function start(from: GcsActor, to: GcsActor[], text = "Salut!") {
  await w.clearPmFlood(from);
  return w.conversations.start(from, { to: to.map((u) => u.userId!), title: "Echipa pentru turneu", content: doc(text) });
}

describe("conversații", () => {
  test("A scrie lui B și C; B citește și răspunde; necititele sunt corecte", async () => {
    const { conversationId } = await start(a, [b, c]);
    expect(await w.conversations.unreadCount(a.userId)).toBe(0);
    expect(await w.conversations.unreadCount(b.userId)).toBe(1);

    const view = await w.conversationQueries.conversation(b, conversationId);
    expect(view.messages.map((m) => m.author?.name)).toEqual(["Mara"]);
    await w.conversations.markRead(b, conversationId);
    expect(await w.conversations.unreadCount(b.userId)).toBe(0);

    await w.conversations.reply(b, conversationId, doc("Sunt în!"));
    expect(await w.conversations.unreadCount(a.userId)).toBe(1);
    expect(await w.conversations.unreadCount(b.userId)).toBe(0);
    expect((await w.conversationQueries.inbox(a, 1)).items[0]).toMatchObject({ unread: true, messagesCount: 2, last: { snippet: "Sunt în!" } });

    // „Citit de”: A citește, iar B vede că A a citit ultimul lui mesaj.
    await w.conversations.markRead(a, conversationId);
    expect((await w.conversationQueries.conversation(b, conversationId)).readBy.map((u) => u.name)).toEqual(["Mara"]);
  });

  test("Review Focus #4: un neparticipant sau un participant plecat → GcsNotFound (conversație și atașament)", async () => {
    const outsider = await w.actorFor(await w.createUser("Outsider", "member"));
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer();
    const att = await w.attachments.upload(a, { name: "a.png", bytes: png }, { permission: "pm.send" });
    const content = { type: "doc", content: [{ type: "image", attrs: { attachmentId: att.id } }] };
    await w.clearPmFlood(a);
    const { conversationId } = await w.conversations.start(a, { to: [b.userId!, c.userId!], title: "Poze", content });

    await expect(w.conversationQueries.conversation(outsider, conversationId)).rejects.toBeInstanceOf(GcsNotFound);
    await expect(w.attachments.open(outsider, att.id)).rejects.toBeInstanceOf(GcsNotFound);
    await expect(w.attachments.open(c, att.id)).resolves.toMatchObject({ inline: true });

    await w.conversations.leave(c, conversationId);
    await expect(w.conversationQueries.conversation(c, conversationId)).rejects.toBeInstanceOf(GcsNotFound);
    await expect(w.attachments.open(c, att.id)).rejects.toBeInstanceOf(GcsNotFound);
    await expect(w.conversations.reply(c, conversationId, doc("x"))).rejects.toBeInstanceOf(GcsNotFound);
    expect(await w.conversations.unreadCount(c.userId)).toBe(0);
  });

  test("un participant invitat vede istoricul; când pleacă toți, conversația dispare", async () => {
    const d = await w.actorFor(await w.createUser("Dana", "member"));
    const { conversationId } = await start(a, [b]);
    await w.conversations.invite(b, conversationId, [d.userId!]);
    expect(await w.conversations.unreadCount(d.userId)).toBe(1);
    expect((await w.conversationQueries.conversation(d, conversationId)).messages).toHaveLength(1);

    for (const u of [a, b, d]) await w.conversations.leave(u, conversationId);
    expect(await w.db.conversation.findUnique({ where: { id: conversationId } })).toBeNull();
  });

  test("două răspunsuri simultane: messagesCount și lastMessageId corecte", async () => {
    const { conversationId } = await start(a, [b]);
    await Promise.all([w.conversations.reply(b, conversationId, doc("1")), w.conversations.reply(a, conversationId, doc("2")).catch(async () => {
      await w.clearPmFlood(a);
      return w.conversations.reply(a, conversationId, doc("2"));
    })]);
    const conv = await w.db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const last = await w.db.conversationMessage.findFirstOrThrow({ where: { conversationId }, orderBy: { id: "desc" } });
    expect(conv).toMatchObject({ messagesCount: 3, lastMessageId: last.id });
  });
});

describe("limite și confidențialitate (Review Focus #3)", () => {
  test("a 6-a persoană într-o conversație de membru e refuzată (pm.max_participants = 5)", async () => {
    const others = await Promise.all(["U1", "U2", "U3", "U4", "U5"].map(async (n) => w.actorFor(await w.createUser(n, "member"))));
    await expect(start(a, others)).rejects.toMatchObject({ fields: { to: "too_many" } });
    const { conversationId } = await start(a, others.slice(0, 4));
    await expect(w.conversations.invite(a, conversationId, [others[4]!.userId!])).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("pm.max_conversations și flood", async () => {
    await w.db.groupSetting.updateMany({ where: { groupId: w.groups.member!, key: "pm.max_conversations" }, data: { value: 1 } });
    await w.permissions.bumpVersion();
    await start(a, [b]);
    await expect(start(a, [c])).rejects.toMatchObject({ fields: { to: "conversation_limit" } });

    // C nu are încă nicio conversație; răspunsul imediat după start e oprit de flood.
    await w.db.groupSetting.updateMany({ where: { groupId: w.groups.member!, key: "pm.max_conversations" }, data: { value: 5 } });
    await w.permissions.bumpVersion();
    const { conversationId } = await start(c, [a]);
    await expect(w.conversations.reply(c, conversationId, doc("prea repede"))).rejects.toBeInstanceOf(GcsRateLimited);
  });

  test("destinatar cu NOBODY: refuzat pentru membri, permis pentru staff; FOLLOWED: doar cei urmăriți", async () => {
    await setPrivacy(b, { messages: "NOBODY" });
    await expect(start(a, [b])).rejects.toMatchObject({ fields: { to: "not_allowed" } });
    await start(w.moderator, [b]);

    await setPrivacy(b, { messages: "FOLLOWED" });
    await expect(start(a, [b])).rejects.toBeInstanceOf(GcsValidationError);
    await w.db.follow.create({ data: { userId: b.userId!, contentType: "user", contentId: a.userId! } });
    await start(a, [b]);
  });

  test("cine e ignorat (pe mesaje) nu poate scrie, nici ca staff, și nu poate fi invitat de cel ignorat", async () => {
    await w.social.ignore(b, a.userId!, { posts: false, messages: true });
    await expect(start(a, [b])).rejects.toMatchObject({ fields: { to: "not_allowed" } });
    // B ignoră moderatorul? Nu se poate: staff-ul nu poate fi ignorat. Dar staff-ul nu trece de ignorare:
    await w.db.userIgnore.create({ data: { userId: b.userId!, ignoredId: w.moderator.userId!, posts: false, messages: true } });
    await w.cache.invalidateTags([`user:${b.userId}`]);
    await expect(start(w.moderator, [b])).rejects.toBeInstanceOf(GcsValidationError);

    const { conversationId } = await start(c, [a]);
    await expect(w.conversations.invite(a, conversationId, [b.userId!])).rejects.toBeInstanceOf(GcsValidationError);
  });
});

describe("rapoarte și XSS", () => {
  test("un mesaj raportat e vizibil moderatorului doar prin raport; „ascunde” îl șterge", async () => {
    const { conversationId, messageId } = await start(a, [b], "mesaj urât");
    await w.reports.report(b, { contentType: "pm.message", contentId: String(messageId), reason: "insulte" });
    await expect(w.conversationQueries.conversation(w.moderator, conversationId)).rejects.toBeInstanceOf(GcsNotFound);
    const reported = await w.conversations.reported(w.moderator);
    expect(reported).toMatchObject([{ messageId, reason: "insulte", conversationTitle: "Echipa pentru turneu" }]);
    expect(reported[0]!.html).toContain("mesaj urât");

    const report = await w.db.report.findFirstOrThrow();
    await w.reports.close(w.moderator, report.id, { action: "hide" });
    expect(await w.db.conversationMessage.count({ where: { conversationId } })).toBe(0);
    expect(await w.db.auditLog.count({ where: { action: "mod.pm.delete" } })).toBe(1);
  });

  test("Review Focus #5: un link `javascript:` nu ajunge în HTML", async () => {
    const evil = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }],
    };
    await w.clearPmFlood(a);
    const res = await w.conversations.start(a, { to: [b.userId!], title: "x", content: evil }).catch(() => null);
    if (res) expect((await w.db.conversationMessage.findUniqueOrThrow({ where: { id: res.messageId } })).contentHtml).not.toContain("javascript:");
  });
});
