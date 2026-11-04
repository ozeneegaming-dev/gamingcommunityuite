import type { GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { doc } from "../../test/world";
import { GcsActivityStream, parseActivityCursor, type GcsStreamItem, type GcsActivityQuery } from "./activity";
import { DEFAULT_STREAMS, STREAMS_SETTING } from "./streams";

let w: GcsProfileWorld;
let stream: GcsActivityStream;
let tree: Awaited<ReturnType<GcsProfileWorld["createTree"]>>;
let clock: number;

beforeEach(async () => {
  w = await createProfileWorld();
  stream = new GcsActivityStream({ db: w.db, cache: w.cache, permissions: w.permissions, social: w.social });
  tree = await w.createTree();
  // Membrii creați de lumea de test sunt „vechi”; evenimentele din teste vin după ei, la câte un minut (în trecut).
  await w.db.user.updateMany({ data: { createdAt: new Date(Date.now() - 30 * 86_400_000) } });
  clock = Date.now() - 2 * 86_400_000;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const tick = () => new Date((clock += 60_000));

async function topic(actor: GcsActor, title: string, forumId = tree.forum.id) {
  await w.clearFlood(actor);
  const r = await w.topics.create(actor, { forumId, title, content: doc(`Textul: ${title}`) });
  const at = tick();
  await w.db.topic.update({ where: { id: r.topicId }, data: { createdAt: at, lastPostAt: at } });
  await w.db.post.update({ where: { id: r.postId }, data: { createdAt: at } });
  return r;
}

async function reply(actor: GcsActor, topicId: number, text: string) {
  await w.clearFlood(actor);
  const r = await w.posts.reply(actor, { topicId, content: doc(text) });
  const at = tick();
  await w.db.post.update({ where: { id: r.postId }, data: { createdAt: at } });
  await w.db.topic.update({ where: { id: topicId }, data: { lastPostAt: at } });
  return r;
}

async function status(actor: GcsActor, ownerId: string, text: string) {
  await w.clearWallFlood(actor);
  const s = await w.social.postStatus(actor, ownerId, doc(text));
  await w.db.statusUpdate.update({ where: { id: s.id }, data: { createdAt: tick() } });
  return s;
}

async function newMember(name: string, group = "member") {
  const user = await w.createUser(name, group);
  await w.db.user.update({ where: { id: user.id }, data: { createdAt: tick() } });
  return w.actorFor(user);
}

/** Fluxul văzut de viewer (fără cache-ul vizitatorilor, ca fiecare verificare să vadă baza). */
async function feed(viewer: GcsActor, query: GcsActivityQuery = {}): Promise<GcsStreamItem[]> {
  await w.cache.invalidateTags(["activity"]);
  return (await stream.page(viewer, query)).items;
}

const describeItem = (i: GcsStreamItem) =>
  i.kind === "member" ? `member:${i.user.name}` : i.kind === "status" ? `status:${i.snippet}` : i.kind === "app" ? `app:${i.title}` : `${i.kind}:${i.topic.title}:${i.snippet}`;

/** Un forum în aceeași categorie pe care doar staff-ul îl poate citi (grupurile fără drept nu-l văd deloc). */
async function staffForum() {
  const forum = await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "Doar staff" }, w.root);
  const matrix: Record<number, string[]> = {};
  for (const key of ["root_admin", "admin", "super_moderator", "moderator"]) matrix[w.groups[key]!] = ["forums.view", "forums.read", "forums.create", "forums.reply"];
  await w.groupService.setContainerInherit("forum", String(forum.id), { inherits: false, parentId: null }, w.root);
  await w.groupService.setContainerPermissions("forum", String(forum.id), matrix, w.root);
  return forum;
}

describe("fluxul de activitate", () => {
  test("topicuri noi, răspunsuri, statusuri și membri noi, cele mai noi primele, cu forumul și un fragment", async () => {
    const t = await topic(w.member, "Turneul de vineri");
    await reply(w.root, t.topicId, "Mă înscriu și eu");
    await status(w.member, w.member.userId!, "Diseară stream");
    await newMember("Radu");

    const items = await feed(w.guest);
    expect(items.slice(0, 4).map(describeItem)).toEqual(["member:Radu", "status:Diseară stream", "reply:Turneul de vineri:Mă înscriu și eu", "topic:Turneul de vineri:Textul: Turneul de vineri"]);
    const [, s, r] = items;
    expect(r).toMatchObject({ kind: "reply", forum: { id: tree.forum.id, name: "Counter-Strike 2" }, user: { name: "Fondator", nameKey: "root_admin" } });
    expect(s).toMatchObject({ kind: "status", user: { name: "Mara" }, owner: null });
  });

  test("conținutul unui forum fără drept de citire, postările ascunse și cele în așteptare nu apar niciodată", async () => {
    const secret = await staffForum();
    const hiddenTopic = await topic(w.root, "Planuri secrete", secret.id);
    await reply(w.root, hiddenTopic.topicId, "răspuns secret");
    const open = await topic(w.member, "Topic public");
    const hiddenReply = await reply(w.member, open.topicId, "va fi ascuns");
    await w.posts.hide(w.root, hiddenReply.postId);
    const gone = await topic(w.member, "Topic ascuns cu totul");
    await w.posts.hide(w.root, gone.postId);
    await w.forums.update(tree.forum.id, { requireApproval: true }, w.root);
    const pending = await topic(w.member, "În așteptare");
    expect(pending.pending).toBe(true);

    for (const viewer of [w.guest, w.member]) {
      const text = (await feed(viewer)).map(describeItem).join("\n");
      expect(text).toContain("Topic public");
      for (const leaked of ["Planuri secrete", "răspuns secret", "va fi ascuns", "Topic ascuns cu totul", "În așteptare"]) expect(text).not.toContain(leaked);
    }
    // Cine poate citi forumul îl vede (staff-ul); ascunsele și cele în așteptare nu apar nici moderatorilor.
    for (const viewer of [w.moderator, w.root]) {
      const text = (await feed(viewer)).map(describeItem).join("\n");
      expect(text).toContain("Planuri secrete");
      expect(text).toContain("răspuns secret");
      for (const leaked of ["va fi ascuns", "Topic ascuns cu totul", "În așteptare"]) expect(text).not.toContain(leaked);
    }
  });

  test("statusurile respectă confidențialitatea profilului; cele ascunse nu apar", async () => {
    const ana = await newMember("Ana");
    const ion = await newMember("Ion");
    await status(ana, ana.userId!, "doar pentru membri");
    const hidden = await status(ana, ana.userId!, "status ascuns");
    await w.social.hideStatus(w.root, hidden.id);
    const statuses = async (viewer: GcsActor) => (await feed(viewer, { filter: "statuses" })).map(describeItem);

    expect(await statuses(w.guest)).toEqual(["status:doar pentru membri"]);
    await w.profiles.updatePrivacy(ana, { profile: "MEMBERS", messages: "MEMBERS", wall: "MEMBERS", showOnline: true });
    expect(await statuses(w.guest)).toEqual([]);
    expect(await statuses(ion)).toEqual(["status:doar pentru membri"]);

    await w.profiles.updatePrivacy(ana, { profile: "FOLLOWED", messages: "MEMBERS", wall: "MEMBERS", showOnline: true });
    expect(await statuses(ion)).toEqual([]);
    expect(await statuses(ana)).toEqual(["status:doar pentru membri"]);
    expect(await statuses(w.root)).toEqual(["status:doar pentru membri"]);
    await w.social.follow(ana, ion.userId!);
    expect(await statuses(ion)).toEqual(["status:doar pentru membri"]);
    // Membrii noi urmează aceeași regulă: profilul „doar urmăriți” nu apare vizitatorilor.
    expect((await feed(w.guest)).map(describeItem)).not.toContain("member:Ana");
  });

  test("filtrele Topicuri, Răspunsuri și Statusuri; cursorul parcurge tot fără dubluri", async () => {
    const t = await topic(w.member, "Primul");
    await reply(w.root, t.topicId, "r1");
    await reply(w.member, t.topicId, "r2");
    await status(w.member, w.member.userId!, "s1");
    await topic(w.root, "Al doilea");

    expect((await feed(w.member, { filter: "topics" })).map(describeItem)).toEqual(["topic:Al doilea:Textul: Al doilea", "topic:Primul:Textul: Primul"]);
    expect((await feed(w.member, { filter: "replies" })).map(describeItem)).toEqual(["reply:Primul:r2", "reply:Primul:r1"]);
    expect((await feed(w.member, { filter: "statuses" })).map(describeItem)).toEqual(["status:s1"]);

    const all = (await feed(w.member)).map((i) => i.key);
    const paged: string[] = [];
    let before: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await stream.page(w.member, { limit: 2, before });
      paged.push(...page.items.map((i) => i.key));
      if (!page.next) break;
      expect(parseActivityCursor(page.next)).not.toBeNull();
      before = page.next;
    }
    expect(paged).toEqual(all);
    expect(new Set(paged).size).toBe(paged.length);
    // Un cursor invalid e ignorat: fluxul începe de la cele mai noi.
    expect((await stream.page(w.member, { before: "nu-e-cursor" })).items.map((i) => i.key)).toEqual(all);
  });

  test("„Doar necitite”: fără ce a citit membrul și fără propriile postări; statusurile nu au stare de citire", async () => {
    const reader = await newMember("Cititor");
    const a = await topic(w.member, "Citit");
    await topic(w.member, "Necitit");
    await topic(reader, "Al meu");
    await status(w.member, w.member.userId!, "un status");
    await w.readMarkers.markRead(reader.userId!, a.topicId, a.postId);

    const unread = async () => (await feed(reader, { unread: true })).map(describeItem);
    expect(await unread()).toEqual(["topic:Necitit:Textul: Necitit"]);
    const r = await reply(w.root, a.topicId, "răspuns nou");
    expect(await unread()).toEqual(["reply:Citit:răspuns nou", "topic:Necitit:Textul: Necitit"]);
    await w.readMarkers.markRead(reader.userId!, a.topicId, r.postId);
    await w.readMarkers.markForumRead(reader.userId!, tree.forum.id);
    expect(await unread()).toEqual([]);
    // Vizitatorii nu au necitite: filtrul e ignorat.
    expect((await feed(w.guest, { unread: true })).length).toBeGreaterThan(0);
  });

  test("autorii ignorați și membrii banați nu apar; un viewer banat nu vede nimic", async () => {
    const pest = await newMember("Pest");
    await topic(pest, "Spam");
    await newMember("Banat1", "banned");
    const banned2 = await newMember("Banat2");
    await w.db.ban.create({ data: { type: "ACCOUNT", value: banned2.userId!, userId: banned2.userId!, reason: "test" } });
    const expired = await newMember("FostBanat");
    await w.db.ban.create({ data: { type: "ACCOUNT", value: expired.userId!, userId: expired.userId!, reason: "test", expiresAt: new Date(Date.now() - 1000) } });

    await w.social.ignore(w.member, pest.userId!, { posts: true, messages: false });
    const forMember = (await feed(w.member)).map(describeItem);
    expect(forMember).not.toContain("topic:Spam:Textul: Spam");
    expect(forMember).toContain("member:FostBanat");
    for (const name of ["Banat1", "Banat2"]) expect(forMember).not.toContain(`member:${name}`);
    expect((await feed(w.guest)).map(describeItem)).toContain("topic:Spam:Textul: Spam");

    const bannedViewer: GcsActor = { ...w.guest, isBanned: true };
    expect(await feed(bannedViewer)).toEqual([]);
  });

  test("fluxul vizitatorilor e cache-uit și se reîmprospătează la o postare nouă", async () => {
    const t = await topic(w.member, "Cache");
    expect((await stream.page(w.guest)).items.map(describeItem)).toContain("topic:Cache:Textul: Cache");
    await w.db.topic.update({ where: { id: t.topicId }, data: { title: "Redenumit direct în bază" } });
    expect((await stream.page(w.guest)).items.map(describeItem)).toContain("topic:Cache:Textul: Cache");
    await reply(w.root, t.topicId, "invalidează");
    expect((await stream.page(w.guest)).items.map(describeItem)).toContain("reply:Redenumit direct în bază:invalidează");
  });
  test("ACP › Fluxuri: forumurile excluse, tipurile din „Tot” și un flux propriu pe un forum", async () => {
    const withSettings = new GcsActivityStream({ db: w.db, cache: w.cache, permissions: w.permissions, social: w.social, settings: w.settings });
    const news = await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "Știri" }, w.root);
    const offtopic = await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "Off-topic" }, w.root);
    const n = await topic(w.member, "Turneu anunțat", news.id);
    await reply(w.member, n.topicId, "abia aștept");
    await topic(w.member, "Ce mâncați azi", offtopic.id);
    await topic(w.member, "Config nou");
    await w.settings.set(
      STREAMS_SETTING,
      { ...DEFAULT_STREAMS, kinds: ["topic"], excludeForumIds: [offtopic.id], custom: [{ key: "stiri", name: "Știri", icon: "", kinds: ["topic", "reply"], forumIds: [news.id] }] },
      w.root,
    );
    const all = (await withSettings.page(w.member)).items.map(describeItem).join("\n");
    expect(all).toContain("Turneu anunțat");
    expect(all).toContain("Config nou");
    expect(all).not.toContain("Ce mâncați azi");
    expect(all).not.toContain("abia aștept");
    const stiri = (await withSettings.page(w.member, { stream: "stiri" })).items.map(describeItem).join("\n");
    expect(stiri).toContain("Turneu anunțat");
    expect(stiri).toContain("abia aștept");
    expect(stiri).not.toContain("Config nou");
  });
});
