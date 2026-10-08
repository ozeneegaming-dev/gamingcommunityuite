import { GcsForbidden } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createClanWorld, type GcsClanWorld } from "../../test/clanWorld";

let w: GcsClanWorld;

beforeEach(async () => {
  w = await createClanWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("directorul și pagina clanului", () => {
  test("căutarea după tag sau nume, sortarea și filtrul pe recrutare; doar cu `clans.view`", async () => {
    const a = await w.activeClan({ tag: "RLX", name: "Red Lynx", joinMode: "OPEN" });
    const b = await w.activeClan({ tag: "NVX", name: "Nova X", joinMode: "REQUEST" });
    await w.clans.join(await w.user("Ana"), a.id);
    await w.clans.recompute(w.root);
    const tags = async (q: Parameters<GcsClanWorld["clanQueries"]["directory"]>[1]) => (await w.clanQueries.directory(w.guest, q)).clans.map((c) => c.tag);
    expect(await tags({})).toEqual(["RLX", "NVX"]);
    expect(await tags({ sort: "newest" })).toEqual(["NVX", "RLX"]);
    expect(await tags({ q: "lynx" })).toEqual(["RLX"]);
    expect(await tags({ q: "nv" })).toEqual(["NVX"]);
    expect(await tags({ join: "request" })).toEqual(["NVX"]);
    const card = (await w.clanQueries.directory(w.guest, {})).clans[0]!;
    expect(card).toMatchObject({ href: `/clans/${a.id}-red-lynx`, membersCount: 2, rank: 1, ink: "#FFFFFF" });
    await w.groupService.setSetting(w.groups.guest!, "clans.view", false, w.root);
    await expect(w.clanQueries.directory(w.guest, {})).rejects.toBeInstanceOf(GcsForbidden);
    expect(await w.clanQueries.details(w.guest, b.id)).toBeNull();
  });

  test("pagina: membrii pe roluri, activitatea publică (fără excluderi), butoanele după viewer", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "REQUEST" });
    const ana = await w.user("Ana");
    const bob = await w.user("Bob");
    await w.clans.request(ana, id, "");
    const pending = await w.clanQueries.details(ana, id);
    expect(pending!.viewer).toMatchObject({ role: null, pendingRequest: true, canRequest: false, canManage: false });
    const request = await w.db.clanRequest.findFirstOrThrow({ where: { userId: ana.userId! } });
    await w.clans.decideRequest(leader, request.id, true);
    await w.clans.setRole(leader, id, ana.userId!, "OFFICER");
    await w.clans.request(bob, id, "");
    const bobRequest = await w.db.clanRequest.findFirstOrThrow({ where: { userId: bob.userId! } });
    await w.clans.decideRequest(ana, bobRequest.id, true);
    await w.option("clans.leave_cooldown_hours", 0);
    await w.clans.kick(leader, id, bob.userId!);

    const view = await w.clanQueries.details(w.member, id);
    expect(view!.members.map((m) => [m.user.name, m.role])).toEqual([
      [expect.stringMatching(/^Lider/), "LEADER"],
      ["Ana", "OFFICER"],
    ]);
    // Excluderea lui Bob nu apare; intrarea lui, da.
    expect(view!.activity.map((a) => [a.kind, a.user?.name ?? null])).toEqual([
      ["joined", "Bob"],
      ["promoted", "Ana"],
      ["joined", "Ana"],
      ["created", expect.stringMatching(/^Lider/)],
    ]);
    expect(view!.viewer).toMatchObject({ canRequest: true, canManage: false });
    expect((await w.clanQueries.details(ana, id))!.viewer).toMatchObject({ role: "OFFICER", canManage: true });
    // Administrarea: drepturile implicite ale ofițerilor sunt invitațiile și cererile.
    const manage = await w.clanQueries.manage(ana, id);
    expect(manage!.access.can).toMatchObject({ invite: true, requests: true, members: false, edit: false });
    expect(await w.clanQueries.manage(w.member, id)).toBeNull();
  });
});

describe("tagurile lângă nume și profilul", () => {
  test("un singur tag (rolul cel mai mare), doar în locurile alese în opțiuni; profilul arată toate clanurile", async () => {
    await w.option("clans.max_per_member", 3);
    const a = await w.activeClan({ tag: "AAA", joinMode: "OPEN" });
    const b = await w.activeClan({ tag: "BBB", joinMode: "OPEN" });
    const ana = await w.user("Ana");
    await w.clans.join(ana, a.id);
    await w.clans.join(ana, b.id);
    await w.clans.setRole(b.leader, b.id, ana.userId!, "OFFICER");
    const tags = await w.clanQueries.tagsFor([ana.userId!, a.leader.userId!, w.member.userId!], "postbit");
    expect(tags.get(ana.userId!)).toMatchObject({ tag: "BBB", role: "OFFICER" });
    expect(tags.get(a.leader.userId!)).toMatchObject({ tag: "AAA", role: "LEADER" });
    expect(tags.has(w.member.userId!)).toBe(false);
    const profile = await w.clanQueries.memberClans(ana.userId!);
    expect(profile.clans.map((c) => c.tag)).toEqual(["BBB", "AAA"]);
    expect(profile).toMatchObject({ badge: true, tagOnName: true });

    await w.option("clans.tag_places", ["hovercard"]);
    expect((await w.clanQueries.tagsFor([ana.userId!], "postbit")).size).toBe(0);
    expect((await w.clanQueries.tagsFor([ana.userId!], "hovercard")).size).toBe(1);
    expect((await w.clanQueries.memberClans(ana.userId!)).tagOnName).toBe(false);
    // Un clan arhivat nu mai dă tag.
    await w.clans.archive(w.root, b.id);
    expect((await w.clanQueries.tagsFor([ana.userId!], "hovercard")).get(ana.userId!)).toMatchObject({ tag: "AAA" });
  });

  test("widget-ul „Top clanuri” (cache pe tag-ul `clans`) și invitațiile din director", async () => {
    const a = await w.activeClan({ tag: "TOP", joinMode: "INVITE" });
    expect((await w.clanQueries.top(5)).map((c) => c.tag)).toEqual(["TOP"]);
    const b = await w.activeClan({ tag: "SEC" });
    // Schimbările invalidează cache-ul widget-ului.
    expect((await w.clanQueries.top(5)).map((c) => c.tag)).toEqual(["TOP", "SEC"]);
    const ana = await w.user("Ana");
    await w.clans.invite(a.leader, a.id, "Ana");
    expect((await w.clanQueries.invitations(ana)).map((i) => i.clan.tag)).toEqual(["TOP"]);
    expect(b.id).toBeGreaterThan(a.id);
  });
});

describe("ACP", () => {
  test("lista pe stări cu numerele; fișa cu jurnalul; opțiunile validate împreună", async () => {
    const vip = await w.user("Fondatorul", "vip_gold");
    const pending = await w.clans.create(vip, w.input({ tag: "PND" }));
    const active = await w.activeClan({ tag: "ACT" });
    await w.clans.setLocked(w.root, active.id, true);
    const list = await w.clanAdmin.list(w.root, { filter: "pending" });
    expect(list.rows.map((r) => r.tag)).toEqual(["PND"]);
    expect(list.counts).toMatchObject({ pending: 1, active: 1, locked: 1, all: 2 });
    await expect(w.clanAdmin.list(w.member, { filter: "all" })).rejects.toBeInstanceOf(GcsForbidden);
    const detail = await w.clanAdmin.detail(w.root, active.id);
    expect(detail!.audit.map((a) => a.action)).toEqual(["clans.lock", "clans.create"]);
    expect(pending.status).toBe("PENDING");

    await expect(w.clanAdmin.saveOptions(w.root, { "clans.tag_min": 6, "clans.tag_max": 3 })).rejects.toMatchObject({ fields: { "clans.tag_max": "tag_range" } });
    await expect(w.clanAdmin.saveOptions(w.root, { "clans.forum_parent": 99999 })).rejects.toMatchObject({ fields: { "clans.forum_parent": "invalid_parent" } });
    await expect(w.clanAdmin.saveOptions(w.root, { "clans.forum_staff_groups": ["nu_exista"] })).rejects.toMatchObject({ fields: { "clans.forum_staff_groups": "invalid_choice" } });
    await expect(w.clanAdmin.saveOptions(w.member, { "clans.tag_min": 3 })).rejects.toBeInstanceOf(GcsForbidden);
    await w.clanAdmin.saveOptions(w.root, { "clans.tag_min": 3, "clans.tag_max": 4, "clans.require_approval": false });
    expect(await w.settings.get("clans.tag_max")).toBe(4);
    expect(await w.settings.get("clans.require_approval")).toBe(false);
  });
});
