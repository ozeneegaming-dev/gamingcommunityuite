import { GcsForbidden, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";

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

describe("ACP → Realizări", () => {
  test("redenumirea și restrângerea unui rang recalculează rangurile; afișarea vede numele nou", async () => {
    await w.db.user.update({ where: { id: w.member.userId! }, data: { postsCount: 12 } });
    await w.achievements.recomputeRank(w.member.userId!);
    const player = (await w.achievementAdmin.ranks()).find((r) => r.name === "Jucător")!;
    await w.achievementAdmin.saveRank(admin, player.id, { name: "Gamer", icon: "🎮", minPosts: 10, minPoints: null, minReputation: null });
    expect((await w.ranks.data()).ranks[String(player.id)]).toEqual({ name: "Gamer", icon: "🎮" });

    await w.achievementAdmin.saveRank(admin, player.id, { name: "Gamer", icon: null, minPosts: 10, minPoints: null, minReputation: 5 });
    const u = await w.db.user.findUniqueOrThrow({ where: { id: w.member.userId! }, include: { rank: true } });
    expect(u.rank?.name).toBe("Recrut");
    expect(await w.db.auditLog.count({ where: { action: "rank.update" } })).toBe(2);
  });

  test("ordinea rangurilor trebuie să conțină toate rangurile; un membru nu poate edita", async () => {
    const ids = (await w.achievementAdmin.ranks()).map((r) => r.id);
    await expect(w.achievementAdmin.reorderRanks(admin, ids.slice(1))).rejects.toBeInstanceOf(GcsValidationError);
    await w.achievementAdmin.reorderRanks(admin, [...ids].reverse());
    expect((await w.achievementAdmin.ranks()).map((r) => r.id)).toEqual([...ids].reverse());
    await expect(w.achievementAdmin.saveRank(w.member, null, { name: "x", icon: null, minPosts: 1, minPoints: null, minReputation: null })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("badge-uri: validare (simbol, culoare, cheie unică) și ștergere", async () => {
    await expect(w.achievementAdmin.saveBadge(admin, null, { key: "x y", name: "", description: "", symbol: "ABCD", color: "red", manual: true, points: 0 })).rejects.toMatchObject({
      fields: { key: "invalid", name: "required", symbol: "invalid", color: "invalid_color" },
    });
    await expect(w.achievementAdmin.saveBadge(admin, null, { key: "vip", name: "Dublură", description: "", symbol: "V", color: "#FF0000", manual: true, points: 0 })).rejects.toMatchObject({ fields: { key: "taken" } });
    const b = await w.achievementAdmin.saveBadge(admin, null, { key: "mvp", name: "MVP", description: "Jucătorul lunii", symbol: "★", color: "#f4b740", manual: true, points: 0 });
    expect(b.color).toBe("#F4B740");
    await w.achievementAdmin.deleteBadge(admin, b.id);
    expect(await w.db.badge.findUnique({ where: { key: "mvp" } })).toBeNull();
  });

  test("reguli: o regulă pe acțiune nu poate da badge; o regulă nouă „5 postări → MVP” se aplică la evaluare", async () => {
    const mvp = await w.achievementAdmin.saveBadge(admin, null, { key: "mvp", name: "MVP", description: "", symbol: "★", color: "#F4B740", manual: false, points: 0 });
    await expect(w.achievementAdmin.saveRule(admin, null, { name: "x", trigger: "EACH_POST", threshold: 0, points: 0, badgeId: mvp.id, enabled: true })).rejects.toMatchObject({ fields: { badgeId: "each_no_badge" } });
    await w.achievementAdmin.saveRule(admin, null, { name: "5 postări", trigger: "POSTS_COUNT", threshold: 5, points: 0, badgeId: mvp.id, enabled: true });
    await w.db.user.update({ where: { id: w.member.userId! }, data: { postsCount: 5 } });
    await w.achievements.evaluate(w.member.userId!);
    const keys = (await w.db.userBadge.findMany({ where: { userId: w.member.userId! }, include: { badge: true } })).map((b) => b.badge.key);
    expect(keys).toContain("mvp");
  });
});
