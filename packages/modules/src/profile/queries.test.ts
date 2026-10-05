import type { GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { doc } from "../../test/world";
import { snippetOf } from "./queries";

let w: GcsProfileWorld;
let tree: Awaited<ReturnType<GcsProfileWorld["createTree"]>>;
let other: GcsActor;

beforeEach(async () => {
  w = await createProfileWorld();
  tree = await w.createTree({ subforum: true });
  other = await w.actorFor(await w.createUser("Dexter", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const setPrivacy = (actor: GcsActor, patch: Record<string, unknown>) =>
  w.profiles.updatePrivacy(actor, { profile: "PUBLIC", messages: "MEMBERS", wall: "MEMBERS", showOnline: true, ...patch });

/** Scoate `forums.read` unui grup pe un forum (oprește moștenirea și copiază matricea efectivă). */
async function revokeRead(forumId: number, groupKey: string) {
  const forum = String(forumId);
  let source = forum;
  for (;;) {
    const inherit = await w.db.containerInherit.findFirst({ where: { containerType: "forum", containerId: source } });
    if (!inherit?.inherits || !inherit.parentId) break;
    source = inherit.parentId;
  }
  const rows = await w.db.containerPermission.findMany({ where: { containerType: "forum", containerId: source } });
  const matrix: Record<number, string[]> = {};
  for (const r of rows) (matrix[r.groupId] ??= []).push(r.action);
  matrix[w.groups[groupKey]!] = (matrix[w.groups[groupKey]!] ?? []).filter((a) => a !== "forums.read");
  await w.groupService.setContainerInherit("forum", forum, { inherits: false, parentId: null }, w.root);
  await w.groupService.setContainerPermissions("forum", forum, matrix, w.root);
}

describe("profilul", () => {
  test("arată numele, grupul, rangul, statisticile și ce poate face viewer-ul", async () => {
    await w.db.user.update({ where: { id: w.member.userId! }, data: { bio: "skill issue", accentColor: "#B794FF" } });
    await w.topics.create(w.member, { forumId: tree.forum.id, title: "Primul meu topic", content: doc("Salut") });
    await w.achievements.evaluate(w.member.userId!);

    const p = (await w.profileQueries.profile(other, w.member.userId!))!;
    expect(p.user).toMatchObject({ name: "Mara", nameKey: "member", groupKey: "member", bio: "skill issue", accentColor: "#B794FF", rank: { name: "Recrut" } });
    expect(p.stats).toMatchObject({ posts: 1, points: 11 });
    expect(p.badges.map((b) => b.key)).toEqual(["first_post"]);
    expect(p.viewer).toMatchObject({ isSelf: false, canFollow: true, canMessage: true, canPostWall: true, canSeeWarnings: false });
    expect((await w.profileQueries.profile(w.moderator, w.member.userId!))!.viewer.canSeeWarnings).toBe(true);
    expect((await w.profileQueries.profile(w.member, w.member.userId!))!.viewer).toMatchObject({ isSelf: true, canMessage: false });
  });

  test("staff-ul afișează „Staff” în locul rangului; un stil ales schimbă clasa numelui", async () => {
    expect((await w.profileQueries.profile(w.guest, w.moderator.userId!))!.user.rank).toEqual({ name: "Staff", icon: null });
    const legend = await w.actorFor(await w.createUser("Krypt", "vip_legend"));
    const style = await w.db.nameStyle.findUniqueOrThrow({ where: { key: "ns_neon" } });
    const neon = await w.db.avatarFrame.findUniqueOrThrow({ where: { key: "neon" } });
    await w.cosmetics.choose(legend, { nameStyleId: style.id, avatarFrameId: neon.id });
    expect((await w.profileQueries.profile(w.guest, legend.userId!))!.user).toMatchObject({ nameKey: "ns_neon", frameKey: "neon", groupKey: "vip_legend" });
  });

  test("un profil MEMBERS nu există pentru vizitator (nici profilul, nici cardul)", async () => {
    await setPrivacy(w.member, { profile: "MEMBERS" });
    expect(await w.profileQueries.profile(w.guest, w.member.userId!)).toBeNull();
    expect(await w.profileQueries.card(w.guest, w.member.userId!)).toBeNull();
    expect(await w.profileQueries.card(other, w.member.userId!)).not.toBeNull();
  });

  test("statusul online ascuns: ceilalți nu-l văd, staff-ul îl vede marcat", async () => {
    await w.db.user.update({ where: { id: w.member.userId! }, data: { lastActiveAt: new Date() } });
    expect((await w.profileQueries.profile(other, w.member.userId!))!.online).toMatchObject({ online: true, hidden: false });
    await setPrivacy(w.member, { showOnline: false });
    expect((await w.profileQueries.profile(other, w.member.userId!))!.online).toEqual({ online: false, hidden: true, lastActiveAt: null });
    expect((await w.profileQueries.profile(w.moderator, w.member.userId!))!.online).toMatchObject({ online: true, hidden: true });
  });

  test("avertismentele: doar userul și staff-ul", async () => {
    await w.db.warning.create({ data: { userId: w.member.userId!, points: 1, reason: "spam" } });
    expect(await w.profileQueries.warnings(other, w.member.userId!)).toBeNull();
    expect(await w.profileQueries.warnings(w.member, w.member.userId!)).toHaveLength(1);
    expect(await w.profileQueries.warnings(w.moderator, w.member.userId!)).toHaveLength(1);
  });
});

describe("cardul", () => {
  test("e cache-uit, iar alegerea unei rame îl invalidează", async () => {
    const gold = await w.actorFor(await w.createUser("Shadow", "vip_gold"));
    expect((await w.profileQueries.card(w.guest, gold.userId!))!.user.frameKey).toBeNull();
    const frame = await w.db.avatarFrame.findUniqueOrThrow({ where: { key: "gold" } });
    await w.cosmetics.choose(gold, { avatarFrameId: frame.id });
    expect((await w.profileQueries.card(w.guest, gold.userId!))!.user.frameKey).toBe("gold");
  });

  test("arată doar câmpurile publice marcate „pe card”", async () => {
    await w.profiles.updateFields(w.member, w.member.userId!, { country: "România", platform: "PC" });
    expect((await w.profileQueries.card(w.guest, w.member.userId!))!.fields).toEqual([{ label: "Țară", value: "România" }]);
  });
});

describe("activitatea (Review Focus #2)", () => {
  test("nu conține postări din forumuri fără `forums.read` pentru viewer și nici postări ascunse", async () => {
    await w.topics.create(w.member, { forumId: tree.forum.id, title: "Public", content: doc("Salut public") });
    await w.clearFlood(w.member);
    await w.topics.create(w.member, { forumId: tree.subforum!.id, title: "Doar membri", content: doc("Secret") });
    await w.clearFlood(w.member);
    const hidden = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Ascuns", content: doc("x") });
    await w.posts.hide(w.root, hidden.postId);
    await revokeRead(tree.subforum!.id, "guest");

    const titles = async (viewer: GcsActor) =>
      (await w.profileQueries.activity(viewer, w.member.userId!)).items.flatMap((i) => (i.kind === "badge" ? [] : [i.topicTitle]));
    expect(await titles(w.guest)).toEqual(["Public"]);
    expect(await titles(other)).toEqual(["Doar membri", "Public"]);
    expect((await w.profileQueries.activity(other, w.member.userId!)).items.every((i) => i.kind === "topic")).toBe(true);
  });

  test("paginare cu cursor", async () => {
    const t = await w.topics.create(w.member, { forumId: tree.forum.id, title: "Multe", content: doc("0") });
    for (let i = 1; i <= 4; i++) {
      await w.clearFlood(w.member);
      await w.posts.reply(w.member, { topicId: t.topicId, content: doc(String(i)) });
    }
    const first = await w.profileQueries.activity(w.guest, w.member.userId!, { limit: 3 });
    expect(first.items).toHaveLength(3);
    const second = await w.profileQueries.activity(w.guest, w.member.userId!, { limit: 3, before: first.next! });
    expect(second.items.map((i) => (i.kind === "badge" ? 0 : i.postId))).not.toContain(first.items[2]!.kind === "badge" ? -1 : (first.items[2] as { postId: number }).postId);
    expect(first.items.length + second.items.length).toBe(5);
  });
});

describe("peretele și urmăritorii", () => {
  test("statusurile ascunse le văd doar moderatorii; răspunsurile vin grupate", async () => {
    const s = await w.social.postStatus(other, w.member.userId!, doc("GG"));
    await w.social.postStatus(w.member, w.member.userId!, doc("Mersi"), s.id);
    const hidden = await w.social.postStatus(w.moderator, w.member.userId!, doc("de ascuns"));
    await w.social.hideStatus(w.member, hidden.id);

    const wall = (await w.profileQueries.wall(w.guest, w.member.userId!, 1))!;
    expect(wall.items.map((i) => i.html)).toEqual([expect.stringContaining("GG")]);
    expect(wall.items[0]!.replies.map((r) => r.author?.name)).toEqual(["Mara"]);
    expect(wall.items[0]!.canManage).toBe(false);
    expect((await w.profileQueries.wall(w.moderator, w.member.userId!, 1))!.items).toHaveLength(2);
  });

  test("urmăritorii", async () => {
    await w.social.follow(other, w.member.userId!);
    expect((await w.profileQueries.followers(w.guest, w.member.userId!, 1))!.users.map((u) => u.name)).toEqual(["Dexter"]);
  });
});

test("snippetOf scoate tag-urile și scurtează", () => {
  expect(snippetOf("<p>Salut <strong>lume</strong> &amp; tot</p>")).toBe("Salut lume & tot");
  expect(snippetOf(`<p>${"a".repeat(300)}</p>`, 10)).toHaveLength(10);
});
