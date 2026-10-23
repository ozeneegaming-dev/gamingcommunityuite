import type { GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsMentionQueries, GROUP_CARD_MEMBERS, MENTION_USER_LIMIT } from "./mentions";

let w: GcsProfileWorld;
let q: GcsMentionQueries;

beforeEach(async () => {
  w = await createProfileWorld();
  q = new GcsMentionQueries({ db: w.db, cache: w.cache, permissions: w.permissions, groupMentions: w.groupMentions });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function user(name: string, group = "member", opts: { secondary?: string[]; activeMinutesAgo?: number; hidden?: boolean } = {}) {
  const u = await w.createUser(name, group, opts.secondary ?? []);
  await w.db.user.update({
    where: { id: u.id },
    data: {
      ...(opts.activeMinutesAgo !== undefined ? { lastActiveAt: new Date(Date.now() - opts.activeMinutesAgo * 60_000) } : {}),
      ...(opts.hidden ? { privacy: { showOnline: false } } : {}),
    },
  });
  return u;
}

describe("sugestiile de membri", () => {
  test("prefixul numelui (fără diacritice), în ordinea numelui, cel mult 10; cu avatarul, stilul numelui și statusul online", async () => {
    await user("Ștefan", "moderator", { activeMinutesAgo: 1 });
    await user("Stela", "member", { activeMinutesAgo: 1, hidden: true });
    await user("Bogdan");
    const found = await q.users("ST");
    expect(found.map((u) => u.name)).toEqual(["Ștefan", "Stela"]);
    expect(found[0]).toMatchObject({ nameKey: "moderator", groupKey: "moderator", image: null, online: true });
    // Statusul ascuns de membru nu apare ca online.
    expect(found[1]).toMatchObject({ online: false });

    for (let i = 0; i < 12; i++) await user(`Tester${String(i).padStart(2, "0")}`);
    const many = await q.users("test");
    expect(many).toHaveLength(MENTION_USER_LIMIT);
    expect(many[0]!.name).toBe("Tester00");
  });

  test("caracterele speciale din LIKE (`_`, `%`) se caută literal; sub 2 caractere nu se caută", async () => {
    await user("an_a");
    await user("anXa");
    expect((await q.users("an_")).map((u) => u.name)).toEqual(["an_a"]);
    expect(await q.users("a%")).toEqual([]);
    expect(await q.users("a")).toEqual([]);
  });
});

describe("sugestiile de grupuri", () => {
  test("doar grupurile pe care viewer-ul le poate menționa, după prefixul numelui", async () => {
    expect((await q.groups(w.moderator, "")).map((g) => g.key)).toEqual(["admin", "super_moderator", "moderator"]);
    expect((await q.groups(w.moderator, "mod")).map((g) => g.key)).toEqual(["moderator"]);
    expect((await q.groups(w.moderator, "SUPER")).map((g) => g.key)).toEqual(["super_moderator"]);
    expect(await q.groups(w.member, "")).toEqual([]);
    expect((await q.groups(w.moderator, "mod"))[0]).toEqual({ id: w.groups.moderator, key: "moderator", name: "Moderator", color: "#5EA2FF", icon: "fa-solid fa-shield" });
  });
});

describe("cardul unui grup", () => {
  test("contoarele (principal + secundar, online fără cei ascunși) și membrii, cei online primii", async () => {
    // NeoX (`w.moderator`) e moderator, fără activitate.
    const online = await user("Online", "moderator", { activeMinutesAgo: 1 });
    const secondary = await user("Secundar", "member", { secondary: ["moderator"], activeMinutesAgo: 2 });
    const hidden = await user("Ascuns", "moderator", { activeMinutesAgo: 0, hidden: true });
    const card = await q.card(w.member, w.groups.moderator!);
    expect(card).toMatchObject({ key: "moderator", name: "Moderator", color: "#5EA2FF", icon: "fa-solid fa-shield", memberCount: 4, onlineCount: 2, canListMembers: true });
    expect(card!.members.map((m) => [m.id, m.online])).toEqual([
      [online.id, true],
      [secondary.id, true],
      // Cel ascuns apare ca offline (după cei online), chiar dacă a fost activ cel mai recent.
      [hidden.id, false],
      [w.moderator.userId, false],
    ]);
  });

  test(`cel mult ${GROUP_CARD_MEMBERS} membri în card`, async () => {
    for (let i = 0; i < GROUP_CARD_MEMBERS + 3; i++) await user(`Mod${i}`, "moderator");
    const card = await q.card(w.member, w.groups.moderator!);
    expect(card!.memberCount).toBe(GROUP_CARD_MEMBERS + 4);
    expect(card!.members).toHaveLength(GROUP_CARD_MEMBERS);
  });

  test("confidențialitate: un grup nementionabil și ascuns din legendă nu se expune; fără dreptul de a vedea membrii, doar contoarele", async () => {
    await w.db.group.update({ where: { id: w.groups.vip_gold! }, data: { inLegend: false } });
    await user("Vip", "vip_gold");
    expect(await q.card(w.member, w.groups.vip_gold!)).toBeNull();
    // Activat pentru mențiuni, devine vizibil chiar dacă nu e în legendă.
    const current = (await w.groupMentions.group(w.groups.vip_gold!))!.settings;
    await w.groupService.setMentionSettings(w.groups.vip_gold!, { ...current, enabled: true }, w.root);
    expect(await q.card(w.member, w.groups.vip_gold!)).toMatchObject({ memberCount: 1 });
    expect(await q.card(w.member, 999_999)).toBeNull();

    const banned: GcsActor = { ...w.member, isBanned: true };
    expect(await q.card(banned, w.groups.moderator!)).toMatchObject({ canListMembers: false, members: [], memberCount: 1 });
  });
});
