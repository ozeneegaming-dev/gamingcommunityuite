import { GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { doc } from "../../test/world";
import { GAMING_PACK } from "./achievementPresets";
import { countDecision, normalizeConditions, normalizeRewards } from "./achievementRules";

let w: GcsProfileWorld;
let admin: GcsActor;
let forumId: number;
let otherForumId: number;

beforeEach(async () => {
  w = await createProfileWorld();
  await w.grantAdmin(["members.ranks", "members.badges", "members.achievement_rules"]);
  admin = await w.actorFor(await w.createUser("Admin", "admin"));
  forumId = (await w.createTree()).forum.id;
  otherForumId = (await w.createTree()).forum.id;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const badgeOf = async (userId: string, key: string) => w.db.userBadge.findFirst({ where: { userId, badge: { key } } });
const points = async (userId: string) => (await w.db.user.findUniqueOrThrow({ where: { id: userId } })).points;

async function newBadge(key = "talker") {
  return w.achievementAdmin.saveBadge(admin, null, { key, name: `Badge ${key}`, description: "", symbol: "", color: "#4FA3FF", manual: false, points: 0 });
}

async function topic(actor: GcsActor, forum = forumId) {
  await w.clearFlood(actor);
  return w.topics.create(actor, { forumId: forum, title: "Un topic de test", content: doc("Salut!") });
}

describe("motorul regulilor (funcții pure)", () => {
  test("condițiile și recompensele se normalizează; valorile au doar „reach”", () => {
    expect(normalizeConditions({ mode: "every", n: 0, forumIds: [3, 3, "x"], windowDays: 9999 })).toEqual({ mode: "every", n: 1, forumIds: [3], serverIds: [], groupIds: [], windowDays: null });
    expect(normalizeConditions({ mode: "every", n: 5, windowDays: 7 }, "value")).toMatchObject({ mode: "reach", n: 5, windowDays: null });
    expect(normalizeRewards({ actor: { points: 5000, badgeId: 2 }, other: { points: 0 } })).toEqual({
      actor: { points: 0, badgeId: 2, groupId: null, groupDays: null, vipGroupId: null, vipDays: null, nameStyleId: null },
      other: null,
    });
  });

  test("a n-a oară o dată, la fiecare n la multipli", () => {
    expect([1, 2, 3].map((c) => countDecision({ mode: "nth", n: 2 }, c))).toEqual([null, "once", "once"]);
    expect([1, 2, 3, 4].map((c) => countDecision({ mode: "every", n: 2 }, c))).toEqual([null, "repeat", null, "repeat"]);
  });
});

describe("reguli pe evenimente", () => {
  test("„a 2-a postare” → badge + puncte, o singură dată; notificarea și fluxul live", async () => {
    const b = await newBadge();
    await w.achievementAdmin.saveEventRule(admin, null, { name: "Două postări", event: "forums.post", enabled: true, conditions: { mode: "nth", n: 2 }, rewards: { actor: { points: 7, badgeId: b.id } } });
    const before = await points(w.member.userId!);
    const t = await topic(w.member);
    expect(await badgeOf(w.member.userId!, "talker")).toBeNull();
    await w.clearFlood(w.member);
    await w.posts.reply(w.member, { topicId: t.topicId, content: doc("Încă una") });
    expect(await badgeOf(w.member.userId!, "talker")).not.toBeNull();
    // 2 puncte pe postare (regula „pe acțiune” din seed) + 7 din regulă.
    expect((await points(w.member.userId!)) - before).toBe(2 + 7);
    await w.clearFlood(w.member);
    await w.posts.reply(w.member, { topicId: t.topicId, content: doc("A treia") });
    expect(await w.db.achievementLog.count({ where: { userId: w.member.userId!, uniqueKey: { startsWith: "v2:" } } })).toBe(1);
    expect(await w.db.notification.count({ where: { userId: w.member.userId!, type: "profile.badge" } })).toBeGreaterThan(0);
    expect(w.published.some((p) => p.room === "feed:badges" && (p.data as { badgeId: number }).badgeId === b.id)).toBe(true);
  });

  test("„la fiecare 2” acordă la 2 și la 4; o apariție repetată (aceeași referință) nu se numără", async () => {
    const rule = await w.achievementAdmin.saveEventRule(admin, null, { name: "Pas", event: "forums.topic", enabled: true, conditions: { mode: "every", n: 2 }, rewards: { actor: { points: 3 } } });
    for (let i = 0; i < 4; i++) await topic(w.member);
    expect(await w.db.achievementLog.count({ where: { ruleId: rule.id } })).toBe(2);
    expect(await w.achievementRules.handle("forums.topic", { userId: w.member.userId!, ref: "topic:999999" })).toBe(0);
    expect(await w.achievementRules.handle("forums.topic", { userId: w.member.userId!, ref: "topic:999999" })).toBe(0);
    expect(await w.db.achievementOccurrence.count({ where: { ruleId: rule.id } })).toBe(5);
  });

  test("condițiile: forumurile alese, grupurile alese și fereastra de timp", async () => {
    const vipGroup = await w.db.group.findUniqueOrThrow({ where: { key: "vip_gold" } });
    await w.achievementAdmin.saveEventRule(admin, null, { name: "Doar forumul 2", event: "forums.topic", enabled: true, conditions: { mode: "nth", n: 1, forumIds: [otherForumId] }, rewards: { actor: { points: 11 } } });
    await w.achievementAdmin.saveEventRule(admin, null, { name: "Doar VIP", event: "forums.topic", enabled: true, conditions: { mode: "nth", n: 1, groupIds: [vipGroup.id] }, rewards: { actor: { points: 13 } } });
    const w1 = await w.achievementAdmin.saveEventRule(admin, null, { name: "2 în 1 zi", event: "forums.topic", enabled: true, conditions: { mode: "nth", n: 2, windowDays: 1 }, rewards: { actor: { points: 17 } } });
    // O apariție veche (în afara ferestrei) nu ajută.
    await w.db.achievementOccurrence.create({ data: { ruleId: w1.id, userId: w.member.userId!, ref: "old", createdAt: new Date(Date.now() - 3 * 86_400_000) } });
    await topic(w.member);
    const logs = async () => (await w.db.achievementLog.findMany({ where: { userId: w.member.userId!, uniqueKey: { startsWith: "v2:" } }, include: { rule: true } })).map((l) => l.rule?.name).sort();
    expect(await logs()).toEqual([]);
    await topic(w.member, otherForumId);
    expect(await logs()).toEqual(["2 în 1 zi", "Doar forumul 2"]);
  });

  test("reacția primită: recompense separate pentru autor și pentru cine a dat reacția", async () => {
    const b = await newBadge("liked");
    await w.achievementAdmin.saveEventRule(admin, null, {
      name: "Prima reacție",
      event: "forums.reaction_received",
      enabled: true,
      conditions: { mode: "nth", n: 1 },
      rewards: { actor: { badgeId: b.id }, other: { points: 5 } },
    });
    const t = await topic(w.member);
    const fan = await w.actorFor(await w.createUser("Fan", "member"));
    const like = await w.db.reaction.findUniqueOrThrow({ where: { key: "like" } });
    const fanBefore = await points(fan.userId!);
    await w.reactions.react(fan, { contentType: "forums.post", contentId: String(t.postId), reactionId: like.id });
    expect(await badgeOf(w.member.userId!, "liked")).not.toBeNull();
    expect((await points(fan.userId!)) - fanBefore).toBe(5);
    expect(await badgeOf(fan.userId!, "liked")).toBeNull();
  });

  test("grup secundar temporar (sursa „achievements”) și grupurile excluse nu primesc nimic", async () => {
    const group = await w.db.group.findUniqueOrThrow({ where: { key: "member" } });
    const custom = await w.db.group.create({ data: { key: "custom_99", name: "Activi" } });
    await w.achievementAdmin.saveEventRule(admin, null, { name: "Grup", event: "forums.topic", enabled: true, conditions: { mode: "nth", n: 1 }, rewards: { actor: { groupId: custom.id, groupDays: 7 } } });
    await topic(w.member);
    const ug = await w.db.userGroup.findUniqueOrThrow({ where: { userId_groupId: { userId: w.member.userId!, groupId: custom.id } } });
    expect(ug.source).toBe("achievements");
    expect(ug.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    await w.settings.set("achievements.excluded_groups", [group.id], w.root);
    const other = await w.actorFor(await w.createUser("Exclus", "member"));
    await topic(other);
    expect(await w.db.userGroup.findUnique({ where: { userId_groupId: { userId: other.userId!, groupId: custom.id } } })).toBeNull();
  });

  test("evenimentele aplicațiilor apar și dispar cu aplicația", async () => {
    const keys = async () => (await w.achievementRules.availableEvents()).map((e) => e.def.key);
    expect(await keys()).toEqual(expect.arrayContaining(["forums.post", "chat.message", "servers.kills", "servers.elo", "clans.join", "vip.subscribed", "core.member_days", "chat_pro.ranking_winner"]));
    const rule = await w.achievementAdmin.saveEventRule(admin, null, { name: "Ucideri", event: "servers.kills", enabled: true, conditions: { n: 1 }, rewards: { actor: { points: 1 } } });
    w.appsOff.add("servers");
    expect(await keys()).not.toContain("servers.kills");
    expect(await keys()).toContain("forums.post");
    await expect(w.achievementAdmin.saveEventRule(admin, rule.id, { name: "Ucideri", event: "servers.kills", enabled: true, conditions: { n: 1 }, rewards: { actor: { points: 1 } } })).rejects.toBeInstanceOf(GcsValidationError);
    expect(await w.achievementRules.handle("servers.kills", { userId: w.member.userId!, ref: "value", value: 50 })).toBe(0);
    w.appsOff.delete("servers");
    expect(await w.achievementRules.handle("servers.kills", { userId: w.member.userId!, ref: "value", value: 50 })).toBe(1);
  });

  test("validarea: fără recompensă, „cealaltă parte” doar unde există, grupurile protejate nu se dau", async () => {
    const root = await w.db.group.findUniqueOrThrow({ where: { key: "root_admin" } });
    await expect(w.achievementAdmin.saveEventRule(admin, null, { name: "Gol", event: "forums.post", enabled: true, conditions: {}, rewards: { actor: {} } })).rejects.toMatchObject({ fields: { rewards: "rule_empty" } });
    await expect(w.achievementAdmin.saveEventRule(admin, null, { name: "X", event: "forums.post", enabled: true, conditions: {}, rewards: { actor: { points: 1 }, other: { points: 1 } } })).rejects.toMatchObject({ fields: { other: "invalid_choice" } });
    await expect(w.achievementAdmin.saveEventRule(admin, null, { name: "X", event: "forums.post", enabled: true, conditions: {}, rewards: { actor: { groupId: root.id } } })).rejects.toMatchObject({ fields: { "actor.groupId": "invalid_choice" } });
    await expect(w.achievementAdmin.saveEventRule(w.member, null, { name: "X", event: "forums.post", enabled: true, conditions: {}, rewards: { actor: { points: 1 } } })).rejects.toThrow();
  });

  test("comutare, copie (oprită) și o regulă oprită nu se declanșează", async () => {
    const r = await w.achievementAdmin.saveEventRule(admin, null, { name: "T", event: "forums.topic", enabled: true, conditions: { n: 1 }, rewards: { actor: { points: 2 } } });
    const copy = await w.achievementAdmin.duplicateRule(admin, r.id);
    expect(copy).toMatchObject({ enabled: false, event: "forums.topic", name: "T (2)" });
    await w.achievementAdmin.setRuleEnabled(admin, r.id, false);
    await topic(w.member);
    expect(await w.db.achievementLog.count({ where: { ruleId: { in: [r.id, copy.id] } } })).toBe(0);
  });
});

describe("export / import", () => {
  test("exportul se reimportă pe alt site (badge-urile create după cheie, grupurile după cheie)", async () => {
    const b = await newBadge("exported");
    const vip = await w.db.group.findUniqueOrThrow({ where: { key: "vip_gold" } });
    await w.achievementAdmin.saveEventRule(admin, null, { name: "Export", event: "forums.post", enabled: true, conditions: { mode: "every", n: 3, groupIds: [vip.id] }, rewards: { actor: { points: 4, badgeId: b.id } } });
    const pack = await w.achievementAdmin.exportRules();
    expect(pack.badges?.map((x) => x.key)).toEqual(["exported"]);
    expect(pack.rules[0]).toMatchObject({ event: "forums.post", conditions: { mode: "every", n: 3, groups: ["vip_gold"] }, rewards: { actor: { points: 4, badge: "exported" } } });

    await w.db.achievementRule.deleteMany({ where: { trigger: "EVENT" } });
    await w.db.badge.delete({ where: { id: b.id } });
    const res = await w.achievementAdmin.importRules(admin, JSON.parse(JSON.stringify(pack)));
    expect(res).toEqual({ created: 1, skipped: 0, badges: 1 });
    const rule = await w.db.achievementRule.findFirstOrThrow({ where: { trigger: "EVENT" } });
    const newBadgeRow = await w.db.badge.findUniqueOrThrow({ where: { key: "exported" } });
    expect(normalizeRewards(rule.rewards).actor.badgeId).toBe(newBadgeRow.id);
    expect(normalizeConditions(rule.conditions).groupIds).toEqual([vip.id]);
    await expect(w.achievementAdmin.importRules(admin, { kind: "altceva", rules: [] })).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("„Pachet Gaming”: badge-urile și regulile; cu Serverele oprite, regulile lor se sar", async () => {
    w.appsOff.add("servers");
    const res = await w.achievementAdmin.importGamingPack(admin);
    const serverRules = GAMING_PACK.rules.filter((r) => r.event.startsWith("servers.")).length;
    expect(res.created).toBe(GAMING_PACK.rules.length - serverRules);
    expect(res.skipped).toBe(serverRules);
    expect(res.badges).toBe(GAMING_PACK.badges!.length);
    expect(await w.db.badge.findUnique({ where: { key: "gp_marathon" } })).not.toBeNull();
  });
});

describe("recalcularea în fundal", () => {
  test("o regulă nouă pe postări se aplică membrilor existenți; progresul ajunge la „done”", async () => {
    await topic(w.member);
    const b = await newBadge("retro");
    await w.achievementAdmin.saveEventRule(admin, null, { name: "Retro", event: "forums.post", enabled: true, conditions: { mode: "nth", n: 1 }, rewards: { actor: { badgeId: b.id } } });
    expect(await badgeOf(w.member.userId!, "retro")).toBeNull();
    const status = await w.achievementRules.requestRecalc();
    expect(status).toMatchObject({ state: "done" });
    expect(status.done).toBe(await w.db.user.count());
    expect(await badgeOf(w.member.userId!, "retro")).not.toBeNull();
    // A doua recalculare nu dublează nimic.
    await w.achievementRules.requestRecalc();
    expect(await w.db.userBadge.count({ where: { badgeId: b.id } })).toBe(1);
  });
});

describe("„Câștigătorul zilei” (insignele pe perioadă)", () => {
  test("o dată pe perioadă; altă perioadă crește numărul de câștiguri și urcă în fluxul recent", async () => {
    await newBadge("winner_day");
    const first = await w.achievementRules.grantPeriodWinner({ userId: w.member.userId!, badgeKey: "winner_day", period: "day:2026-10-15" });
    const again = await w.achievementRules.grantPeriodWinner({ userId: w.member.userId!, badgeKey: "winner_day", period: "day:2026-10-15" });
    const next = await w.achievementRules.grantPeriodWinner({ userId: w.member.userId!, badgeKey: "winner_day", period: "day:2026-10-16" });
    expect([first, again, next]).toEqual([
      { granted: true, wins: 1 },
      { granted: false, wins: 1 },
      { granted: true, wins: 2 },
    ]);
    const recent = await w.achievementRules.recent({ limit: 5 });
    expect(recent[0]).toMatchObject({ timesAwarded: 2, badge: { key: "winner_day" }, user: { id: w.member.userId } });
    expect(await w.achievementRules.grantPeriodWinner({ userId: w.member.userId!, badgeKey: "nu_exista", period: "x" })).toEqual({ granted: false, wins: 0 });
  });

  test("badge-urile rare: doar cele deținute de puțini membri", async () => {
    const common = await newBadge("common");
    const rare = await newBadge("rare_one");
    const users = await w.db.user.findMany({ select: { id: true } });
    await w.db.userBadge.createMany({ data: users.map((u) => ({ userId: u.id, badgeId: common.id })) });
    await w.db.userBadge.create({ data: { userId: w.member.userId!, badgeId: rare.id } });
    await w.settings.set("achievements.rare_percent", 40, w.root);
    const ids = await w.achievementRules.rareBadgeIds();
    expect(ids.has(rare.id)).toBe(true);
    expect(ids.has(common.id)).toBe(false);
    expect((await w.achievementRules.recent({ limit: 10, rareOnly: true })).map((r) => r.badge.key)).toEqual(["rare_one"]);
  });
});
