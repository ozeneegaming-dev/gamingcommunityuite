import { GcsForbidden, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsMemberList } from "./members";
import { GcsStaffPage } from "./staffPage";

let w: GcsProfileWorld;
let staff: GcsStaffPage;
let root: GcsActor;

beforeEach(async () => {
  w = await createProfileWorld();
  const members = new GcsMemberList({ db: w.db, permissions: w.permissions, ranks: w.ranks });
  staff = new GcsStaffPage({ db: w.db, bus: w.bus, acp: w.acp, permissions: w.permissions, members });
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("GcsStaffPage", () => {
  test("secțiunile implicite: grupurile de staff cu membri, în ordinea grupurilor, aspect detaliat", async () => {
    const sections = await staff.sections(w.member);
    expect(sections.map((s) => s.key)).toEqual(expect.arrayContaining(["root_admin", "moderator"]));
    expect(sections.every((s) => s.members.length > 0)).toBe(true);
    const positions = await w.db.group.findMany({ where: { key: { in: sections.map((s) => s.key) } }, orderBy: { position: "asc" }, select: { key: true } });
    expect(sections.map((s) => s.key)).toEqual(positions.map((g) => g.key));
    const mods = sections.find((s) => s.key === "moderator")!;
    expect(mods).toMatchObject({ title: mods.name, layout: "detailed", enabled: true });
    expect(mods.members.map((m) => m.name)).toEqual(["NeoX"]);
    // Editorul vede și grupurile de staff fără membri.
    expect((await staff.editor(root)).map((s) => s.key)).toEqual(expect.arrayContaining(["admin", "super_moderator"]));
  });

  test("ordinea, titlul benzii, aspectul și ascunderea unei secțiuni se salvează din ACP", async () => {
    await staff.saveSections(root, [
      { groupId: w.groups.moderator!, title: "Echipa de moderare", layout: "compact", enabled: true },
      { groupId: w.groups.root_admin!, title: null, layout: "detailed", enabled: true },
    ]);
    let sections = await staff.sections(w.member);
    expect(sections.slice(0, 2).map((s) => [s.key, s.title, s.layout])).toEqual([
      ["moderator", "Echipa de moderare", "compact"],
      ["root_admin", sections[1]!.name, "detailed"],
    ]);
    await staff.saveSections(root, [{ groupId: w.groups.moderator!, title: null, layout: "compact", enabled: false }]);
    sections = await staff.sections(w.member);
    expect(sections.map((s) => s.key)).not.toContain("moderator");
    expect(sections.map((s) => s.key)).toContain("root_admin");
    expect(await w.db.auditLog.count({ where: { action: "staff.sections" } })).toBe(2);
  });

  test("un grup care nu e de staff sau un aspect necunoscut → GcsValidationError; fără drept → GcsForbidden", async () => {
    await expect(staff.saveSections(root, [{ groupId: w.groups.member!, title: null, layout: "detailed", enabled: true }])).rejects.toBeInstanceOf(GcsValidationError);
    await expect(staff.saveSections(root, [{ groupId: w.groups.moderator!, title: null, layout: "grid" as never, enabled: true }])).rejects.toBeInstanceOf(GcsValidationError);
    await expect(staff.saveSections(w.member, [])).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("descrierea formatată, responsabilitățile, contactele din conturile legate și ordinea membrilor", async () => {
    const neo = w.moderator.userId!;
    const second = await w.createUser("Alfa", "moderator");
    await staff.saveProfile(root, neo, { description: doc("Moderez secțiunea CS 1.6."), duties: ["Reclamații", "  ", "Ban-uri"] });
    await w.db.account.createMany({
      data: [
        { userId: neo, accountId: "76561198000000001", providerId: "steam" },
        { userId: neo, accountId: "123456789012345678", providerId: "discord" },
      ],
    });
    let mods = (await staff.sections(w.member)).find((s) => s.key === "moderator")!;
    expect(mods.members.map((m) => m.name)).toEqual(["Alfa", "NeoX"]);
    const card = mods.members.find((m) => m.id === neo)!;
    expect(card.descriptionHtml).toContain("Moderez secțiunea CS 1.6.");
    expect(card.duties).toEqual(["Reclamații", "Ban-uri"]);
    expect(card.contacts.map((c) => [c.kind, c.href])).toEqual([
      ["steam", "https://steamcommunity.com/profiles/76561198000000001"],
      ["discord", "https://discord.com/users/123456789012345678"],
    ]);

    await staff.reorderMembers(root, w.groups.moderator!, [neo, second.id]);
    mods = (await staff.sections(w.member)).find((s) => s.key === "moderator")!;
    expect(mods.members.map((m) => m.name)).toEqual(["NeoX", "Alfa"]);
    await expect(staff.reorderMembers(root, w.groups.moderator!, [neo])).resolves.toBeUndefined();
    await expect(staff.reorderMembers(root, w.groups.moderator!, [w.member.userId!])).rejects.toBeInstanceOf(GcsValidationError);
    await expect(staff.saveProfile(root, neo, { description: null, duties: Array.from({ length: 13 }, (_, i) => `d${i}`) })).rejects.toBeInstanceOf(GcsValidationError);
  });
});
