import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testDb, truncateAll } from "./helpers";

const db = testDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function users(...names: string[]) {
  const group = await db.group.create({ data: { key: "member", name: "Membru" } });
  const out = [];
  for (const name of names) {
    out.push(
      await db.user.create({
        data: { name, nameNormalized: name.toLowerCase(), email: `${name.toLowerCase()}@example.com`, primaryGroupId: group.id },
      }),
    );
  }
  return { group, users: out };
}

describe("schema etapa 3", () => {
  test("userii noi au valorile implicite de profil", async () => {
    const { users: [u] } = await users("Mara");
    expect(u).toMatchObject({ points: 0, followersCount: 0, solutionsCount: 0, bio: "", accentColor: null, rankId: null, privacy: {} });
  });

  test("ștergerea unei conversații șterge participanții și mesajele", async () => {
    const { users: [a, b] } = await users("Ana", "Bogdan");
    const conv = await db.conversation.create({
      data: {
        title: "Salut",
        starterId: a!.id,
        participants: { create: [{ userId: a!.id }, { userId: b!.id }] },
        messages: { create: [{ authorId: a!.id, contentJson: { type: "doc" }, contentHtml: "<p>x</p>" }] },
      },
    });
    await db.conversation.delete({ where: { id: conv.id } });
    expect(await db.conversationParticipant.count()).toBe(0);
    expect(await db.conversationMessage.count()).toBe(0);
  });

  test("un badge se acordă o singură dată unui user", async () => {
    const { users: [u] } = await users("Mara");
    const badge = await db.badge.create({ data: { key: "first_post", name: "Primul post", symbol: "✎", color: "#5EA2FF" } });
    await db.userBadge.create({ data: { userId: u!.id, badgeId: badge.id } });
    await expect(db.userBadge.create({ data: { userId: u!.id, badgeId: badge.id } })).rejects.toThrow();
  });

  test("achievement_log nu acceptă două intrări cu aceeași cheie unică; cheile null sunt libere", async () => {
    const { users: [u] } = await users("Mara");
    await db.achievementLog.create({ data: { userId: u!.id, points: 10, uniqueKey: "rule:1" } });
    await expect(db.achievementLog.create({ data: { userId: u!.id, points: 10, uniqueKey: "rule:1" } })).rejects.toThrow();
    await db.achievementLog.create({ data: { userId: u!.id, points: 1 } });
    await db.achievementLog.create({ data: { userId: u!.id, points: 1 } });
    expect(await db.achievementLog.count()).toBe(3);
  });

  test("un user are cel mult un abonament VIP activ", async () => {
    const { users: [u] } = await users("Krypt");
    const gold = await db.group.create({ data: { key: "vip_gold", name: "VIP Gold", isVip: true } });
    await db.vipSubscription.create({ data: { userId: u!.id, groupId: gold.id } });
    await expect(db.vipSubscription.create({ data: { userId: u!.id, groupId: gold.id } })).rejects.toThrow();
    await db.vipSubscription.updateMany({ data: { status: "EXPIRED" } });
    await db.vipSubscription.create({ data: { userId: u!.id, groupId: gold.id } });
    expect(await db.vipSubscription.count()).toBe(2);
  });

  test("ștergerea unei rame sau a unui stil lasă userul fără ele (nu șterge userul)", async () => {
    const { users: [u] } = await users("Krypt");
    const frame = await db.avatarFrame.create({ data: { key: "fire", name: "Fire", style: { colors: ["#FF3B3B", "#FFE066"] } } });
    const style = await db.nameStyle.create({ data: { key: "ns_fire", name: "Fire", style: { color: "#FF3B3B" } } });
    await db.user.update({ where: { id: u!.id }, data: { avatarFrameId: frame.id, nameStyleId: style.id } });
    await db.avatarFrame.delete({ where: { id: frame.id } });
    await db.nameStyle.delete({ where: { id: style.id } });
    expect(await db.user.findUniqueOrThrow({ where: { id: u!.id } })).toMatchObject({ avatarFrameId: null, nameStyleId: null });
  });

  test("statusurile de pe perete: răspunsurile se șterg odată cu statusul", async () => {
    const { users: [a, b] } = await users("Ana", "Bogdan");
    const status = await db.statusUpdate.create({
      data: { profileUserId: a!.id, authorId: b!.id, contentJson: { type: "doc" }, contentHtml: "<p>gg</p>" },
    });
    await db.statusUpdate.create({
      data: { profileUserId: a!.id, authorId: a!.id, parentId: status.id, contentJson: { type: "doc" }, contentHtml: "<p>ms</p>" },
    });
    await db.statusUpdate.delete({ where: { id: status.id } });
    expect(await db.statusUpdate.count()).toBe(0);
  });

  test("valorile câmpurilor de profil sunt unice pe (user, câmp)", async () => {
    const { users: [u] } = await users("Mara");
    const field = await db.profileField.create({ data: { key: "country", label: "Țară", type: "TEXT" } });
    await db.profileFieldValue.create({ data: { userId: u!.id, fieldId: field.id, value: "România" } });
    await expect(db.profileFieldValue.create({ data: { userId: u!.id, fieldId: field.id, value: "Moldova" } })).rejects.toThrow();
  });
});
