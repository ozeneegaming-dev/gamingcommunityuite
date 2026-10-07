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

  test("insigna: forma, nivelul și iconița se validează; textul e opțional (1–3 caractere)", async () => {
    const base = { key: "mvp", name: "MVP", description: "", symbol: "", color: "#F4B740", manual: true, points: 0 };
    await expect(
      w.achievementAdmin.saveBadge(admin, null, { ...base, symbol: "ABCD", artShape: "circle", artTier: "wood", artIcon: 'fa-solid fa-star"><script>' }),
    ).rejects.toMatchObject({ fields: { symbol: "invalid", artShape: "invalid_choice", artTier: "invalid_choice", artIcon: "invalid_choice" } });
    await expect(w.achievementAdmin.saveBadge(admin, null, { ...base, artIcon: "fa-solid fa-nu-exista-deloc" })).rejects.toMatchObject({ fields: { artIcon: "invalid_choice" } });

    const b = await w.achievementAdmin.saveBadge(admin, null, { ...base, artShape: "rosette", artTier: "gold", artIcon: "fa-solid fa-trophy" });
    expect(b).toMatchObject({ symbol: null, artShape: "rosette", artTier: "gold", artIcon: "fa-solid fa-trophy" });
    // Golirea câmpurilor revine la insigna implicită (din simbol și culoare).
    const reset = await w.achievementAdmin.saveBadge(admin, b.id, { ...base, symbol: "GG", artShape: "", artTier: null, artIcon: null });
    expect(reset).toMatchObject({ symbol: "GG", artShape: null, artTier: null, artIcon: null });
  });

  test("imaginea proprie: doar un atașament-imagine încărcat de admin; se leagă de badge, e publică și dispare la înlocuire", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#F4B740" } }).png().toBuffer();
    const upload = (name: string, bytes: Buffer) => w.attachments.upload(admin, { name, bytes }, { permission: "acp.access" });
    const base = { key: "img_badge", name: "Cu imagine", description: "", symbol: "I", color: "#F4B740", manual: true, points: 0 };

    const text = await upload("note.txt", Buffer.from("nu e imagine"));
    await expect(w.achievementAdmin.saveBadge(admin, null, { ...base, imageAttachmentId: text.id })).rejects.toMatchObject({ fields: { image: "invalid_image" } });
    // Imaginea altcuiva (sau una deja legată de alt conținut) nu poate fi „adoptată” de un badge.
    const foreign = await w.db.attachment.create({ data: { ownerId: w.member.userId, storageKey: "test/foreign.png", filename: "a.png", mime: "image/png", size: 10 } });
    await expect(w.achievementAdmin.saveBadge(admin, null, { ...base, imageAttachmentId: foreign.id })).rejects.toMatchObject({ fields: { image: "invalid_image" } });

    const first = await upload("a.png", png);
    const b = await w.achievementAdmin.saveBadge(admin, null, { ...base, imageAttachmentId: first.id });
    expect(b.imageAttachmentId).toBe(first.id);
    expect(await w.db.attachment.findUnique({ where: { id: first.id } })).toMatchObject({ contentType: "badges.image", contentId: String(b.id) });
    // Publică: un vizitator o poate deschide.
    await expect(w.attachments.open(w.guest, first.id)).resolves.toMatchObject({ mime: "image/png" });

    // Salvarea fără imagine nouă o păstrează; o imagine nouă o înlocuiește pe cea veche; `null` o scoate.
    expect((await w.achievementAdmin.saveBadge(admin, b.id, base)).imageAttachmentId).toBe(first.id);
    const second = await upload("b.png", png);
    expect((await w.achievementAdmin.saveBadge(admin, b.id, { ...base, imageAttachmentId: second.id })).imageAttachmentId).toBe(second.id);
    expect(await w.db.attachment.findUnique({ where: { id: first.id } })).toBeNull();
    expect((await w.achievementAdmin.saveBadge(admin, b.id, { ...base, imageAttachmentId: null })).imageAttachmentId).toBeNull();
    expect(await w.db.attachment.findUnique({ where: { id: second.id } })).toBeNull();
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
