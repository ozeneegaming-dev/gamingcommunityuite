import type { GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsProfileExtras } from "./extras";
import { GcsMemberPrefsService } from "./memberPrefs";

let w: GcsProfileWorld;
let extras: GcsProfileExtras;
let visitor: GcsActor;
let sponsorId: string | null;

beforeEach(async () => {
  w = await createProfileWorld();
  sponsorId = null;
  visitor = await w.actorFor(await w.createUser("Vizitator", "member"));
  extras = new GcsProfileExtras({ db: w.db, cache: w.cache, queries: w.profileQueries, sponsor: async (id) => ({ total: 0, sponsor: id === sponsorId }) });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
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

  test("insigna „Sponsor” vine din donații (pragul și perioada: vezi donations.test.ts)", async () => {
    expect((await extras.achievements(w.guest, w.member.userId!))?.sponsor).toBe(false);
    sponsorId = w.member.userId!;
    expect((await extras.achievements(w.guest, w.member.userId!))?.sponsor).toBe(true);
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
