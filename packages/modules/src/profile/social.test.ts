import { GcsForbidden, GcsNotFound, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { doc } from "../../test/world";

let w: GcsProfileWorld;
let other: GcsActor;

beforeEach(async () => {
  w = await createProfileWorld();
  other = await w.actorFor(await w.createUser("Dexter", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const followers = async (actor: GcsActor) => (await w.db.user.findUniqueOrThrow({ where: { id: actor.userId! } })).followersCount;
const setPrivacy = (actor: GcsActor, patch: Record<string, unknown>) =>
  w.profiles.updatePrivacy(actor, { profile: "PUBLIC", messages: "MEMBERS", wall: "MEMBERS", showOnline: true, ...patch });

describe("urmărirea userilor", () => {
  test("follow/unfollow repetate lasă followersCount corect; nu te poți urmări pe tine", async () => {
    await w.social.follow(other, w.member.userId!);
    await w.social.follow(other, w.member.userId!);
    expect(await followers(w.member)).toBe(1);
    expect(await w.social.isFollowing(other.userId, w.member.userId!)).toBe(true);
    await w.social.unfollow(other, w.member.userId!);
    await w.social.unfollow(other, w.member.userId!);
    expect(await followers(w.member)).toBe(0);
    await expect(w.social.follow(w.member, w.member.userId!)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("follow în paralel de la mai mulți useri: contorul e exact", async () => {
    const fans = await Promise.all(Array.from({ length: 6 }, async (_, i) => w.actorFor(await w.createUser(`Fan${i}`, "member"))));
    await Promise.all(fans.flatMap((f) => [w.social.follow(f, w.member.userId!), w.social.follow(f, w.member.userId!)]));
    expect(await followers(w.member)).toBe(6);
  });

  test("un profil pe care nu-l vezi nu poate fi urmărit (404)", async () => {
    await setPrivacy(w.member, { profile: "FOLLOWED" });
    await expect(w.social.follow(other, w.member.userId!)).rejects.toBeInstanceOf(GcsNotFound);
  });
});

describe("ignorarea (Review Focus #3)", () => {
  test("un moderator nu poate fi ignorat; un membru da, iar lista e cache-uită și invalidată", async () => {
    await expect(w.social.ignore(w.member, w.moderator.userId!, { posts: true, messages: true })).rejects.toBeInstanceOf(GcsValidationError);
    expect(await w.social.ignoredIds(w.member.userId, "posts")).toEqual([]);
    await w.social.ignore(w.member, other.userId!, { posts: true, messages: false });
    expect(await w.social.ignoredIds(w.member.userId, "posts")).toEqual([other.userId]);
    expect(await w.social.ignoredIds(w.member.userId, "messages")).toEqual([]);
    await w.social.unignore(w.member, other.userId!);
    expect(await w.social.ignoredIds(w.member.userId, "posts")).toEqual([]);
  });
});

describe("peretele profilului", () => {
  test("oricine e membru scrie pe perete; răspunsul crește repliesCount; vizitatorul nu poate scrie", async () => {
    const status = await w.social.postStatus(other, w.member.userId!, doc("GG la turneu!"));
    expect(status.contentHtml).toContain("GG la turneu!");
    await w.social.postStatus(w.member, w.member.userId!, doc("Mersi!"), status.id);
    expect((await w.db.statusUpdate.findUniqueOrThrow({ where: { id: status.id } })).repliesCount).toBe(1);
    await expect(w.social.postStatus(w.guest, w.member.userId!, doc("x"))).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("mențiunile dintr-un status și dintr-un comentariu: pastile după id și notificarea de mențiune", async () => {
    const mira = await w.createUser("Mira", "member");
    const mention = (id: string, label: string) => ({ type: "mention", attrs: { id, label, kind: "user" } });
    const status = await w.social.postStatus(other, w.member.userId!, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "salut " }, mention(mira.id, "Mira")] }],
    });
    expect(status.contentHtml).toContain(`data-user-id="${mira.id}"`);
    await expect.poll(() => w.db.notification.count({ where: { userId: mira.id, type: "forums.mention", targetType: "profile.status" } })).toBe(1);
    // Proprietarul peretelui, menționat în statusul de pe peretele lui, primește o singură notificare (mențiunea).
    await w.clearWallFlood(other);
    const own = await w.social.postStatus(other, w.member.userId!, {
      type: "doc",
      content: [{ type: "paragraph", content: [mention(w.member.userId!, "Mara")] }],
    });
    await expect.poll(() => w.db.notification.count({ where: { userId: w.member.userId!, targetId: String(own.id) } })).toBe(1);
    // Un comentariu cu mențiune notifică și el.
    await w.social.postStatus(w.member, w.member.userId!, { type: "doc", content: [{ type: "paragraph", content: [mention(mira.id, "Mira")] }] }, status.id);
    await expect.poll(() => w.db.notification.count({ where: { userId: mira.id, type: "forums.mention" } })).toBe(2);
  });

  test("perete FOLLOWED: doar cei urmăriți de proprietar (și staff-ul); NOBODY: doar proprietarul și staff-ul", async () => {
    await setPrivacy(w.member, { wall: "FOLLOWED" });
    await expect(w.social.postStatus(other, w.member.userId!, doc("salut"))).rejects.toBeInstanceOf(GcsForbidden);
    await w.social.postStatus(w.moderator, w.member.userId!, doc("salut de la staff"));
    await w.db.follow.create({ data: { userId: w.member.userId!, contentType: "user", contentId: other.userId! } });
    await w.social.postStatus(other, w.member.userId!, doc("salut"));

    await setPrivacy(w.member, { wall: "NOBODY" });
    await w.clearWallFlood(other);
    await expect(w.social.postStatus(other, w.member.userId!, doc("iar"))).rejects.toBeInstanceOf(GcsForbidden);
    await w.social.postStatus(w.member, w.member.userId!, doc("doar eu"));
  });

  test("cine e ignorat de proprietar nu poate scrie pe peretele lui", async () => {
    await w.social.ignore(w.member, other.userId!, { posts: true, messages: true });
    await expect(w.social.postStatus(other, w.member.userId!, doc("hei"))).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("XSS (Review Focus #5): atributele periculoase din JSON nu ajung în HTML", async () => {
    const evil = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }],
    };
    const status = await w.social.postStatus(other, w.member.userId!, evil).catch(() => null);
    if (status) expect(status.contentHtml).not.toContain("javascript:");
  });

  test("proprietarul ascunde statusul altcuiva; un terț nu poate; doar staff-ul îl restaurează", async () => {
    const third = await w.actorFor(await w.createUser("Third", "member"));
    const status = await w.social.postStatus(other, w.member.userId!, doc("spam"));
    await expect(w.social.hideStatus(third, status.id)).rejects.toBeInstanceOf(GcsForbidden);
    await w.social.hideStatus(w.member, status.id);
    expect(await w.social.canViewStatus(third, status.id)).toBe(false);
    expect(await w.social.canViewStatus(w.moderator, status.id)).toBe(true);
    await expect(w.social.restoreStatus(w.member, status.id)).rejects.toBeInstanceOf(GcsForbidden);
    await w.social.restoreStatus(w.moderator, status.id);
    expect(await w.social.canViewStatus(third, status.id)).toBe(true);
  });

  test("peretele dezactivat din setări → nimeni nu scrie", async () => {
    await w.settings.set("profile.wall_enabled", false, w.root);
    await expect(w.social.postStatus(w.member, w.member.userId!, doc("x"))).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("statusurile primesc reacții (reputație autorului) și pot fi raportate", async () => {
    const status = await w.social.postStatus(other, w.member.userId!, doc("highlight"));
    const like = await w.db.reaction.findUniqueOrThrow({ where: { key: "like" } });
    await w.reactions.react(w.member, { contentType: "profile.status", contentId: String(status.id), reactionId: like.id });
    expect((await w.db.user.findUniqueOrThrow({ where: { id: other.userId! } })).reputation).toBe(1);
    await w.reports.report(w.member, { contentType: "profile.status", contentId: String(status.id), reason: "spam" });
    expect(await w.db.report.count()).toBe(1);
  });
});
