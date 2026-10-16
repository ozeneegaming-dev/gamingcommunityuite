import type { GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { pickRank } from "./achievements";
import { rankEmblemArt, rankQualifies } from "./rankLadder";

describe("pragurile rangurilor (toate / oricare, criteriile aplicațiilor)", () => {
  const base = { id: 1, position: 1, minPosts: 10, minPoints: 100, minReputation: null };
  test("toate: fiecare prag; oricare: măcar unul; un rang fără praguri e rangul de bază", () => {
    expect(rankQualifies({ ...base, match: "all" }, { postsCount: 10, points: 50, reputation: 0 })).toBe(false);
    expect(rankQualifies({ ...base, match: "any" }, { postsCount: 10, points: 50, reputation: 0 })).toBe(true);
    expect(rankQualifies({ ...base, minPosts: null, minPoints: null, match: "all" }, { postsCount: 0, points: 0, reputation: 0 })).toBe(true);
  });

  test("criteriile aplicațiilor: din metrici; unul fără valoare (aplicație oprită) se ignoră", () => {
    const r = { ...base, minPosts: null, minPoints: null, match: "all", criteria: [{ metric: "servers.hours", min: 50 }, { metric: "servers.elo", min: 1500 }] };
    expect(rankQualifies(r, { postsCount: 0, points: 0, reputation: 0, metrics: { "servers.hours": 60, "servers.elo": 1400 } })).toBe(false);
    expect(rankQualifies({ ...r, match: "any" }, { postsCount: 0, points: 0, reputation: 0, metrics: { "servers.hours": 60, "servers.elo": 1400 } })).toBe(true);
    expect(rankQualifies(r, { postsCount: 0, points: 0, reputation: 0, metrics: { "servers.hours": 60 } })).toBe(true);
    const ladder = [
      { id: 1, position: 0, minPosts: 0, minPoints: null, minReputation: null },
      { id: 2, position: 1, minPosts: 999, minPoints: null, minReputation: null, match: "any", criteria: [{ metric: "core.member_days", min: 30 }] },
    ];
    expect(pickRank(ladder, { postsCount: 5, points: 0, reputation: 0, metrics: { "core.member_days": 40 } })).toBe(2);
    expect(pickRank(ladder, { postsCount: 5, points: 0, reputation: 0, metrics: { "core.member_days": 10 } })).toBe(1);
  });

  test("emblema: treapta dă forma și metalul; legendă e desenată cu culoarea ei", () => {
    expect(rankEmblemArt({ name: "Gold", icon: null, emblemTier: "gold", emblemShape: null, emblemIcon: null, color: null })).toMatchObject({ artTier: "gold", artShape: "shield" });
    expect(rankEmblemArt({ name: "Leg", icon: null, emblemTier: "legend", emblemShape: null, emblemIcon: "fa-solid fa-dragon", color: null })).toMatchObject({ artTier: "custom", artIcon: "fa-solid fa-dragon" });
  });
});

describe("ranguri moderne (cu baza de date)", () => {
  let w: GcsProfileWorld;
  let admin: GcsActor;

  beforeEach(async () => {
    w = await createProfileWorld();
    await w.grantAdmin(["members.ranks", "members.badges", "members.achievement_rules"]);
    admin = await w.actorFor(await w.createUser("Admin", "admin"));
  });

  afterAll(async () => {
    await w.db.$disconnect();
    w.redis.disconnect();
  });

  test("avantajele: grupul (sursa „rank”) și badge-ul se dau la urcare și se retrag la pierderea rangului", async () => {
    const group = await w.db.group.create({ data: { key: "custom_rank", name: "Veterani" } });
    const badge = await w.achievementAdmin.saveBadge(admin, null, { key: "veteran_perk", name: "Veteran", description: "", symbol: "", color: "#FFB224", manual: false, points: 0 });
    const top = await w.achievementAdmin.saveRank(admin, null, { name: "Veteran", icon: null, minPosts: 5, minPoints: null, minReputation: null, emblemTier: "gold", perkGroupId: group.id, perkBadgeId: badge.id });
    const uid = w.member.userId!;
    await w.db.user.update({ where: { id: uid }, data: { postsCount: 6 } });
    w.published.length = 0;
    expect(await w.achievements.recomputeRank(uid)).toBe(top.id);
    expect((await w.db.userGroup.findUniqueOrThrow({ where: { userId_groupId: { userId: uid, groupId: group.id } } })).source).toBe("rank");
    expect(await w.db.userBadge.findFirst({ where: { userId: uid, badgeId: badge.id } })).not.toBeNull();
    // Toast-ul live de urcare.
    expect(w.published.find((p) => p.event === "rank-up")).toMatchObject({ room: `user:${uid}`, data: { name: "Veteran" } });

    await w.db.user.update({ where: { id: uid }, data: { postsCount: 1 } });
    expect(await w.achievements.recomputeRank(uid)).not.toBe(top.id);
    expect(await w.db.userGroup.findUnique({ where: { userId_groupId: { userId: uid, groupId: group.id } } })).toBeNull();
    expect(await w.db.userBadge.findFirst({ where: { userId: uid, badgeId: badge.id } })).toBeNull();
  });

  test("un grup dat manual nu e retras de rang", async () => {
    const group = await w.db.group.create({ data: { key: "custom_rank2", name: "Aleși" } });
    const top = await w.achievementAdmin.saveRank(admin, null, { name: "Ales", icon: null, minPosts: 5, minPoints: null, minReputation: null, perkGroupId: group.id });
    const uid = w.member.userId!;
    await w.db.userGroup.create({ data: { userId: uid, groupId: group.id, source: "manual" } });
    await w.db.user.update({ where: { id: uid }, data: { postsCount: 6 } });
    expect(await w.achievements.recomputeRank(uid)).toBe(top.id);
    await w.db.user.update({ where: { id: uid }, data: { postsCount: 0 } });
    await w.achievements.recomputeRank(uid);
    expect(await w.db.userGroup.findUnique({ where: { userId_groupId: { userId: uid, groupId: group.id } } })).not.toBeNull();
  });

  test("criteriul pe vechime (core.member_days) cu „oricare”; criteriile necunoscute sunt respinse", async () => {
    await expect(w.achievementAdmin.saveRank(admin, null, { name: "X", icon: null, minPosts: null, minPoints: null, minReputation: null, criteria: [{ metric: "nu.exista", min: 1 }] })).rejects.toMatchObject({ fields: { criteria: "invalid_choice" } });
    const r = await w.achievementAdmin.saveRank(admin, null, { name: "Vechi", icon: null, minPosts: 100000, minPoints: null, minReputation: null, match: "any", criteria: [{ metric: "core.member_days", min: 10 }] });
    const uid = w.member.userId!;
    await w.db.user.update({ where: { id: uid }, data: { createdAt: new Date(Date.now() - 20 * 86_400_000) } });
    expect(await w.achievements.recomputeRank(uid)).toBe(r.id);
  });

  test("distribuția, copia, exportul și scările prestabilite", async () => {
    const ranks = await w.achievementAdmin.ranks();
    const copy = await w.achievementAdmin.duplicateRank(admin, ranks[0]!.id);
    expect(copy.name).toBe(`${ranks[0]!.name} (2)`);
    const dist = await w.achievementAdmin.rankDistribution();
    expect([...dist.values()].reduce((a, b) => a + b, 0)).toBe(await w.db.user.count());
    const exported = await w.achievementAdmin.exportRanks();
    expect(exported.ranks).toHaveLength(ranks.length + 1);

    const res = await w.achievementAdmin.applyRankPreset(admin, "gaming");
    expect(res.created).toBe(6);
    const after = await w.achievementAdmin.ranks();
    expect(after.map((r) => r.emblemTier)).toEqual(["bronze", "silver", "gold", "platinum", "diamond", "legend"]);
    expect(after[5]).toMatchObject({ animated: true, match: "any" });

    await w.achievementAdmin.importRanks(admin, exported, { replace: true });
    expect((await w.achievementAdmin.ranks()).map((r) => r.name)).toEqual(exported.ranks.map((r) => r.name));
    await expect(w.achievementAdmin.importRanks(admin, { kind: "x" }, { replace: false })).rejects.toThrow();
  });
});
