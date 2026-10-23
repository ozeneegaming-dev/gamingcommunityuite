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
  w.kv.disconnect();
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

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string, marks?: unknown[]) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });

describe("câmpurile „Text lung” formatate cu editorul", () => {
  const about = () => w.db.profileField.create({ data: { key: "about", label: "Despre mine", type: "TEXTAREA", section: "ABOUT", maxLength: 40, position: 9 } });
  const aboutOf = async (viewer: GcsActor) => (await w.profiles.visibleFields(viewer, w.member.userId!)).find((f) => f.key === "about");

  test("documentul se validează și se randează; textul simplu rămâne pentru postbit și card", async () => {
    await about();
    const content = doc(p(text("Joc "), text("CS2", [{ type: "bold" }, { type: "textStyle", attrs: { color: "#3DDC97" } }])), p(text("seara")));
    await w.profiles.updateFields(w.member, w.member.userId!, { about: content });
    expect(await aboutOf(w.guest)).toMatchObject({ value: "Joc CS2\nseara", html: '<p>Joc <strong><span style="color:#3DDC97">CS2</span></strong></p><p>seara</p>' });
    const row = await w.db.profileFieldValue.findFirstOrThrow({ where: { userId: w.member.userId!, field: { key: "about" } } });
    expect(row.json).toEqual(content);
  });

  test("valorile vechi (text simplu) se afișează ca paragrafe; un text simplu nou șterge formatarea veche", async () => {
    const field = await about();
    await w.db.profileFieldValue.create({ data: { userId: w.member.userId!, fieldId: field.id, value: "Rândul 1\nRândul <2>" } });
    expect((await aboutOf(w.guest))?.html).toBe("<p>Rândul 1</p><p>Rândul &lt;2&gt;</p>");

    await w.profiles.updateFields(w.member, w.member.userId!, { about: doc(p(text("formatat", [{ type: "italic" }]))) });
    await w.profiles.updateFields(w.member, w.member.userId!, { about: "simplu" });
    const row = await w.db.profileFieldValue.findFirstOrThrow({ where: { userId: w.member.userId!, fieldId: field.id } });
    expect({ value: row.value, json: row.json, html: row.html }).toEqual({ value: "simplu", json: null, html: "" });
    expect((await aboutOf(w.guest))?.html).toBe("<p>simplu</p>");
  });

  test("refuză linkurile javascript:, imaginile, titlurile, documentele în câmpuri simple și textul peste limită", async () => {
    await about();
    const fails = (value: unknown, key = "about") => w.profiles.updateFields(w.member, w.member.userId!, { [key]: value }).catch((e: unknown) => (e as GcsValidationError).fields);
    expect(await fails(doc(p(text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))))).toEqual({ about: "invalid" });
    expect(await fails(doc({ type: "image", attrs: { src: "https://cdn.example/a.png" } }))).toEqual({ about: "format_not_allowed" });
    expect(await fails(doc({ type: "heading", attrs: { level: 2 }, content: [text("Titlu")] }))).toEqual({ about: "format_not_allowed" });
    expect(await fails(doc(p(text("x".repeat(41)))))).toEqual({ about: "too_long" });
    expect(await fails({ type: "html", html: "<script>alert(1)</script>" })).toEqual({ about: "invalid" });
    expect(await fails(doc(p(text("România"))), "country")).toEqual({ country: "invalid" });
    expect(await w.db.profileFieldValue.count({ where: { field: { key: "about" } } })).toBe(0);
  });
});

describe("semnătura", () => {
  const signature = () => w.db.user.findUniqueOrThrow({ where: { id: w.member.userId! }, select: { signatureJson: true, signatureHtml: true } });

  test("se salvează formatată, cu o imagine din adresă; video, atașamentele și scripturile sunt refuzate; null o șterge", async () => {
    await w.profiles.saveSignature(w.member, doc(p(text("GG", [{ type: "textStyle", attrs: { color: "#FF6B74", fontSize: "18px" } }])), { type: "image", attrs: { src: "https://cdn.example/clan.png" } }));
    expect((await signature()).signatureHtml).toBe('<p><span style="color:#FF6B74;font-size:18px">GG</span></p><img class="gcs-postImage" src="https://cdn.example/clan.png" alt="" loading="lazy" />');

    const fails = (content: unknown) => w.profiles.saveSignature(w.member, content).catch((e: unknown) => (e as GcsValidationError).fields);
    expect(await fails(doc({ type: "embed", attrs: { url: "https://youtu.be/dQw4w9WgXcQ" } }))).toEqual({ content: "format_not_allowed" });
    expect(await fails(doc({ type: "image", attrs: { attachmentId: "att_1" } }))).toEqual({ content: "format_not_allowed" });
    expect(await fails(doc(p(text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))))).toEqual({ content: "invalid" });
    expect((await signature()).signatureHtml).toContain("GG");

    await w.profiles.saveSignature(w.member, null);
    expect(await signature()).toEqual({ signatureJson: null, signatureHtml: "" });
  });

  test("limitele: setarea site-ului și a grupului (cea mai strictă), imaginile; 0 / fără valoare = interzisă", async () => {
    // Membru: 300 din setarea grupului (site-ul: 500).
    expect(await w.profiles.signatureLimits(w.member)).toEqual({ maxChars: 300, maxImages: 1 });
    expect(await w.profiles.saveSignature(w.member, "x".repeat(301)).catch((e: unknown) => [(e as GcsValidationError).fields, (e as GcsValidationError).params])).toEqual([{ content: "too_long" }, { max: "300" }]);
    await w.settings.set("profile.signature_max_chars", 100, w.root);
    await w.settings.set("profile.signature_max_images", 0, w.root);
    expect(await w.profiles.signatureLimits(w.member)).toEqual({ maxChars: 100, maxImages: 0 });
    expect(await w.profiles.saveSignature(w.member, doc({ type: "image", attrs: { src: "https://cdn.example/a.png" } })).catch((e: unknown) => (e as GcsValidationError).fields)).toEqual({ content: "too_many_images" });
    // Root Admin: nelimitat în grup, deci limita site-ului.
    expect((await w.profiles.signatureLimits(w.root)).maxChars).toBe(100);
    // Membru nou: grupul nu are valoare (= interzis).
    const fresh = await w.actorFor(await w.createUser("Nou", "new_member"));
    expect((await w.profiles.signatureLimits(fresh)).maxChars).toBe(0);
    await expect(w.profiles.saveSignature(fresh, "salut")).rejects.toMatchObject({ fields: { content: "signature_disabled" } });
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
