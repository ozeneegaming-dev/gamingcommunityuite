import { GcsRateLimited, type GcsActor, type GcsGroupMentionSettings } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { doc } from "../../test/world";

let w: GcsProfileWorld;
let tree: Awaited<ReturnType<GcsProfileWorld["createTree"]>>;

beforeEach(async () => {
  w = await createProfileWorld();
  tree = await w.createTree();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

async function user(name: string, group = "member", secondary: string[] = [], activeMinutesAgo?: number): Promise<GcsActor> {
  const u = await w.createUser(name, group, secondary);
  if (activeMinutesAgo !== undefined) await w.db.user.update({ where: { id: u.id }, data: { lastActiveAt: new Date(Date.now() - activeMinutesAgo * 60_000) } });
  return w.actorFor(u);
}

const groupMention = (key: string, label = key) => ({ type: "mention", attrs: { id: String(w.groups[key]), label, kind: "group" } });
const userMention = (a: GcsActor, label: string) => ({ type: "mention", attrs: { id: a.userId!, label, kind: "user" } });
const docWith = (...inline: unknown[]) => ({ type: "doc", content: [{ type: "paragraph", content: [...inline, { type: "text", text: " ajutor" }] }] });

async function setMentions(key: string, patch: Partial<GcsGroupMentionSettings>) {
  const current = (await w.groupMentions.group(w.groups[key]!))!.settings;
  await w.groupService.setMentionSettings(w.groups[key]!, { ...current, ...patch }, w.root);
}

const groupNotified = async () =>
  (await w.db.notification.findMany({ where: { type: "core.group_mention" }, select: { userId: true } })).map((n) => n.userId).sort();
const ids = (...actors: GcsActor[]) => actors.map((a) => a.userId!).sort();

async function topic() {
  return w.topics.create(w.root, { forumId: tree.forum.id, title: "Server nou", content: doc("x") });
}

describe("mențiunile de grup — notificări", () => {
  test("membrii grupului (principal și secundar) primesc „menționat prin grupul X”; autorul nu", async () => {
    const admin = await user("Admin1", "admin");
    const m1 = await user("Mod1", "moderator");
    const m2 = await user("Mod2", "member", ["moderator"]);
    await user("Membru1", "member");
    const t = await topic();
    const r = await w.posts.reply(admin, { topicId: t.topicId, content: docWith(groupMention("moderator", "Moderator")) });

    const post = await w.db.post.findUniqueOrThrow({ where: { id: r.postId } });
    expect(post.contentHtml).toContain(`<a class="gcs-groupMention" href="/members?group=${w.groups.moderator}" data-group-id="${w.groups.moderator}">@Moderator</a>`);
    // `w.moderator` (NeoX) e tot moderator.
    expect(await groupNotified()).toEqual(ids(m1, m2, w.moderator));
    const [n] = await w.notifications.list(m1.userId!);
    expect(n).toMatchObject({ type: "core.group_mention", actorIds: [admin.userId], data: { group: "Moderator", title: "Server nou" } });

    // Un moderator care menționează propriul grup nu se notifică pe sine.
    await w.db.notification.deleteMany();
    await w.clearFlood(m1);
    await w.posts.reply(m1, { topicId: t.topicId, content: docWith(groupMention("moderator")) });
    expect(await groupNotified()).toEqual(ids(m2, w.moderator));
  });

  test("cel mult numărul setat de membri, cei mai activi primii", async () => {
    await w.db.user.update({ where: { id: w.moderator.userId! }, data: { lastActiveAt: new Date(Date.now() - 90 * 60_000) } });
    const recent = await user("Recent", "moderator", [], 1);
    const older = await user("Older", "moderator", [], 30);
    await user("Inactiv", "moderator");
    await setMentions("moderator", { notifyLimit: 2 });
    const t = await topic();
    await w.posts.reply(w.root, { topicId: t.topicId, content: docWith(groupMention("moderator")) });
    expect(await groupNotified()).toEqual(ids(recent, older));
  });

  test("cine nu vede conținutul nu e notificat (forum doar pentru admini)", async () => {
    const admin = await user("Admin1", "admin");
    const both = await user("ModAdmin", "moderator", ["admin"]);
    await user("Mod1", "moderator");
    const staff = await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "Admini" }, w.root);
    await w.groupService.setContainerInherit("forum", String(staff.id), { inherits: false, parentId: null }, w.root);
    const perms = ["forums.view", "forums.read", "forums.reply", "forums.create"];
    await w.groupService.setContainerPermissions("forum", String(staff.id), { [w.groups.root_admin!]: perms, [w.groups.admin!]: perms }, w.root);
    await w.topics.create(admin, { forumId: staff.id, title: "Secret", content: docWith(groupMention("moderator")) });
    expect(await groupNotified()).toEqual(ids(both));
  });

  test("cine a fost notificat direct (mențiune sau citat) nu primește și notificarea grupului", async () => {
    const m1 = await user("Mod1", "moderator");
    const m2 = await user("Mod2", "moderator");
    const t = await w.topics.create(m2, { forumId: tree.forum.id, title: "Citate", content: doc("original") });
    const quote = { type: "quote", attrs: { postId: t.postId, authorName: "Mod2" }, content: [{ type: "paragraph", content: [{ type: "text", text: "original" }] }] };
    const content = { type: "doc", content: [quote, docWith(userMention(m1, "Mod1"), { type: "text", text: " și " }, groupMention("moderator")).content[0]] };
    await w.posts.reply(w.root, { topicId: t.topicId, content });
    expect(await groupNotified()).toEqual(ids(w.moderator));
    expect((await w.notifications.list(m1.userId!)).map((n) => n.type)).toEqual(["forums.mention"]);
    expect((await w.notifications.list(m2.userId!)).map((n) => n.type)).toEqual(["forums.quote"]);
  });

  test("două grupuri menționate în aceeași postare → o singură notificare de grup pe membru", async () => {
    const both = await user("Ambele", "moderator", ["super_moderator"]);
    const sm = await user("Super", "super_moderator");
    const t = await topic();
    await w.posts.reply(w.root, { topicId: t.topicId, content: docWith(groupMention("moderator"), { type: "text", text: " " }, groupMention("super_moderator")) });
    expect(await groupNotified()).toEqual(ids(both, sm, w.moderator));
  });

  test("„Notifică membrii” oprit: pastila rămâne, fără notificări; preferința membrului e respectată", async () => {
    const m1 = await user("Mod1", "moderator");
    await w.notifications.setPreferences(w.moderator.userId!, { "core.group_mention": { site: false, email: "OFF" } });
    const t = await topic();
    await w.posts.reply(w.root, { topicId: t.topicId, content: docWith(groupMention("moderator")) });
    expect(await groupNotified()).toEqual(ids(m1));

    await w.db.notification.deleteMany();
    // Fără pauză, ca a doua mențiune a lui Root Admin să treacă.
    await setMentions("moderator", { notify: false, cooldownMinutes: 0 });
    await w.clearFlood(w.root);
    const r = await w.posts.reply(w.root, { topicId: t.topicId, content: docWith(groupMention("moderator")) });
    expect((await w.db.post.findUniqueOrThrow({ where: { id: r.postId } })).contentHtml).toContain("gcs-groupMention");
    expect(await groupNotified()).toEqual([]);
  });

  test("o postare în așteptare notifică grupul abia la aprobare", async () => {
    await setMentions("moderator", { allowedGroupIds: [w.groups.new_member!] });
    const newbie = await user("Nou", "new_member");
    const t = await topic();
    const r = await w.posts.reply(newbie, { topicId: t.topicId, content: docWith(groupMention("moderator")) });
    expect(r.pending).toBe(true);
    expect(await groupNotified()).toEqual([]);
    await w.moderation.approve(w.root, [r.postId]);
    expect(await groupNotified()).toEqual(ids(w.moderator));
  });
});

describe("mențiunile de grup — verificările de la salvare", () => {
  test("un membru care nu poate menționa grupul: mențiunea devine text simplu, fără notificări", async () => {
    const t = await topic();
    const r = await w.posts.reply(w.member, { topicId: t.topicId, content: docWith(groupMention("moderator", "Moderator")) });
    const post = await w.db.post.findUniqueOrThrow({ where: { id: r.postId } });
    expect(post.contentHtml).toBe("<p>@Moderator ajutor</p>");
    expect(JSON.stringify(post.contentJson)).not.toContain('"kind":"group"');
    expect(await groupNotified()).toEqual([]);
  });

  test("Vizitator și Banat nu pot fi menționate nici de Root Admin", async () => {
    await w.db.groupSetting.create({ data: { groupId: w.groups.banned!, key: "mentions.enabled", value: true } });
    const t = await topic();
    const r = await w.posts.reply(w.root, { topicId: t.topicId, content: docWith(groupMention("banned", "Banat"), { type: "text", text: " " }, groupMention("guest", "Vizitator")) });
    expect((await w.db.post.findUniqueOrThrow({ where: { id: r.postId } })).contentHtml).toBe("<p>@Banat @Vizitator ajutor</p>");
  });

  test("pauza dintre mențiuni: a doua mențiune a aceluiași grup e refuzată, postarea nu se salvează", async () => {
    const admin = await user("Admin1", "admin");
    const t = await topic();
    await w.posts.reply(admin, { topicId: t.topicId, content: docWith(groupMention("moderator")) });
    await w.clearFlood(admin);
    const before = await w.db.post.count();
    const error = await w.posts.reply(admin, { topicId: t.topicId, content: docWith(groupMention("moderator")) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GcsRateLimited);
    expect((error as GcsRateLimited).params).toMatchObject({ reason: "group_mention_cooldown" });
    expect(await w.db.post.count()).toBe(before);
    // Fără mențiunea grupului, același membru poate posta.
    await expect(w.posts.reply(admin, { topicId: t.topicId, content: doc("altceva") })).resolves.toMatchObject({ pending: false });
  });

  test("editarea păstrează pastila (și pentru un moderator fără drept pe grup) și nu notifică din nou", async () => {
    await setMentions("vip_gold", { enabled: true, allowedGroupIds: [w.groups.member!] });
    const vip = await user("Vip1", "vip_gold");
    const t = await topic();
    const r = await w.posts.reply(w.member, { topicId: t.topicId, content: docWith(groupMention("vip_gold")) });
    expect(await groupNotified()).toEqual(ids(vip));
    await w.db.notification.deleteMany();
    // Super moderatorul nu e în lista celor care pot menționa VIP Gold, dar pastila salvată rămâne la editare.
    const sm = await user("Super", "super_moderator");
    await w.posts.edit(sm, r.postId, { content: docWith(groupMention("vip_gold"), { type: "text", text: " (editat)" }) });
    expect((await w.db.post.findUniqueOrThrow({ where: { id: r.postId } })).contentHtml).toContain("gcs-groupMention");
    expect(await groupNotified()).toEqual([]);
  });

  test("mesaj privat: grupul permis rămâne pastilă; doar participanții din grup sunt notificați", async () => {
    const admin = await user("Admin1", "admin");
    const inside = await user("ModIn", "moderator");
    const { conversationId, messageId } = await w.conversations.start(admin, { to: [inside.userId!, w.member.userId!], title: "Staff", content: docWith(groupMention("moderator")) });
    const message = await w.db.conversationMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(message.contentHtml).toContain("gcs-groupMention");
    // NeoX (moderator) nu participă la conversație.
    expect(await groupNotified()).toEqual(ids(inside));
    const n = (await w.notifications.list(inside.userId!)).find((x) => x.type === "core.group_mention");
    expect(n!.data.href).toBe(`/messages/${conversationId}`);

    // Un membru fără drept: în mesajul lui, mențiunea e text simplu.
    await w.clearPmFlood(w.member);
    const reply = await w.conversations.reply(w.member, conversationId, docWith(groupMention("moderator", "Moderator")));
    expect((await w.db.conversationMessage.findUniqueOrThrow({ where: { id: reply.messageId } })).contentHtml).toBe("<p>@Moderator ajutor</p>");
  });
});
