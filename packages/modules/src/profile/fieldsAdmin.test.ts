import { GcsForbidden, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import type { GcsProfileFieldInput } from "./fieldsAdmin";

let w: GcsProfileWorld;
let admin: GcsActor;

beforeEach(async () => {
  w = await createProfileWorld();
  await w.grantAdmin(["members.profiles"]);
  admin = await w.actorFor(await w.createUser("Admin", "admin"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const input = (patch: Partial<GcsProfileFieldInput> = {}): GcsProfileFieldInput => ({
  key: "discord_tag",
  label: "Discord tag",
  type: "TEXT",
  options: [],
  section: "GAMES",
  required: false,
  maxLength: 40,
  visibility: "MEMBERS",
  showOnCard: false,
  position: 5,
  ...patch,
});

describe("GcsProfileFieldAdmin", () => {
  test("creează un câmp care apare doar membrilor logați; un SELECT cere cel puțin 2 opțiuni", async () => {
    await w.profileFields.save(admin, null, input());
    await w.profiles.updateFields(w.member, w.member.userId!, { discord_tag: "mara#1234" });
    expect((await w.profiles.visibleFields(w.guest, w.member.userId!)).map((f) => f.key)).toEqual([]);
    expect((await w.profiles.visibleFields(w.moderator, w.member.userId!)).map((f) => f.key)).toEqual(["discord_tag"]);
    await expect(w.profileFields.save(admin, null, input({ key: "rank_cs2", type: "SELECT", options: ["Gold"] }))).rejects.toMatchObject({ fields: { options: "two_required" } });
  });

  test("cheie duplicată sau invalidă → eroare; un membru nu poate edita; ștergerea intră în jurnal", async () => {
    await expect(w.profileFields.save(admin, null, input({ key: "country" }))).rejects.toMatchObject({ fields: { key: "taken" } });
    await expect(w.profileFields.save(admin, null, input({ key: "Bad Key" }))).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.profileFields.save(w.member, null, input())).rejects.toBeInstanceOf(GcsForbidden);
    const f = await w.profileFields.save(admin, null, input());
    await w.profileFields.delete(admin, f.id);
    expect(await w.db.auditLog.count({ where: { action: "profile_field.delete" } })).toBe(1);
  });
});

describe("grupurile câmpurilor (profil gaming v2)", () => {
  test("un grup nou cu text de ajutor; cheia rămâne la editare; ștersul lasă câmpurile fără grup", async () => {
    const g = await w.profileFields.saveGroup(admin, null, { key: "stream", label: "Stream", helper: "  Unde transmiți   live. ", icon: "fa-solid fa-video", position: 9 });
    expect(g).toMatchObject({ key: "stream", helper: "Unde transmiți live.", position: 9 });
    const edited = await w.profileFields.saveGroup(admin, g.id, { key: "altceva", label: "Streaming", helper: "", position: 3 });
    expect(edited).toMatchObject({ key: "stream", label: "Streaming", position: 3 });
    const f = await w.profileFields.save(admin, null, input({ key: "kick", groupId: g.id, helper: "Canalul tău", linkTemplate: "https://kick.com/{handle}" }));
    expect(f).toMatchObject({ groupId: g.id, helper: "Canalul tău", linkTemplate: "https://kick.com/{handle}" });
    await w.profileFields.deleteGroup(admin, g.id);
    expect((await w.db.profileField.findUniqueOrThrow({ where: { id: f.id } })).groupId).toBeNull();
    await expect(w.profileFields.saveGroup(w.member, null, { key: "x1", label: "X", helper: "", position: 0 })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.profileFields.saveGroup(admin, null, { key: "contact", label: "Dublură", helper: "", position: 0 })).rejects.toMatchObject({ fields: { key: "taken" } });
  });

  test("șablonul de contact: doar https cu {handle}, doar la „Text”; grupul trebuie să existe", async () => {
    await expect(w.profileFields.save(admin, null, input({ linkTemplate: "javascript:{handle}" }))).rejects.toMatchObject({ fields: { linkTemplate: "invalid_link_template" } });
    await expect(w.profileFields.save(admin, null, input({ type: "URL", linkTemplate: "https://a.ro/{handle}" }))).rejects.toMatchObject({ fields: { linkTemplate: "invalid_link_template" } });
    await expect(w.profileFields.save(admin, null, input({ groupId: 999_999 }))).rejects.toMatchObject({ fields: { groupId: "invalid_choice" } });
  });

  test("contactul: membrul scrie doar handle-ul (sau @handle / linkul copiat); profilul primește linkul construit", async () => {
    await w.profiles.updateFields(w.member, w.member.userId!, { contact_tiktok: "@gamer.ro", contact_x: "https://x.com/GcsNews" });
    const fields = await w.profiles.visibleFields(w.guest, w.member.userId!);
    expect(fields.filter((f) => f.key.startsWith("contact_")).map((f) => [f.key, f.value, f.link])).toEqual([
      ["contact_tiktok", "gamer.ro", "https://www.tiktok.com/@gamer.ro"],
      ["contact_x", "GcsNews", "https://x.com/GcsNews"],
    ]);
    await expect(w.profiles.updateFields(w.member, w.member.userId!, { contact_x: "două cuvinte" })).rejects.toMatchObject({ fields: { contact_x: "invalid_handle" } });
  });

  test("„Server preferat”: doar unul dintre serverele active ale comunității", async () => {
    await w.db.gameServer.create({ data: { game: "cs16", host: "127.0.0.1", port: 27015, name: "Public #1", slug: "public-1" } });
    await w.db.gameServer.create({ data: { game: "cs16", host: "127.0.0.1", port: 27016, name: "Închis", slug: "inchis", enabled: false } });
    expect(await w.profiles.serverOptions()).toEqual(["Public #1"]);
    await w.profiles.updateFields(w.member, w.member.userId!, { favorite_server: "Public #1" });
    await expect(w.profiles.updateFields(w.member, w.member.userId!, { favorite_server: "Închis" })).rejects.toMatchObject({ fields: { favorite_server: "invalid_choice" } });
  });

  test("ziua de naștere fără an (MM-DD) se salvează fără an afișat; cu an, anul se arată doar la cerere", async () => {
    await w.profiles.setBirthday(w.member, { date: "02-29", visible: true, showYear: true });
    expect(await w.db.user.findUniqueOrThrow({ where: { id: w.member.userId! }, select: { birthday: true, birthdayShowYear: true } })).toEqual({ birthday: new Date("1904-02-29T00:00:00Z"), birthdayShowYear: false });
    await w.profiles.setBirthday(w.member, { date: "1999-05-03", visible: true, showYear: true });
    expect((await w.db.user.findUniqueOrThrow({ where: { id: w.member.userId! } })).birthdayShowYear).toBe(true);
    await expect(w.profiles.setBirthday(w.member, { date: "13-40", visible: true })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.profiles.setBirthday(w.member, { date: "1904-01-01", visible: true })).rejects.toBeInstanceOf(GcsValidationError);
  });
});
