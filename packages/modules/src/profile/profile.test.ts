import { GcsForbidden, GcsNotFound, GcsValidationError, type GcsActor } from "@gcs/core";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";

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

async function gif(): Promise<Buffer> {
  const frame = (color: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
  return sharp([await frame("#FF0000"), await frame("#00FF00")], { join: { animated: true } }).gif().toBuffer();
}

const owner = (actor: GcsActor) => w.db.user.findUniqueOrThrow({ where: { id: actor.userId! } });

describe("câmpurile de profil", () => {
  test("se salvează și se validează după tip; un URL `javascript:` e refuzat", async () => {
    await w.profiles.updateFields(w.member, w.member.userId!, { country: "România", platform: "PC", twitch: "https://twitch.tv/mara" });
    expect((await w.profiles.visibleFields(w.guest, w.member.userId!)).map((f) => [f.key, f.value])).toEqual([
      ["country", "România"],
      ["platform", "PC"],
      ["twitch", "https://twitch.tv/mara"],
    ]);
    const err = await w.profiles.updateFields(w.member, w.member.userId!, { twitch: "javascript:alert(1)", platform: "Amiga" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GcsValidationError);
    expect((err as GcsValidationError).fields).toEqual({ twitch: "invalid_url", platform: "invalid_choice" });
  });

  test("o valoare goală șterge câmpul; un câmp obligatoriu nu poate rămâne gol", async () => {
    await w.profiles.updateFields(w.member, w.member.userId!, { country: "România" });
    await w.profiles.updateFields(w.member, w.member.userId!, { country: "" });
    expect(await w.profiles.visibleFields(w.member, w.member.userId!)).toEqual([]);
    await w.db.profileField.update({ where: { key: "platform" }, data: { required: true } });
    await expect(w.profiles.updateFields(w.member, w.member.userId!, { country: "Moldova" })).rejects.toMatchObject({ fields: { platform: "required" } });
  });

  test("un câmp STAFF e vizibil proprietarului și staff-ului, nu altor membri; MEMBERS nu e vizibil vizitatorilor", async () => {
    await w.db.profileField.update({ where: { key: "country" }, data: { visibility: "STAFF" } });
    await w.db.profileField.update({ where: { key: "platform" }, data: { visibility: "MEMBERS" } });
    await w.profiles.updateFields(w.member, w.member.userId!, { country: "România", platform: "PC" });
    const keys = async (viewer: GcsActor) => (await w.profiles.visibleFields(viewer, w.member.userId!)).map((f) => f.key);
    expect(await keys(w.member)).toEqual(["country", "platform"]);
    expect(await keys(w.moderator)).toEqual(["country", "platform"]);
    expect(await keys(other)).toEqual(["platform"]);
    expect(await keys(w.guest)).toEqual([]);
  });

  test("un membru nu poate edita profilul altuia; moderatorul poate, iar edita intră în jurnal", async () => {
    await expect(w.profiles.updateFields(other, w.member.userId!, { country: "X" })).rejects.toBeInstanceOf(GcsForbidden);
    await w.profiles.updateFields(w.moderator, w.member.userId!, { country: "România" });
    expect(await w.db.auditLog.count({ where: { action: "profile.fields", targetId: w.member.userId! } })).toBe(1);
  });
});

describe("bio, accent, avatar, cover", () => {
  test("accentul acceptă doar #RRGGBB; bio-ul are maximum 160 de caractere", async () => {
    await w.profiles.setAccent(w.member, "#B794FF");
    expect((await owner(w.member)).accentColor).toBe("#B794FF");
    await expect(w.profiles.setAccent(w.member, "red;}body{")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.profiles.updateBio(w.member, w.member.userId!, "x".repeat(161))).rejects.toBeInstanceOf(GcsValidationError);
    await w.profiles.updateBio(w.member, w.member.userId!, "  Nu există lag,\n doar skill issue.  ");
    expect((await owner(w.member)).bio).toBe("Nu există lag, doar skill issue.");
  });

  test("cover GIF fără `profile.animated_cover` devine static; un VIP Gold îl păstrează animat", async () => {
    const vip = await w.actorFor(await w.createUser("Shadow", "vip_gold"));
    await w.profiles.setCover(w.member, { name: "c.gif", bytes: await gif() });
    await w.profiles.setCover(vip, { name: "c.gif", bytes: await gif() }, 30);
    const pages = async (actor: GcsActor) => {
      const u = await owner(actor);
      const file = await w.attachments.open(w.guest, u.coverAttachmentId!);
      const chunks: Uint8Array[] = [];
      for await (const c of file.body as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
      return (await sharp(Buffer.concat(chunks)).metadata()).pages ?? 1;
    };
    expect(await pages(w.member)).toBe(1);
    expect(await pages(vip)).toBe(2);
    expect((await owner(vip)).coverPositionY).toBe(30);
  });

  test("fără `profile.cover` nu se poate pune cover; staff-ul poate reseta avatarul altcuiva", async () => {
    await w.db.groupSetting.updateMany({ where: { groupId: w.groups.member!, key: "profile.cover" }, data: { value: false } });
    await w.permissions.bumpVersion();
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#123456" } }).png().toBuffer();
    await expect(w.profiles.setCover(w.member, { name: "c.png", bytes: png })).rejects.toBeInstanceOf(GcsForbidden);

    await w.profiles.setAvatar(w.member, { name: "a.png", bytes: png });
    expect((await owner(w.member)).image).toMatch(/^\/files\//);
    await expect(w.profiles.resetAvatar(other, w.member.userId!)).rejects.toBeInstanceOf(GcsForbidden);
    await w.profiles.resetAvatar(w.moderator, w.member.userId!);
    expect((await owner(w.member)).image).toBeNull();
    expect(await w.db.attachment.count({ where: { contentType: "user.avatar" } })).toBe(0);
  });
});

describe("confidențialitate (Review Focus #3)", () => {
  const set = (actor: GcsActor, profile: string) =>
    w.profiles.updatePrivacy(actor, { profile, messages: "MEMBERS", wall: "MEMBERS", showOnline: true });

  test("PUBLIC: toți; MEMBERS: nu și vizitatorii; FOLLOWED: doar cei urmăriți de proprietar și staff-ul", async () => {
    const view = async (viewer: GcsActor) => w.profiles.canView(viewer, await owner(w.member));
    expect(await view(w.guest)).toBe(true);

    await set(w.member, "MEMBERS");
    expect(await view(w.guest)).toBe(false);
    expect(await view(other)).toBe(true);

    await set(w.member, "FOLLOWED");
    expect(await view(other)).toBe(false);
    expect(await view(w.moderator)).toBe(true);
    expect(await view(w.member)).toBe(true);
    await w.db.follow.create({ data: { userId: w.member.userId!, contentType: "user", contentId: other.userId! } });
    expect(await view(other)).toBe(true);
  });

  test("o confidențialitate invalidă e refuzată; valorile lipsă din baza veche devin cele implicite", async () => {
    await expect(set(w.member, "EVERYONE")).rejects.toBeInstanceOf(GcsValidationError);
    expect(await w.profiles.privacyOf(w.member.userId!)).toEqual({ profile: "PUBLIC", messages: "MEMBERS", wall: "MEMBERS", showOnline: true });
  });
});

describe("schimbarea emailului", () => {
  test("cere confirmare: emailul vechi rămâne până la click pe link, iar linkul e de unică folosință", async () => {
    const before = (await owner(w.member)).email;
    await w.profiles.requestEmailChange(w.member, "  Mara.Noua@Example.com ");
    expect((await owner(w.member)).email).toBe(before);
    expect(w.outbox).toHaveLength(1);
    expect(w.outbox[0]!.to).toBe("mara.noua@example.com");
    const token = /token=([A-Za-z0-9_-]+)/.exec(w.outbox[0]!.html)![1]!;

    expect(await w.profiles.confirmEmailChange(token)).toBe(w.member.userId);
    expect(await owner(w.member)).toMatchObject({ email: "mara.noua@example.com", emailVerified: true });
    await expect(w.profiles.confirmEmailChange(token)).rejects.toBeInstanceOf(GcsNotFound);
  });

  test("un email folosit de alt cont sau placeholder-ul Steam e refuzat", async () => {
    const taken = (await owner(other)).email;
    await expect(w.profiles.requestEmailChange(w.member, taken)).rejects.toMatchObject({ fields: { email: "taken" } });
    await expect(w.profiles.requestEmailChange(w.member, "76561198000000000@steam.invalid")).rejects.toMatchObject({ fields: { email: "invalid_email" } });
  });
});
