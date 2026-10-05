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
  w.redis.disconnect();
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
