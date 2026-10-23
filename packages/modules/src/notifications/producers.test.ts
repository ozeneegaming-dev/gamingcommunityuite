import type { GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { doc } from "../../test/world";

let w: GcsProfileWorld;
let tree: Awaited<ReturnType<GcsProfileWorld["createTree"]>>;

beforeEach(async () => {
  w = await createProfileWorld();
  tree = await w.createTree();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function member(name: string, group = "member"): Promise<GcsActor> {
  return w.actorFor(await w.createUser(name, group));
}

const mentionDoc = (user: { id: string; name: string }, text = "uite") => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: user.id, label: user.name } }, { type: "text", text: ` ${text}` }] }],
});

const types = async (userId: string | null) => (await w.notifications.list(userId!)).map((n) => n.type);

describe("producătorii de notificări — forum", () => {
  test("B îl menționează pe A → A primește forums.mention; autorul nu se notifică pe sine", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const t = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Server nou", content: doc("x") });
    await w.posts.reply(b, { topicId: t.topicId, content: mentionDoc({ id: a.userId!, name: "Ana" }) });

    const [n] = await w.notifications.list(a.userId!);
    expect(n).toMatchObject({ type: "forums.mention", actorIds: [b.userId], data: { title: "Server nou", snippet: "@Ana uite" } });
    expect(n!.data.href).toMatch(new RegExp(`^/topic/${t.topicId}-server-nou/post/\\d+$`));
    expect(await types(b.userId)).toEqual([]);
  });

  test("citatul notifică autorul postării citate", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const t = await w.topics.create(a, { forumId: tree.forum.id, title: "Citate", content: doc("original") });
    const quote = { type: "doc", content: [{ type: "quote", attrs: { postId: t.postId, authorName: "Ana" }, content: [{ type: "paragraph", content: [{ type: "text", text: "original" }] }] }, { type: "paragraph", content: [{ type: "text", text: "de acord" }] }] };
    await w.posts.reply(b, { topicId: t.topicId, content: quote });
    // Ana urmărește topicul (e autoarea), dar primește doar citatul, nu și „răspuns nou” pentru aceeași postare.
    expect(await types(a.userId)).toEqual(["forums.quote"]);
  });

  test("B răspunde într-un topic urmărit de A și C → două notificări (fără B), grupate pe topic", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const c = await member("Cezar");
    const t = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Urmărit", content: doc("x") });
    await w.follows.follow(a, "topic", String(t.topicId));
    await w.follows.follow(c, "topic", String(t.topicId));
    await w.follows.follow(b, "topic", String(t.topicId));

    await w.posts.reply(b, { topicId: t.topicId, content: doc("primul") });
    expect(await w.db.notification.count({ where: { type: "forums.reply" } })).toBe(3); // A, C și autorul topicului
    expect(await types(b.userId)).toEqual([]);

    await w.clearFlood(b);
    await w.posts.reply(b, { topicId: t.topicId, content: doc("al doilea") });
    const [n] = await w.notifications.list(a.userId!);
    expect(n).toMatchObject({ type: "forums.reply", count: 2, actorIds: [b.userId] });
    const d = await member("Dan");
    await w.posts.reply(d, { topicId: t.topicId, content: doc("al treilea") });
    expect((await w.notifications.list(a.userId!))[0]).toMatchObject({ count: 3, actorIds: [d.userId, b.userId] });
  });

  test("topic nou într-un forum urmărit → forums.topic", async () => {
    const a = await member("Ana");
    await w.follows.follow(a, "forum", String(tree.forum.id));
    await w.topics.create(w.member, { forumId: tree.forum.id, title: "Anunț", content: doc("x") });
    expect(await types(a.userId)).toEqual(["forums.topic"]);
  });

  test("o postare PENDING cu mențiune nu notifică; aprobarea o notifică", async () => {
    const a = await member("Ana");
    const newbie = await member("Nou", "new_member");
    const t = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Moderat", content: doc("x") });
    const r = await w.posts.reply(newbie, { topicId: t.topicId, content: mentionDoc({ id: a.userId!, name: "Ana" }) });
    expect(r.pending).toBe(true);
    expect(await types(a.userId)).toEqual([]);

    await w.moderation.approve(w.root, [r.postId]);
    expect(await types(a.userId)).toEqual(["forums.mention"]);
  });

  test("o postare într-un forum fără forums.read pentru A nu-l notifică", async () => {
    const a = await member("Ana");
    const staff = await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "Staff" }, w.root);
    await w.groupService.setContainerInherit("forum", String(staff.id), { inherits: false, parentId: null }, w.root);
    await w.groupService.setContainerPermissions("forum", String(staff.id), { [w.groups.root_admin!]: ["forums.view", "forums.read", "forums.reply", "forums.create"] }, w.root);
    await w.topics.create(w.root, { forumId: staff.id, title: "Secret", content: mentionDoc({ id: a.userId!, name: "Ana" }) });
    expect(await types(a.userId)).toEqual([]);
  });

  test("reacția pozitivă la o postare notifică autorul; rezolvarea notifică autorul răspunsului", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const qa = await w.forums.create({ parentId: tree.category.id, type: "QA", name: "Întrebări" }, w.root);
    const t = await w.topics.create(a, { forumId: qa.id, title: "Întrebare", content: doc("cum?") });
    const r = await w.posts.reply(b, { topicId: t.topicId, content: doc("așa") });
    const like = await w.db.reaction.findFirstOrThrow({ where: { weight: { gt: 0 } } });
    await w.reactions.react(a, { contentType: "forums.post", contentId: String(r.postId), reactionId: like.id });
    expect(await types(b.userId)).toContain("forums.reaction");
    await w.topics.markSolved(a, t.topicId, r.postId);
    expect(await types(b.userId)).toContain("forums.solution");
  });
});

describe("producătorii de notificări — profil, mesaje, VIP, avertismente", () => {
  test("urmăritor nou, mesaj pe perete, badge", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    await w.social.follow(b, a.userId!);
    await w.social.postStatus(b, a.userId!, doc("salut"));
    const badge = await w.db.badge.findFirstOrThrow();
    await w.achievements.awardBadge(w.root, a.userId!, badge.id, "bravo");
    expect((await types(a.userId)).sort()).toEqual(["profile.badge", "profile.follower", "profile.wall"]);
  });

  test("mesaj privat nou: notificare grupată pe conversație și un singur email imediat", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const { conversationId } = await w.conversations.start(b, { to: [a.userId!], title: "Salut", content: doc("hey") });
    await w.clearPmFlood(b);
    await w.conversations.reply(b, conversationId, doc("mai ești?"));
    const list = await w.notifications.list(a.userId!);
    expect(list).toMatchObject([{ type: "pm.message", count: 2 }]);
    expect(w.outbox.filter((m) => m.to.startsWith("ana"))).toHaveLength(1);
  });

  test("emailul imediat se trimite o singură dată, chiar dacă jobul rulează de două ori", async () => {
    const a = await member("Ana");
    await w.warnings.warn({ userId: a.userId!, points: 1, reason: "limbaj" }, w.root);
    const [n] = await w.notifications.list(a.userId!);
    expect(n).toMatchObject({ type: "core.warning", data: { title: "limbaj" } });
    expect(w.outbox.filter((m) => m.to.startsWith("ana"))).toHaveLength(1);
    expect(await w.producers.sendInstant(n!.id)).toBe(false);
    expect(await Promise.all([w.producers.sendInstant(n!.id), w.producers.sendInstant(n!.id)])).toEqual([false, false]);
    expect(w.outbox.filter((m) => m.to.startsWith("ana"))).toHaveLength(1);
  });

  test("expirarea VIP: notificarea vip.expiring și emailul imediat", async () => {
    const a = await member("Ana");
    await w.vip.grant(w.root, { userId: a.userId!, groupId: w.groups.vip_silver!, days: 2, asPrimary: false });
    w.outbox.length = 0;
    await w.vip.sweep();
    expect((await types(a.userId)).sort()).toEqual(["vip.expiring", "vip.granted"]);
    expect(w.outbox).toHaveLength(1);
    expect(w.outbox[0]!.subject).toContain("VIP Silver");
  });
});

describe("digestul", () => {
  async function setup() {
    const a = await member("Ana");
    const b = await member("Bogdan");
    await w.social.follow(b, a.userId!);
    await w.social.postStatus(b, a.userId!, doc("salut"));
    w.outbox.length = 0;
    return { a, b };
  }

  test("trimite o dată, doar ce e necitit și netrimis; fără necitite nu trimite nimic", async () => {
    const { a } = await setup();
    expect(await w.producers.digest()).toBe(1);
    expect(w.outbox).toHaveLength(1);
    expect(w.outbox[0]!.subject).toContain("2 notificări noi");
    expect(w.outbox[0]!.html).toContain("Bogdan te urmărește");

    expect(await w.producers.digest()).toBe(0);
    expect(w.outbox).toHaveLength(1);

    // O notificare nouă intră în următorul digest; cele citite nu.
    const c = await member("Cezar");
    await w.social.follow(c, a.userId!);
    await w.notifications.markRead(a.userId!, "all");
    expect(await w.producers.digest()).toBe(0);
  });

  test("două rulări în paralel → un singur email", async () => {
    await setup();
    const sent = await Promise.all([w.producers.digest(), w.producers.digest(), w.producers.digest()]);
    expect(sent.reduce((s, n) => s + n, 0)).toBe(1);
    expect(w.outbox).toHaveLength(1);
  });

  test("preferința OFF exclude tipul din digest; digestIfDue rulează o singură dată pe zi, după ora setată", async () => {
    const { a } = await setup();
    await w.notifications.setPreferences(a.userId!, { "profile.follower": { email: "off" }, "profile.wall": { email: "off" } });
    expect(await w.producers.digest()).toBe(0);

    await w.notifications.setPreferences(a.userId!, { "profile.wall": { email: "on", emailMode: "daily" } });
    // 05:00 UTC = 08:00 în București (vara): ora implicită 8.
    expect(await w.producers.digestIfDue(new Date("2026-07-01T04:30:00Z"))).toBe(false);
    expect(await w.producers.digestIfDue(new Date("2026-07-01T05:10:00Z"))).toBe(true);
    expect(await w.producers.digestIfDue(new Date("2026-07-01T09:00:00Z"))).toBe(false);
    expect(w.outbox).toHaveLength(1);
    expect(w.outbox[0]!.subject).toContain("O notificare nouă");
  });
});
