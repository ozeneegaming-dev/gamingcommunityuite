import { GcsMemberRemovalService, type GcsActor, type GcsMemberDataHandler } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { GcsForumCounters } from "../src/forums/counters";
import { createRemovalWorld, type GcsRemovalWorld } from "./removalWorld";
import { doc, snapshotCounters } from "./world";

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

/** Un cont „plin”: conținut în toate aplicațiile, plus legături cu alți membri. */
async function richAccount(name: string, other: GcsActor) {
  const u = await w.user(name);
  const id = u.userId!;
  const forumId = await w.forum(`Forum ${name}`);
  const t = await w.topic(u, forumId, `Topicul lui ${name}`, "Salut", { poll: { question: "Ce hartă jucăm?", options: ["dust2", "inferno"] } });
  await w.reply(other, t.topicId, "Răspunsul altuia");
  const ot = await w.topic(other, forumId, `Topicul altuia ${name}`);
  await w.reply(u, ot.topicId, "Eu răspund");
  const poll = await w.s.db.poll.findUniqueOrThrow({ where: { topicId: t.topicId }, include: { options: true } });
  await w.s.polls.vote(other, poll.id, [poll.options[0]!.id]);
  await w.s.polls.vote(u, poll.id, [poll.options[1]!.id]);
  const like = await w.s.db.reaction.findFirstOrThrow({ where: { weight: { gt: 0 } } });
  await w.s.reactions.react(u, { contentType: "forums.post", contentId: String(ot.postId), reactionId: like.id });
  await w.s.reactions.react(other, { contentType: "forums.post", contentId: String(t.postId), reactionId: like.id });
  await w.s.db.follow.createMany({ data: [{ userId: id, contentType: "user", contentId: other.userId! }, { userId: other.userId!, contentType: "user", contentId: id }] });
  await w.s.db.user.update({ where: { id: other.userId! }, data: { followersCount: { increment: 1 } } });
  await w.s.db.statusUpdate.create({ data: { profileUserId: other.userId!, authorId: id, contentJson: doc("s"), contentHtml: "<p>s</p>" } });
  const conv = await w.s.db.conversation.create({ data: { title: "PM", starterId: id, participants: { create: [{ userId: id }, { userId: other.userId! }] } } });
  await w.s.db.conversationMessage.createMany({ data: [{ conversationId: conv.id, authorId: id, contentJson: doc("m"), contentHtml: "m" }, { conversationId: conv.id, authorId: other.userId!, contentJson: doc("r"), contentHtml: "r" }] });
  const channel = await w.s.db.chatChannel.upsert({ where: { key: "test" }, update: {}, create: { key: "test", name: "Test" } });
  await w.s.db.chatMessage.create({ data: { channelId: channel.id, authorId: id, body: "chat" } });
  await w.s.vip.grant(root, { userId: id, groupId: w.group("vip_gold"), days: 30 });
  const clan = await w.s.db.clan.create({ data: { tag: name.slice(0, 4).toUpperCase(), tagNormalized: name.slice(0, 4).toUpperCase(), name: `Clan ${name}`, nameNormalized: `clan ${name.toLowerCase()}`, slug: "c", status: "ACTIVE", membersCount: 2 } });
  await w.s.db.clanMember.createMany({ data: [{ clanId: clan.id, userId: id, role: "LEADER" }, { clanId: clan.id, userId: other.userId!, role: "MEMBER", joinedAt: new Date(Date.now() + 1000) }] });
  await w.s.db.gamePlayer.create({ data: { kind: "NAME", value: name.toLowerCase(), trust: "LOW", userId: id, linkSource: "CODE", linkedAt: new Date() } });
  await w.s.db.notification.create({ data: { userId: id, type: "t", targetType: "x", targetId: "1", groupKey: "g", data: {} } });
  await w.s.db.warning.create({ data: { userId: id, points: 1, reason: "r" } });
  await w.s.db.attachment.create({ data: { ownerId: id, storageKey: `${name}.png`, filename: "f.png", mime: "image/png", size: 1 } });
  return { user: u, forumId, topicId: t.topicId, clanId: clan.id };
}

/**
 * Un serviciu cu pașii reali, „întrerupt” după primul lot al fiecărui pas (o cădere simulată): rularea se oprește, iar
 * următoarea o reia de la cursorul salvat. Fiecare pas trebuie să ajungă la același rezultat ca o rulare fără căderi.
 */
function crashingService(): GcsMemberRemovalService {
  const real = (w.s.memberRemoval as unknown as { steps: GcsMemberDataHandler[] }).steps;
  const crashed = new Set<string>();
  const s = new GcsMemberRemovalService({ db: w.s.db, bus: w.s.bus, acp: w.s.acp, settings: w.s.settings, jobs: null, inlineLimit: -1, batchSize: 1 });
  for (const h of real) {
    const once = async (n: number) => {
      if (n > 0 && !crashed.has(h.key)) {
        crashed.add(h.key);
        throw new Error(`cădere simulată în ${h.key}`);
      }
      return n;
    };
    s.register({ ...h, erase: async (ctx) => once(await h.erase(ctx)), merge: async (ctx) => once(await h.merge(ctx)) });
  }
  return s;
}

async function runToEnd(s: GcsMemberRemovalService, id: string): Promise<number> {
  let runs = 0;
  for (; runs < 40; runs++) {
    const row = await w.s.db.memberRemoval.findUniqueOrThrow({ where: { id } });
    if (row.status === "DONE") break;
    // Căderile simulate depășesc numărul de încercări automate: le punem înapoi în coadă, ca „Reia” din ACP.
    if (row.status === "FAILED") await w.s.db.memberRemoval.update({ where: { id }, data: { status: "QUEUED", attempts: 0 } });
    await s.run(id);
  }
  return runs;
}

async function expectCountersConsistent() {
  const before = await snapshotCounters(w.s.db);
  await w.s.db.$transaction((tx) => new GcsForumCounters().recountAll(tx), { timeout: 30_000 });
  expect(await snapshotCounters(w.s.db)).toEqual(before);
}

describe("ștergerea unui cont plin", () => {
  test("o rulare întreruptă după fiecare lot se reia până la capăt, cu același rezultat (păstrând conținutul)", async () => {
    const other = await w.user("Altul");
    const { user, clanId } = await richAccount("Plin", other);
    const s = crashingService();
    const row = await s.requestDelete(root, user.userId!, { mode: "KEEP_CONTENT", keepMessages: false });
    const runs = await runToEnd(s, row.id);
    expect(runs).toBeGreaterThan(5);
    expect(await w.s.db.user.findUnique({ where: { id: user.userId! } })).toBeNull();
    const done = await w.s.db.memberRemoval.findUniqueOrThrow({ where: { id: row.id } });
    expect(done.status).toBe("DONE");
    // Conținutul rămâne, fără autor; legăturile cu ceilalți sunt curate.
    expect(await w.s.db.post.count({ where: { authorId: null } })).toBe(2);
    expect(await w.s.db.statusUpdate.count({ where: { authorId: null } })).toBe(1);
    expect(await w.s.db.conversationMessage.count()).toBe(1);
    expect(await w.s.db.user.findUniqueOrThrow({ where: { id: other.userId! } })).toMatchObject({ followersCount: 0, reputation: 0 });
    expect((await w.s.db.pollOption.findMany({ orderBy: { position: "asc" } })).map((o) => o.votesCount)).toEqual([1, 0]);
    expect(await w.s.db.clanMember.findMany({ where: { clanId }, select: { userId: true, role: true } })).toEqual([{ userId: other.userId, role: "LEADER" }]);
    expect(await w.s.db.gamePlayer.findFirstOrThrow()).toMatchObject({ userId: null });
    expect(await w.s.db.attachment.count()).toBe(0);
    await expectCountersConsistent();
  });

  test("o unire întreruptă după fiecare lot se reia până la capăt; ținta primește tot, o singură dată", async () => {
    const other = await w.user("Altul");
    const target = await w.user("Principal");
    const { user: source, topicId } = await richAccount("Dublura", other);
    const s = crashingService();
    const row = await s.requestMerge(root, source.userId!, target.userId!);
    await runToEnd(s, row.id);
    expect(await w.s.db.user.findUnique({ where: { id: source.userId! } })).toBeNull();
    expect(await w.s.db.post.count({ where: { authorId: target.userId } })).toBe(2);
    expect(await w.s.db.topic.findUniqueOrThrow({ where: { id: topicId } })).toMatchObject({ authorId: target.userId });
    const t = await w.s.db.user.findUniqueOrThrow({ where: { id: target.userId! } });
    // Reputația primită de sursă (o reacție a altuia) a trecut o singură dată.
    expect(t.reputation).toBe((await w.s.db.reaction.findFirstOrThrow({ where: { weight: { gt: 0 } } })).weight);
    expect(t.postsCount).toBe(2);
    expect(await w.s.db.follow.count({ where: { userId: other.userId!, contentType: "user", contentId: target.userId! } })).toBe(1);
    expect(await w.s.db.vipSubscription.count({ where: { userId: target.userId!, status: "ACTIVE" } })).toBe(1);
    expect(await w.s.db.clanMember.count({ where: { userId: target.userId! } })).toBe(1);
    expect(await w.s.db.warning.count({ where: { userId: target.userId! } })).toBe(1);
    expect(await w.s.db.attachment.count({ where: { ownerId: target.userId } })).toBe(1);
    await expectCountersConsistent();
  });
});
