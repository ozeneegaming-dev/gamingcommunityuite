import { GcsForbidden, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { doc } from "../../test/world";
import { GcsLeaderboard, type GcsLeaderboardMetric, type GcsLeaderboardPeriod } from "./leaderboard";
import { GcsOnlineTime } from "./onlineTime";

let w: GcsProfileWorld;
let board: GcsLeaderboard;
let tree: Awaited<ReturnType<GcsProfileWorld["createTree"]>>;
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

beforeEach(async () => {
  w = await createProfileWorld();
  board = new GcsLeaderboard({ db: w.db, cache: w.cache, permissions: w.permissions });
  tree = await w.createTree();
  // Contoarele lumii de test pornesc de la zero (topicurile create în teste le cresc).
  await w.db.user.updateMany({ data: { reputation: 0, postsCount: 0, points: 0, solutionsCount: 0 } });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

async function player(name: string, group = "member"): Promise<GcsActor> {
  return w.actorFor(await w.createUser(name, group));
}

/** Clasamentul văzut de viewer, ca „Nume=valoare#loc” (fără cache, ca fiecare verificare să vadă baza). */
async function standings(viewer: GcsActor, metric: GcsLeaderboardMetric, period: GcsLeaderboardPeriod): Promise<string[]> {
  await w.cache.invalidateTags(["leaderboard"]);
  return (await board.top(viewer, metric, period)).map((r) => `${r.user.name}=${r.value}#${r.rank}`);
}

async function post(actor: GcsActor, at: Date, topicId?: number): Promise<{ topicId: number; postId: number }> {
  await w.clearFlood(actor);
  if (topicId === undefined) {
    const t = await w.topics.create(actor, { forumId: tree.forum.id, title: `Topic ${Math.random()}`, content: doc("text") });
    await w.db.post.update({ where: { id: t.postId }, data: { createdAt: at } });
    return t;
  }
  const r = await w.posts.reply(actor, { topicId, content: doc("răspuns") });
  await w.db.post.update({ where: { id: r.postId }, data: { createdAt: at } });
  return { topicId, postId: r.postId };
}

describe("clasamentul", () => {
  test("„tot timpul” folosește contoarele: ordinea, egalitățile cu același loc, fără valori zero", async () => {
    const [a, b, c] = [await player("Alfa"), await player("Beta"), await player("Gama")];
    await w.db.user.update({ where: { id: a.userId! }, data: { reputation: 40, points: 5, solutionsCount: 2, postsCount: 7 } });
    await w.db.user.update({ where: { id: b.userId! }, data: { reputation: 90, points: 5 } });
    await w.db.user.update({ where: { id: c.userId! }, data: { reputation: 40, points: 12 } });

    expect(await standings(w.member, "reputation", "all")).toEqual(["Beta=90#1", "Alfa=40#2", "Gama=40#2"]);
    expect(await standings(w.member, "xp", "all")).toEqual(["Gama=12#1", "Alfa=5#2", "Beta=5#2"]);
    expect(await standings(w.member, "solutions", "all")).toEqual(["Alfa=2#1"]);
    expect(await standings(w.member, "posts", "all")).toEqual(["Alfa=7#1"]);
  });

  test("pe perioade: postările vizibile create în ultimele 7 / 30 de zile", async () => {
    const [a, b] = [await player("Alfa"), await player("Beta")];
    const t = await post(a, daysAgo(2));
    await post(a, daysAgo(20), t.topicId);
    await post(a, daysAgo(45), t.topicId);
    await post(b, daysAgo(1), t.topicId);
    await post(b, daysAgo(3), t.topicId);
    const hidden = await post(b, daysAgo(1), t.topicId);
    await w.posts.hide(w.root, hidden.postId);

    expect(await standings(w.guest, "posts", "week")).toEqual(["Beta=2#1", "Alfa=1#2"]);
    expect(await standings(w.guest, "posts", "month")).toEqual(["Alfa=2#1", "Beta=2#1"]);
  });

  test("pe perioade: reputația din reacțiile primite, XP-ul din jurnal, soluțiile marcate", async () => {
    const [a, b, fan] = [await player("Alfa"), await player("Beta"), await player("Fan")];
    const t = await post(a, daysAgo(10));
    const r = await post(b, daysAgo(10), t.topicId);
    const reactions = new Map((await w.db.reaction.findMany()).map((x) => [x.key, x.id]));
    await w.reactions.react(fan, { contentType: "forums.post", contentId: String(t.postId), reactionId: reactions.get("like")! });
    await w.reactions.react(w.member, { contentType: "forums.post", contentId: String(t.postId), reactionId: reactions.get("thanks")! });
    await w.reactions.react(fan, { contentType: "forums.post", contentId: String(r.postId), reactionId: reactions.get("disagree")! });
    // O reacție veche (acum 20 de zile) contează la lună, nu și la săptămână.
    await w.db.contentReaction.updateMany({ where: { userId: w.member.userId! }, data: { createdAt: daysAgo(20) } });
    const status = await w.social.postStatus(b, b.userId!, doc("status"));
    await w.reactions.react(fan, { contentType: "profile.status", contentId: String(status.id), reactionId: reactions.get("gg")! });

    expect(await standings(w.member, "reputation", "week")).toEqual(["Alfa=1#1"]);
    expect(await standings(w.member, "reputation", "month")).toEqual(["Alfa=2#1"]);
    expect(await standings(w.member, "reputation", "all")).toEqual(["Alfa=2#1"]);

    // Doar intrările de mai jos (regulile implicite pot da puncte și pentru postările de mai sus).
    await w.db.achievementLog.deleteMany({});
    await w.db.achievementLog.createMany({
      data: [
        { userId: a.userId!, points: 10, createdAt: daysAgo(1) },
        { userId: b.userId!, points: 25, createdAt: daysAgo(12) },
        { userId: b.userId!, points: 5, createdAt: daysAgo(2) },
      ],
    });
    expect(await standings(w.member, "xp", "week")).toEqual(["Alfa=10#1", "Beta=5#2"]);
    expect(await standings(w.member, "xp", "month")).toEqual(["Beta=30#1", "Alfa=10#2"]);

    await w.db.topic.update({ where: { id: t.topicId }, data: { solvedPostId: r.postId } });
    expect(await standings(w.member, "solutions", "week")).toEqual([]);
    expect(await standings(w.member, "solutions", "month")).toEqual(["Beta=1#1"]);
  });

  test("membrii banați nu apar; profilurile private doar pentru cine le poate vedea", async () => {
    const banned = await player("Banat", "banned");
    const accountBan = await player("CuBan");
    const priv = await player("Privat");
    const followed = await player("Ascuns");
    await w.db.user.updateMany({ where: { id: { in: [banned.userId!, accountBan.userId!, priv.userId!, followed.userId!] } }, data: { reputation: 50 } });
    await w.db.ban.create({ data: { type: "ACCOUNT", value: accountBan.userId!, userId: accountBan.userId!, reason: "test" } });
    await w.profiles.updatePrivacy(priv, { profile: "MEMBERS", messages: "MEMBERS", wall: "MEMBERS", showOnline: true });
    await w.profiles.updatePrivacy(followed, { profile: "FOLLOWED", messages: "MEMBERS", wall: "MEMBERS", showOnline: true });

    expect(await standings(w.guest, "reputation", "all")).toEqual([]);
    expect(await standings(w.member, "reputation", "all")).toEqual(["Privat=50#1"]);
    expect(await standings(w.root, "reputation", "all")).toEqual(["Privat=50#1", "Ascuns=50#1"]);

    await expect(board.top({ ...w.guest, isBanned: true }, "reputation", "all")).rejects.toBeInstanceOf(GcsForbidden);
    await expect(board.top(banned, "reputation", "all")).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("rezultatul e cache-uit pe public; invalidarea `leaderboard` îl reface", async () => {
    const a = await player("Alfa");
    await w.db.user.update({ where: { id: a.userId! }, data: { points: 3 } });
    expect((await board.top(w.guest, "xp", "all")).map((r) => r.value)).toEqual([3]);
    await w.db.user.update({ where: { id: a.userId! }, data: { points: 9 } });
    expect((await board.top(w.guest, "xp", "all")).map((r) => r.value)).toEqual([3]);
    await w.cache.invalidateTags([`user:${a.userId}`]);
    expect((await board.top(w.guest, "xp", "all")).map((r) => r.value)).toEqual([9]);
  });
});

describe("clasamentul: topicuri, azi, timpul online și locul tău (Hero Cockpit)", () => {
  test("topicurile vizibile pornite în perioadă; „azi” începe la miezul nopții în fusul orar al site-ului", async () => {
    const [a, b] = [await player("Alfa"), await player("Beta")];
    const datedTopic = async (actor: GcsActor, at: Date) => {
      const t = await post(actor, at);
      await w.db.topic.update({ where: { id: t.topicId }, data: { createdAt: at } });
    };
    await datedTopic(a, new Date());
    await datedTopic(a, daysAgo(3));
    await datedTopic(b, daysAgo(40));
    expect(await standings(w.member, "topics", "day")).toEqual(["Alfa=1#1"]);
    expect(await standings(w.member, "topics", "week")).toEqual(["Alfa=2#1"]);
    expect(await standings(w.member, "topics", "year")).toEqual(["Alfa=2#1", "Beta=1#2"]);
    expect(await standings(w.member, "topics", "all")).toEqual(["Alfa=2#1", "Beta=1#2"]);
    expect(await standings(w.member, "posts", "day")).toEqual(["Alfa=1#1"]);
  });

  test("timpul online: din zilele salvate, fără statusul ascuns; locul viewer-ului", async () => {
    const online = new GcsOnlineTime({ db: w.db, redis: w.redis, settings: w.settings });
    const timed = new GcsLeaderboard({ db: w.db, cache: w.cache, permissions: w.permissions, settings: w.settings, onlineTime: online });
    const [a, b, c] = [await player("Alfa"), await player("Beta"), await player("Gama")];
    const today = await online.today();
    await w.db.memberOnlineDay.createMany({
      data: [
        { userId: a.userId!, day: today, seconds: 600 },
        { userId: b.userId!, day: today, seconds: 3600 },
        { userId: c.userId!, day: today, seconds: 1800 },
        { userId: a.userId!, day: "2020-01-01", seconds: 9000 },
      ],
    });
    await w.profiles.updatePrivacy(c, { profile: "PUBLIC", messages: "MEMBERS", wall: "MEMBERS", showOnline: false });
    await w.cache.invalidateTags(["leaderboard"]);
    expect((await timed.top(w.member, "online", "day")).map((r) => `${r.user.name}=${r.value}#${r.rank}`)).toEqual(["Beta=3600#1", "Alfa=600#2"]);
    await w.cache.invalidateTags(["leaderboard"]);
    expect((await timed.top(w.member, "online", "all")).map((r) => `${r.user.name}=${r.value}`)).toEqual(["Alfa=9600", "Beta=3600"]);
    expect(await timed.place(a, "online", "day")).toEqual({ rank: 2, value: 600 });
    expect(await timed.place(c, "online", "day")).toBeNull();
    expect(await timed.place(w.guest, "online", "day")).toBeNull();
    // Fără serviciul de timp online, măsura e goală (nu o eroare).
    expect(await board.top(w.member, "online", "week")).toEqual([]);
  });

  test("locul viewer-ului: egalitățile au același loc", async () => {
    const [a, b, c] = [await player("Alfa"), await player("Beta"), await player("Gama")];
    await w.db.user.update({ where: { id: a.userId! }, data: { reputation: 40 } });
    await w.db.user.update({ where: { id: b.userId! }, data: { reputation: 90 } });
    await w.db.user.update({ where: { id: c.userId! }, data: { reputation: 40 } });
    expect(await board.place(c, "reputation", "all")).toEqual({ rank: 2, value: 40 });
    expect(await board.place(b, "reputation", "all")).toEqual({ rank: 1, value: 90 });
    expect(await board.place(w.member, "reputation", "all")).toBeNull();
  });
});
