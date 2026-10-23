import { GcsConflict, GcsForbidden, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { doc, snapshotCounters } from "../../test/world";
import { pickRank } from "./achievements";

let w: GcsProfileWorld;
let forumId: number;
let categoryId: number;

beforeEach(async () => {
  w = await createProfileWorld();
  const tree = await w.createTree();
  forumId = tree.forum.id;
  categoryId = tree.category.id;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const user = (actor: GcsActor) =>
  w.db.user.findUniqueOrThrow({ where: { id: actor.userId! }, include: { badges: { include: { badge: true } }, rank: true } });
const badgeKeys = async (actor: GcsActor) => (await user(actor)).badges.map((b) => b.badge.key).sort();

async function topic(actor: GcsActor, title = "Un topic de test") {
  await w.clearFlood(actor);
  return w.topics.create(actor, { forumId, title, content: doc("Salut!") });
}

describe("primul post (Review Focus #2)", () => {
  test("badge-ul „Primul post” + 10 puncte + 1 punct pe postare; evaluarea repetată nu dublează nimic", async () => {
    await topic(w.member);
    expect((await user(w.member)).points).toBe(1);
    await w.achievements.evaluate(w.member.userId!);
    await w.achievements.evaluate(w.member.userId!);
    await Promise.all([w.achievements.evaluate(w.member.userId!), w.achievements.evaluate(w.member.userId!)]);
    expect(await badgeKeys(w.member)).toEqual(["first_post"]);
    expect((await user(w.member)).points).toBe(11);
    expect(await w.db.achievementLog.count({ where: { userId: w.member.userId! } })).toBe(2);
  });

  test("ascunderea postării scade postsCount, dar badge-ul rămâne", async () => {
    const t = await topic(w.member);
    await w.achievements.evaluate(w.member.userId!);
    await w.posts.hide(w.root, t.postId, "test");
    await w.achievements.evaluate(w.member.userId!);
    expect((await user(w.member)).postsCount).toBe(0);
    expect(await badgeKeys(w.member)).toEqual(["first_post"]);
  });
});

describe("ranguri", () => {
  test("pickRank: cel mai înalt rang cu toate pragurile completate atinse", () => {
    const ranks = [
      { id: 1, position: 0, minPosts: 0, minPoints: null, minReputation: null },
      { id: 2, position: 1, minPosts: 10, minPoints: null, minReputation: 5 },
      { id: 3, position: 2, minPosts: 50, minPoints: null, minReputation: null },
    ];
    expect(pickRank(ranks, { postsCount: 10, points: 0, reputation: 4 })).toBe(1);
    expect(pickRank(ranks, { postsCount: 10, points: 0, reputation: 5 })).toBe(2);
    expect(pickRank(ranks, { postsCount: 60, points: 0, reputation: 0 })).toBe(3);
    expect(pickRank([], { postsCount: 60, points: 0, reputation: 0 })).toBeNull();
  });

  test("evaluarea dă rangul „Recrut”, apoi „Jucător” la 10 postări; recomputeAllRanks repară rangurile după editare", async () => {
    await topic(w.member);
    await w.achievements.evaluate(w.member.userId!);
    expect((await user(w.member)).rank?.name).toBe("Recrut");

    await w.db.user.update({ where: { id: w.member.userId! }, data: { postsCount: 10 } });
    await w.achievements.evaluate(w.member.userId!);
    expect((await user(w.member)).rank?.name).toBe("Jucător");

    await w.db.rank.updateMany({ where: { name: "Jucător" }, data: { minReputation: 5 } });
    expect(await w.achievements.recomputeAllRanks()).toBeGreaterThan(0);
    expect((await user(w.member)).rank?.name).toBe("Recrut");
  });
});

describe("rezolvări, reputație, vechime", () => {
  test("Top helper după 10 rezolvări; demarcarea scade solutionsCount; contoarele rămân egale cu recount()", async () => {
    const qa = await w.forums.create({ parentId: categoryId, type: "QA", name: "Ajutor tehnic" }, w.root);
    const helper = await w.actorFor(await w.createUser("Helper", "member"));
    let last = { topicId: 0, postId: 0 };
    for (let i = 0; i < 10; i++) {
      await w.clearFlood(w.member);
      await w.clearFlood(helper);
      const t = await w.topics.create(w.member, { forumId: qa.id, title: `Întrebarea ${i + 1}`, content: doc("?") });
      const r = await w.posts.reply(helper, { topicId: t.topicId, content: doc("Răspuns") });
      await w.topics.markSolved(w.member, t.topicId, r.postId);
      last = { topicId: t.topicId, postId: r.postId };
    }
    expect((await user(helper)).solutionsCount).toBe(10);
    // 10 răspunsuri × 1 punct + 10 rezolvări × 5 puncte
    expect((await user(helper)).points).toBe(60);
    await w.achievements.evaluate(helper.userId!);
    expect(await badgeKeys(helper)).toEqual(["first_post", "top_helper"]);

    await w.topics.markSolved(w.member, last.topicId, null);
    expect((await user(helper)).solutionsCount).toBe(9);
    const before = await snapshotCounters(w.db);
    await w.db.$transaction((tx) => w.counters.recountAll(tx));
    expect(await snapshotCounters(w.db)).toEqual(before);
  });

  test("o reacție pozitivă dă 1 punct autorului o singură dată (chiar dacă e scoasă și pusă din nou); Dezacord nu dă", async () => {
    const t = await topic(w.member);
    const reactor = await w.actorFor(await w.createUser("Fan", "member"));
    const [like, disagree] = await Promise.all([
      w.db.reaction.findUniqueOrThrow({ where: { key: "like" } }),
      w.db.reaction.findUniqueOrThrow({ where: { key: "disagree" } }),
    ]);
    const ref = { contentType: "forums.post", contentId: String(t.postId) };
    await w.reactions.react(reactor, { ...ref, reactionId: like.id });
    await w.reactions.react(reactor, { ...ref, reactionId: null });
    await w.reactions.react(reactor, { ...ref, reactionId: like.id });
    await w.reactions.react(reactor, { ...ref, reactionId: disagree.id });
    // 1 (postarea) + 1 (reacția pozitivă, o dată)
    expect((await user(w.member)).points).toBe(2);
  });

  test("„1 an membru” se acordă prin sweep-ul zilnic unui cont creat acum 366 de zile", async () => {
    const veteran = await w.actorFor(await w.createUser("Veteran", "member"));
    await w.db.user.update({ where: { id: veteran.userId! }, data: { createdAt: new Date(Date.now() - 366 * 86_400_000) } });
    expect(await w.achievements.dailySweep()).toBe(1);
    expect(await badgeKeys(veteran)).toEqual(["member_1y"]);
    expect(await w.achievements.dailySweep()).toBe(0);
  });

  test("badge-ul VIP: un membru dintr-un grup VIP îl primește la evaluare", async () => {
    const vip = await w.actorFor(await w.createUser("Shadow", "member", ["vip_gold"]));
    await w.achievements.evaluate(vip.userId!);
    expect(await badgeKeys(vip)).toEqual(["vip"]);
  });
});

describe("badge-uri manuale", () => {
  test("staff-ul cu drept ACP acordă un badge (în jurnal); a doua acordare → GcsConflict; un membru nu poate", async () => {
    await w.grantAdmin(["members.badges"]);
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    const champion = await w.db.badge.findUniqueOrThrow({ where: { key: "tournament_champion" } });
    await expect(w.achievements.awardBadge(w.member, w.member.userId!, champion.id, "x")).rejects.toBeInstanceOf(GcsForbidden);
    await w.achievements.awardBadge(admin, w.member.userId!, champion.id, "A câștigat turneul CS2 2v2");
    await expect(w.achievements.awardBadge(admin, w.member.userId!, champion.id, "iar")).rejects.toBeInstanceOf(GcsConflict);
    expect(await badgeKeys(w.member)).toEqual(["tournament_champion"]);
    expect(await w.db.auditLog.count({ where: { action: "badge.award" } })).toBe(1);

    await w.achievements.revokeBadge(admin, w.member.userId!, champion.id);
    expect(await badgeKeys(w.member)).toEqual([]);
  });
});

describe("evaluarea inițială", () => {
  test("membrii existenți primesc badge-urile pentru pragurile deja atinse, o singură dată", async () => {
    await w.db.user.update({ where: { id: w.member.userId! }, data: { postsCount: 120 } });
    expect(await w.achievements.backfill()).toBeGreaterThan(0);
    expect(await badgeKeys(w.member)).toEqual(["first_post", "posts_100"]);
    expect((await user(w.member)).rank?.name).toBe("Activ");
    expect(await w.achievements.backfill()).toBe(0);
  });
});

