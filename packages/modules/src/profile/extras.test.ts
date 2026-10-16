import { GcsForbidden, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsProfileExtras } from "./extras";
import { GcsMemberPrefsService } from "./memberPrefs";

let w: GcsProfileWorld;
let extras: GcsProfileExtras;
let admin: GcsActor;
let visitor: GcsActor;

beforeEach(async () => {
  w = await createProfileWorld();
  await w.grantAdmin(["members.members"]);
  admin = await w.actorFor(await w.createUser("Casier", "admin"));
  visitor = await w.actorFor(await w.createUser("Vizitator", "member"));
  extras = new GcsProfileExtras({ db: w.db, cache: w.cache, settings: w.settings, queries: w.profileQueries, acp: w.acp });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("caseta realizărilor", () => {
  test("reputația, nivelul, locul n/N după reputație, insignele cele mai noi", async () => {
    await w.db.user.update({ where: { id: w.member.userId! }, data: { reputation: 50, postsCount: 60 } });
    await w.db.user.update({ where: { id: visitor.userId! }, data: { reputation: 80 } });
    const badge = await w.db.badge.findFirstOrThrow({ orderBy: { position: "asc" } });
    await w.db.userBadge.create({ data: { userId: w.member.userId!, badgeId: badge.id } });
    const box = await extras.achievements(w.guest, w.member.userId!);
    expect(box).toMatchObject({ reputation: 50, badgeCount: 1, sponsor: false, level: { rank: "Activ" } });
    expect(box!.rank.position).toBe(2);
    expect(box!.rank.total).toBeGreaterThanOrEqual(3);
    expect(box!.badges.map((b) => b.key)).toEqual([badge.key]);
  });

  test("insigna „Sponsor”: automată peste pragul din setări (0 = oprită); donațiile doar din ACP", async () => {
    await w.settings.set("profile.sponsor_min_amount", 20, w.root);
    await extras.addDonation(admin, w.member.userId!, { amount: 15, currency: "eur", note: "  mulțumim " });
    expect(await extras.sponsor(w.member.userId!)).toEqual({ total: 1500, sponsor: false });
    await extras.addDonation(admin, w.member.userId!, { amount: 5.5, currency: "EUR", note: "" });
    expect(await extras.sponsor(w.member.userId!)).toEqual({ total: 2050, sponsor: true });
    expect((await extras.achievements(w.guest, w.member.userId!))?.sponsor).toBe(true);
    expect((await extras.donations(w.member.userId!))[1]).toMatchObject({ currency: "EUR", note: "mulțumim", amount: 1500 });
    await w.settings.set("profile.sponsor_min_amount", 0, w.root);
    expect((await extras.sponsor(w.member.userId!)).sponsor).toBe(false);
    await expect(extras.addDonation(w.member, w.member.userId!, { amount: 100, currency: "EUR", note: "" })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(extras.addDonation(admin, w.member.userId!, { amount: -1, currency: "EURO", note: "" })).rejects.toMatchObject({ fields: { amount: "invalid_range", currency: "invalid" } });
    expect(await w.db.auditLog.count({ where: { action: "member.donation.add" } })).toBe(2);
  });
});

describe("vizitatorii recenți", () => {
  test("o vizită pe minut se notează o dată; nu pe propriul profil; vizitatorul care nu vrea nu apare", async () => {
    expect(await extras.recordVisit(visitor, w.member.userId!)).toBe(true);
    expect(await extras.recordVisit(visitor, w.member.userId!)).toBe(false);
    expect(await extras.recordVisit(w.member, w.member.userId!)).toBe(false);
    expect(await extras.recordVisit(w.guest, w.member.userId!)).toBe(false);
    expect((await extras.visitors(w.guest, w.member.userId!))?.map((v) => v.id)).toEqual([visitor.userId]);

    await new GcsMemberPrefsService({ db: w.db, bus: w.bus }).set(w.moderator, { recordVisits: false });
    expect(await extras.recordVisit(w.moderator, w.member.userId!)).toBe(false);
    expect(await w.db.profileVisit.count({ where: { profileUserId: w.member.userId! } })).toBe(1);
  });

  test("cine își ascunde prezența nu apare; proprietarul poate ascunde caseta (o vede doar el)", async () => {
    await w.profiles.updatePrivacy(visitor, { profile: "PUBLIC", messages: "MEMBERS", wall: "MEMBERS", showOnline: false });
    expect(await extras.recordVisit(visitor, w.member.userId!)).toBe(false);
    await extras.recordVisit(w.moderator, w.member.userId!);
    await new GcsMemberPrefsService({ db: w.db, bus: w.bus }).set(w.member, { showVisitors: false });
    expect(await extras.visitors(w.guest, w.member.userId!)).toBeNull();
    expect((await extras.visitors(w.member, w.member.userId!))?.map((v) => v.id)).toEqual([w.moderator.userId]);
  });
});
