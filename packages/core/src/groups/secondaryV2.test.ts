import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsConflict, GcsForbidden, GcsValidationError } from "../errors";
import type { GcsEvent } from "../events";
import type { GcsActor } from "../permissions/types";
import { GcsOptInGroups } from "./optIn";

let w: GcsTestWorld;
let root: GcsActor;
const day = 86_400_000;

beforeEach(async () => {
  w = await createWorld();
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const row = (userId: string, groupId: number) => w.db.userGroup.findUnique({ where: { userId_groupId: { userId, groupId } } });

describe("grupuri secundare temporare (Membri v2)", () => {
  test("adăugat cu expirare și sursă; din nou = prelungire; „fără expirare” cu null", async () => {
    const ana = await w.createUser("Ana", "member");
    const gold = w.groups.vip_gold!;
    const until = new Date(Date.now() + 30 * day);
    expect(await w.groupService.addSecondary(ana.id, gold, root, { expiresAt: until, source: "store" })).toBe(true);
    expect(await row(ana.id, gold)).toMatchObject({ source: "store", expiresAt: until, addedById: root.userId });

    const later = new Date(Date.now() + 60 * day);
    expect(await w.groupService.addSecondary(ana.id, gold, root, { expiresAt: later })).toBe(true);
    expect(await row(ana.id, gold)).toMatchObject({ source: "store", expiresAt: later });
    // Fără expirare dată: nu se schimbă nimic.
    expect(await w.groupService.addSecondary(ana.id, gold, root)).toBe(false);
    await w.groupService.setSecondaryExpiry(ana.id, gold, null, root);
    expect((await row(ana.id, gold))?.expiresAt).toBeNull();
    expect(await w.db.auditLog.count({ where: { action: "user.secondary_expiry" } })).toBe(2);
  });

  test("o expirare în trecut sau o sursă invalidă → GcsValidationError", async () => {
    const ana = await w.createUser("Ana", "member");
    await expect(w.groupService.addSecondary(ana.id, w.groups.vip_gold!, root, { expiresAt: new Date(Date.now() - 1000) })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.groupService.addSecondary(ana.id, w.groups.vip_gold!, root, { source: "Magazin!" })).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("jobul de expirare scoate doar grupurile expirate, scrie jurnalul și anunță membrul", async () => {
    const events: GcsEvent[] = [];
    w.bus.on("group.secondary_expired", async (e) => void events.push(e));
    const ana = await w.createUser("Ana", "member", ["vip_silver"]);
    const bob = await w.createUser("Bob", "member");
    await w.db.userGroup.createMany({
      data: [
        { userId: ana.id, groupId: w.groups.vip_gold!, expiresAt: new Date(Date.now() - 1000), source: "store" },
        { userId: bob.id, groupId: w.groups.vip_gold!, expiresAt: new Date(Date.now() + day) },
      ],
    });
    const version = (await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } })).permVersion;
    const removed = await w.groupService.expireSecondary();
    expect(removed).toEqual([{ userId: ana.id, groupId: w.groups.vip_gold! }]);
    expect(await row(ana.id, w.groups.vip_gold!)).toBeNull();
    // Grupul permanent și cel care expiră mâine rămân.
    expect(await row(ana.id, w.groups.vip_silver!)).not.toBeNull();
    expect(await row(bob.id, w.groups.vip_gold!)).not.toBeNull();
    expect(events.map((e) => e.payload)).toEqual([expect.objectContaining({ userId: ana.id, groupId: w.groups.vip_gold! })]);
    expect(await w.db.auditLog.count({ where: { action: "user.secondary_expired", targetId: ana.id } })).toBe(1);
    expect((await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } })).permVersion).toBeGreaterThan(version);
    // A doua rulare nu mai găsește nimic.
    expect(await w.groupService.expireSecondary()).toEqual([]);
  });

  test("ultimul Root Admin nu-și pierde accesul Root prin expirare", async () => {
    const solo = await w.createUser("Solo", "member");
    await w.db.user.update({ where: { id: root.userId! }, data: { primaryGroupId: w.groups.member! } });
    await w.db.userGroup.create({ data: { userId: solo.id, groupId: w.groups.root_admin!, expiresAt: new Date(Date.now() - 1000) } });
    expect(await w.groupService.expireSecondary()).toEqual([]);
    expect(await row(solo.id, w.groups.root_admin!)).not.toBeNull();
  });
});

describe("acțiuni în masă pe grupuri (Membri v2)", () => {
  test("adaugă / scoate un secundar și mută grupul principal pentru mai mulți membri", async () => {
    const users = await Promise.all(["A", "B", "C"].map((n) => w.createUser(n, "member")));
    const ids = users.map((u) => u.id);
    const until = new Date(Date.now() + 7 * day);
    expect(await w.groupService.bulk(ids, { kind: "add_secondary", groupId: w.groups.vip_gold!, expiresAt: until }, root)).toEqual({ changed: 3, skipped: 0 });
    expect(await w.db.userGroup.count({ where: { groupId: w.groups.vip_gold!, expiresAt: until } })).toBe(3);
    expect(await w.groupService.bulk(ids.slice(0, 2), { kind: "remove_secondary", groupId: w.groups.vip_gold! }, root)).toEqual({ changed: 2, skipped: 0 });
    expect(await w.db.userGroup.count({ where: { groupId: w.groups.vip_gold! } })).toBe(1);
    expect(await w.groupService.bulk(ids, { kind: "set_primary", groupId: w.groups.vip_silver! }, root)).toEqual({ changed: 3, skipped: 0 });
    expect(await w.db.user.count({ where: { id: { in: ids }, primaryGroupId: w.groups.vip_silver! } })).toBe(3);
  });

  test("un admin (nu Root) nu atinge un Root Admin: e numărat la „sărite”", async () => {
    await w.grantAdmin(["members.groups"]);
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    const ana = await w.createUser("Ana", "member");
    expect(await w.groupService.bulk([ana.id, root.userId!], { kind: "add_secondary", groupId: w.groups.vip_gold! }, admin)).toEqual({ changed: 1, skipped: 1 });
  });

  test("fără membri sau peste limită → GcsValidationError; fără drept ACP → GcsForbidden", async () => {
    await expect(w.groupService.bulk([], { kind: "remove_secondary", groupId: w.groups.vip_gold! }, root)).rejects.toBeInstanceOf(GcsValidationError);
    const member = await w.actorFor(await w.createUser("Membru", "member"));
    await expect(w.groupService.bulk([member.userId!], { kind: "remove_secondary", groupId: w.groups.vip_gold! }, member)).rejects.toBeInstanceOf(GcsForbidden);
  });
});

describe("grupuri publice (opt-in)", () => {
  let optIn: GcsOptInGroups;
  let club: number;

  beforeEach(async () => {
    optIn = new GcsOptInGroups({ db: w.db, bus: w.bus, permissions: w.permissions });
    club = (await w.groupService.create({ name: "Clubul CS" }, root)).id;
  });

  test("doar un grup eligibil poate deveni public: nu staff, nu VIP, nu protejat", async () => {
    await w.groupService.update(club, { optIn: true }, root);
    await expect(w.groupService.update(w.groups.vip_gold!, { optIn: true }, root)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.groupService.update(w.groups.member!, { optIn: true }, root)).rejects.toBeInstanceOf(GcsValidationError);
    const staff = (await w.groupService.create({ name: "Echipa" }, root)).id;
    await w.groupService.setSetting(staff, "acp.access", true, root);
    await expect(w.groupService.update(staff, { optIn: true }, root)).rejects.toMatchObject({ fields: { optIn: "group_staff" } });
  });

  test("membrul intră și iese singur; un grup dat de staff nu se părăsește de aici", async () => {
    await w.groupService.update(club, { optIn: true }, root);
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    expect((await optIn.list(ana.userId!)).map((g) => [g.name, g.joined])).toEqual([["Clubul CS", false]]);

    await optIn.join(ana, club);
    expect(await row(ana.userId!, club)).toMatchObject({ source: "optin" });
    expect((await optIn.list(ana.userId!))[0]).toMatchObject({ joined: true, canLeave: true });
    await expect(optIn.join(ana, club)).rejects.toBeInstanceOf(GcsConflict);
    await optIn.leave(ana, club);
    expect(await row(ana.userId!, club)).toBeNull();

    await w.groupService.addSecondary(ana.userId!, club, root);
    expect((await optIn.list(ana.userId!))[0]).toMatchObject({ joined: true, canLeave: false });
    await expect(optIn.leave(ana, club)).rejects.toMatchObject({ params: { reason: "assigned_group" } });
  });

  test("un grup nepublic, un vizitator sau un banat nu pot intra", async () => {
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    await expect(optIn.join(ana, club)).rejects.toBeInstanceOf(GcsForbidden);
    await w.groupService.update(club, { optIn: true }, root);
    await expect(optIn.join({ ...ana, isBanned: true }, club)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(optIn.join({ ...ana, userId: null }, club)).rejects.toBeInstanceOf(GcsForbidden);
    // Grupul devenit staff între timp nu mai primește membri și dispare din listă.
    await w.groupService.setSetting(club, "acp.access", true, root);
    await expect(optIn.join(ana, club)).rejects.toBeInstanceOf(GcsForbidden);
    expect(await optIn.list(ana.userId!)).toEqual([]);
  });
});
