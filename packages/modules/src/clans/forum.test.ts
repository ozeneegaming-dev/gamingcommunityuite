import { GcsForbidden, GcsNotFound, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createClanWorld, type GcsClanWorld } from "../../test/clanWorld";
import { doc } from "../../test/world";
import { forumContainer } from "../forums/posting";

let w: GcsClanWorld;
let categoryId: number;

beforeEach(async () => {
  w = await createClanWorld();
  categoryId = await w.forumCategory();
  await w.option("clans.leave_cooldown_hours", 0);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

/** Un clan activ cu forum privat (opțiunea „opțional”, cerut de lider), cu membrii dați. */
async function clanWithForum(memberNames: string[] = []) {
  const { id, leader } = await w.activeClan({ joinMode: "OPEN", wantForum: true });
  const members: Record<string, GcsActor> = {};
  for (const name of memberNames) {
    members[name] = await w.user(name);
    await w.clans.join(members[name], id);
  }
  const clan = await w.db.clan.findUniqueOrThrow({ where: { id } });
  return { id, leader, members, forumId: clan.forumId! };
}

/** Forumurile vizibile actorului în index (toate categoriile). */
async function indexForums(actor: GcsActor): Promise<number[]> {
  return (await w.queries.index(actor)).flatMap((c) => c.forums.map((f) => f.id));
}

describe("forumul privat al clanului", () => {
  test("se creează sub categoria din opțiuni, cu moștenirea oprită și fără drepturi pentru grupuri", async () => {
    const { forumId } = await clanWithForum();
    const forum = await w.db.forum.findUniqueOrThrow({ where: { id: forumId } });
    expect(forum).toMatchObject({ parentId: categoryId, type: "FORUM", name: expect.stringMatching(/^\[T\d+\] Clanul \d+$/) });
    expect(await w.db.containerInherit.findFirst({ where: { containerType: "forum", containerId: String(forumId) } })).toMatchObject({ inherits: false });
    // Doar staff-ul ales în opțiuni (Admin, Super Moderator) are rânduri în matricea forumului.
    const groups = await w.db.containerPermission.findMany({ where: { containerType: "forum", containerId: String(forumId) }, select: { groupId: true } });
    expect([...new Set(groups.map((g) => g.groupId))].sort()).toEqual([w.groups.admin!, w.groups.super_moderator!].sort());
  });

  test("un non-membru nu-l vede nicăieri (index, forum, topic, căutare); membrii îl citesc și scriu", async () => {
    const { forumId, leader, members } = await clanWithForum(["Ana"]);
    const outsider = await w.user("Strain");
    const { topicId } = await w.topics.create(leader, { forumId, title: "Strategia secretă de clan", content: doc("Planul pentru turneu") });
    await w.posts.reply(members.Ana!, { topicId, content: doc("Sunt gata") });

    for (const viewer of [leader, members.Ana!]) {
      expect(await indexForums(viewer)).toContain(forumId);
      await expect(w.queries.topic(viewer, topicId, { page: 1 })).resolves.toMatchObject({ topic: { id: topicId } });
    }
    for (const viewer of [outsider, w.member, w.guest]) {
      expect(await indexForums(viewer)).not.toContain(forumId);
      await expect(w.queries.forum(viewer, forumId, { page: 1 })).rejects.toSatisfy((e) => e instanceof GcsForbidden || e instanceof GcsNotFound);
      await expect(w.queries.topic(viewer, topicId, { page: 1 })).rejects.toSatisfy((e) => e instanceof GcsForbidden || e instanceof GcsNotFound);
      await expect(w.topics.create(viewer, { forumId, title: "Intrus aici", content: doc("x") })).rejects.toBeDefined();
    }
    await w.clearFlood(outsider);
    const found = await w.search.search(outsider, { q: "strategia", type: "topics", page: 1 });
    expect(found.results).toEqual([]);
    const own = await w.search.search(members.Ana!, { q: "strategia", type: "topics", page: 1 });
    expect(own.results.map((r) => r.topicId)).toEqual([topicId]);
  });

  test("un membru scos pierde accesul imediat (fără să aștepte cache-ul); unul care iese la fel", async () => {
    const { id, forumId, leader, members } = await clanWithForum(["Ana", "Bob"]);
    const ref = forumContainer(forumId);
    // Drepturile intră în cache.
    await expect(w.permissions.can(members.Ana!, "forums.read", ref)).resolves.toBe(true);
    await expect(w.permissions.can(members.Bob!, "forums.reply", ref)).resolves.toBe(true);
    await w.clans.kick(leader, id, members.Ana!.userId!);
    await w.clans.leave(members.Bob!, id);
    for (const ex of [members.Ana!, members.Bob!]) {
      await expect(w.permissions.can(ex, "forums.read", ref)).resolves.toBe(false);
      expect(await indexForums(ex)).not.toContain(forumId);
    }
    // Intrarea din nou îi redă accesul.
    await w.clans.join(members.Bob!, id);
    await expect(w.permissions.can(members.Bob!, "forums.read", ref)).resolves.toBe(true);
  });

  test("staff-ul din opțiuni vede forumul (Root Admin oricum); schimbarea opțiunii rescrie drepturile", async () => {
    const { forumId } = await clanWithForum();
    const admin = await w.user("Adminul", "admin");
    const smod = await w.user("Supermod", "super_moderator");
    const mod = await w.user("Moderatorul", "moderator");
    const ref = forumContainer(forumId);
    await expect(w.permissions.can(admin, "forums.read", ref)).resolves.toBe(true);
    await expect(w.permissions.can(smod, "forums.read", ref)).resolves.toBe(true);
    await expect(w.permissions.can(mod, "forums.read", ref)).resolves.toBe(false);
    await expect(w.permissions.can(w.root, "forums.read", ref)).resolves.toBe(true);
    await w.clanAdmin.saveOptions(w.root, { "clans.forum_staff_groups": ["admin", "moderator"] });
    await expect(w.permissions.can(smod, "forums.read", ref)).resolves.toBe(false);
    await expect(w.permissions.can(mod, "forums.read", ref)).resolves.toBe(true);
    await expect(w.permissions.can(admin, "forums.read", ref)).resolves.toBe(true);
  });

  test("moderarea: liderul are puterile clanului, ofițerul doar cu dreptul `forum`, membrul niciuna", async () => {
    const { id, forumId, leader, members } = await clanWithForum(["Ana", "Bob"]);
    const ref = forumContainer(forumId);
    await expect(w.permissions.moderatorPowers(leader, ref)).resolves.toEqual(["approve", "edit", "hide", "lock", "pin"]);
    await expect(w.permissions.canModerate(leader, "delete", ref)).resolves.toBe(false);
    await w.clans.setRole(leader, id, members.Ana!.userId!, "OFFICER");
    await expect(w.permissions.moderatorPowers(members.Ana!, ref)).resolves.toEqual([]);
    const clan = await w.db.clan.findUniqueOrThrow({ where: { id } });
    await w.clans.update(leader, id, { ...w.input({ tag: clan.tag, name: clan.name, joinMode: "OPEN" }), officerRights: ["forum"] });
    await expect(w.permissions.moderatorPowers(members.Ana!, ref)).resolves.toContain("hide");
    await expect(w.permissions.moderatorPowers(members.Bob!, ref)).resolves.toEqual([]);
    // Liderul ascunde un topic din forumul clanului.
    const { topicId, postId } = await w.topics.create(members.Bob!, { forumId, title: "Un topic de ascuns", content: doc("x") });
    await w.posts.hide(leader, postId, "spam");
    expect((await w.db.post.findUniqueOrThrow({ where: { id: postId } })).visibility).toBe("HIDDEN");
    expect(topicId).toBeGreaterThan(0);
  });

  test("clanul blocat sau arhivat: forumul devine doar citire pentru membri", async () => {
    const { id, forumId, members } = await clanWithForum(["Ana"]);
    const ref = forumContainer(forumId);
    await w.clans.setLocked(w.root, id, true);
    await expect(w.permissions.can(members.Ana!, "forums.read", ref)).resolves.toBe(true);
    await expect(w.permissions.can(members.Ana!, "forums.reply", ref)).resolves.toBe(false);
    await w.clans.setLocked(w.root, id, false);
    await expect(w.permissions.can(members.Ana!, "forums.reply", ref)).resolves.toBe(true);
    await w.clans.archive(w.root, id);
    await expect(w.permissions.can(members.Ana!, "forums.create", ref)).resolves.toBe(false);
  });

  test("aplicația dezactivată: membrii pierd accesul, staff-ul îl păstrează", async () => {
    const { forumId, members } = await clanWithForum(["Ana"]);
    const admin = await w.user("Adminul", "admin");
    const ref = forumContainer(forumId);
    await expect(w.permissions.can(members.Ana!, "forums.read", ref)).resolves.toBe(true);
    await w.apps.setEnabled(w.root, "clans", false);
    await expect(w.permissions.can(members.Ana!, "forums.read", ref)).resolves.toBe(false);
    await expect(w.permissions.can(admin, "forums.read", ref)).resolves.toBe(true);
    await w.apps.setEnabled(w.root, "clans", true);
    await expect(w.permissions.can(members.Ana!, "forums.read", ref)).resolves.toBe(true);
  });

  test("modurile forumului: `off` nu creează, `auto` creează la aprobare, `optional` după cererea liderului", async () => {
    await w.option("clans.max_per_member", 5);
    const vip = await w.user("Fondator2", "vip_gold");
    // Opțional, cerut la creare (cu aprobare): forumul apare la aprobare.
    const asked = await w.clans.create(vip, w.input({ wantForum: true }));
    expect((await w.db.clan.findUniqueOrThrow({ where: { id: asked.id } })).forumId).toBeNull();
    await w.clans.approve(w.root, asked.id);
    expect((await w.db.clan.findUniqueOrThrow({ where: { id: asked.id } })).forumId).not.toBeNull();
    // Opțional, necerut: fără forum; liderul îl creează mai târziu.
    const later = await w.clans.create(vip, w.input());
    await w.clans.approve(w.root, later.id);
    expect((await w.db.clan.findUniqueOrThrow({ where: { id: later.id } })).forumId).toBeNull();
    await w.clans.createForum(vip, later.id);
    expect((await w.db.clan.findUniqueOrThrow({ where: { id: later.id } })).forumId).not.toBeNull();
    // Automat.
    await w.option("clans.forum_mode", "auto");
    const auto = await w.clans.create(vip, w.input());
    await w.clans.approve(w.root, auto.id);
    expect((await w.db.clan.findUniqueOrThrow({ where: { id: auto.id } })).forumId).not.toBeNull();
    // Oprit.
    await w.option("clans.forum_mode", "off");
    const off = await w.clans.create(vip, w.input({ wantForum: true }));
    await w.clans.approve(w.root, off.id);
    expect((await w.db.clan.findUniqueOrThrow({ where: { id: off.id } })).forumId).toBeNull();
    await expect(w.clans.createForum(vip, off.id)).rejects.toBeInstanceOf(GcsForbidden);
    // Fără categorie validă în opțiuni nu se creează niciun forum.
    await w.option("clans.forum_mode", "optional");
    await w.option("clans.forum_parent", 0);
    await expect(w.clans.createForum(vip, off.id)).rejects.toMatchObject({ params: { reason: "clan_no_forum_parent" } });
  });

  test("desființarea: forumul gol dispare; cel cu topicuri rămâne doar pentru staff, marcat ca arhivă", async () => {
    const empty = await clanWithForum();
    await w.clans.disband(empty.leader, empty.id, (await w.db.clan.findUniqueOrThrow({ where: { id: empty.id } })).tag);
    expect(await w.db.forum.findUnique({ where: { id: empty.forumId } })).toBeNull();

    const full = await clanWithForum(["Ana"]);
    await w.topics.create(full.leader, { forumId: full.forumId, title: "Istoria clanului", content: doc("x") });
    await w.clans.disband(w.root, full.id, "");
    const forum = await w.db.forum.findUniqueOrThrow({ where: { id: full.forumId } });
    expect(forum.name).toMatch(/\(arhivă\)$/);
    const admin = await w.user("Adminul", "admin");
    await expect(w.permissions.can(full.members.Ana!, "forums.read", forumContainer(full.forumId))).resolves.toBe(false);
    await expect(w.permissions.can(admin, "forums.read", forumContainer(full.forumId))).resolves.toBe(true);
  });
});
