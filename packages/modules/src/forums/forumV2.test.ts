import { GcsContentRatingService, GcsForbidden, GcsNotFound, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, doc, type GcsForumWorld } from "../../test/world";
import { allowedBlocks, revealHidden } from "./blocks";
import { registerTopicRatings, TOPIC_RATING_TYPE } from "./ratings";
import { GcsTopicToolsService, savedActionsForForum } from "./topicTools";

let w: GcsForumWorld;
let ratings: GcsContentRatingService;
let tools: GcsTopicToolsService;

beforeEach(async () => {
  w = await createForumWorld();
  ratings = new GcsContentRatingService({ db: w.db, bus: w.bus });
  registerTopicRatings(ratings, { db: w.db, permissions: w.permissions, settings: w.settings, posting: w.posting, queries: w.queries });
  tools = new GcsTopicToolsService(w.posting, { settings: w.settings });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

async function newActor(name: string, group: string): Promise<GcsActor> {
  return w.actorFor(await w.createUser(name, group));
}

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("nodul „Pagină / Anunț” (ForumType.PAGE)", () => {
  test("se creează gol, apare în listă ca un forum, se deschide ca pagină cu conținut bogat și buton CTA", async () => {
    const { category } = await w.createTree();
    const page = await w.forums.create({ parentId: category.id, type: "PAGE", name: "Recrutare staff", icon: "fa-solid fa-bullhorn" }, w.root);
    expect(await w.db.forumPage.findUnique({ where: { forumId: page.id } })).toMatchObject({ contentHtml: "", allowTopics: false });

    await w.forums.savePage(w.root, page.id, {
      content: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Căutăm moderatori" }] }, { type: "gcsSteps", content: [{ type: "gcsStep", attrs: { title: "Aplică" }, content: [p("Completează formularul")] }] }] },
      ctaLabel: "Aplică acum",
      ctaUrl: "/forum/1-recrutare",
      ctaIcon: "fa-solid fa-paper-plane",
    });
    const row = (await w.queries.index(w.guest))[0]!.forums.find((f) => f.id === page.id)!;
    expect(row).toMatchObject({ type: "PAGE", icon: "fa-solid fa-bullhorn", pageTopics: false });
    const view = await w.queries.forum(w.guest, page.id, { page: 1 });
    expect(view.page).toMatchObject({ ctaLabel: "Aplică acum", ctaUrl: "/forum/1-recrutare", allowTopics: false });
    expect(view.page!.html).toContain("<h2>Căutăm moderatori</h2>");
    expect(view.page!.html).toContain('<li class="gcs-blockStep">');
    expect(view.canCreate).toBe(false);
    expect(view.topics).toEqual([]);
  });

  test("topicuri dedesubt (opțional) și CTA validat (text + link sigur, împreună)", async () => {
    const { category } = await w.createTree();
    const page = await w.forums.create({ parentId: category.id, type: "PAGE", name: "Anunțuri" }, w.root);
    await expect(w.forums.savePage(w.root, page.id, { content: null, ctaLabel: "Click", ctaUrl: "javascript:alert(1)" })).rejects.toMatchObject({ fields: { ctaUrl: "invalid_url" } });
    await expect(w.forums.savePage(w.root, page.id, { content: null, ctaLabel: "Click", ctaUrl: "" })).rejects.toMatchObject({ fields: { ctaUrl: "required" } });
    await expect(w.forums.savePage(w.member, page.id, { content: null })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.topics.create(w.member, { forumId: page.id, title: "Întrebare", content: doc("x") })).rejects.toBeInstanceOf(GcsValidationError);

    await w.forums.savePage(w.root, page.id, { content: null, allowTopics: true });
    const t = await w.topics.create(w.member, { forumId: page.id, title: "Întrebare despre anunț", content: doc("x") });
    const view = await w.queries.forum(w.member, page.id, { page: 1 });
    expect(view.canCreate).toBe(true);
    expect(view.topics.map((x) => x.id)).toEqual([t.topicId]);
    expect((await w.queries.index(w.guest))[0]!.forums.find((f) => f.id === page.id)).toMatchObject({ pageTopics: true, topicsCount: 1 });
  });

  test("vizibilitatea pe grupuri: pagina lipsește din listă și dă 404 pentru ceilalți (moderatorii globali o văd)", async () => {
    const { category } = await w.createTree();
    const page = await w.forums.create({ parentId: category.id, type: "PAGE", name: "Doar VIP" }, w.root);
    await w.forums.savePage(w.root, page.id, { content: null, audienceGroupIds: [w.groups.vip_gold!] });
    const vip = await newActor("Gold", "vip_gold");
    const ids = async (actor: GcsActor) => (await w.queries.index(actor)).flatMap((c) => c.forums.map((f) => f.id));
    expect(await ids(vip)).toContain(page.id);
    expect(await ids(w.member)).not.toContain(page.id);
    expect(await ids(w.root)).toContain(page.id);
    await expect(w.queries.forum(w.member, page.id, { page: 1 })).rejects.toBeInstanceOf(GcsNotFound);
    await expect(w.forums.savePage(w.root, page.id, { content: null, audienceGroupIds: [999_999] })).rejects.toMatchObject({ fields: { audienceGroupIds: "invalid_choice" } });
  });
});

describe("opțiunile forumului", () => {
  test("„doar topicurile mele”: membrii își văd doar topicurile; ceilalți primesc 404; moderatorii văd tot; listele adunate nu le arată", async () => {
    const { forum } = await w.createTree();
    await w.forums.saveOptions(w.root, forum.id, { ownTopicsOnly: true });
    const other = await newActor("Ana", "member");
    const mine = await w.topics.create(w.member, { forumId: forum.id, title: "Cererea mea", content: doc("x") });
    const theirs = await w.topics.create(other, { forumId: forum.id, title: "Cererea Anei", content: doc("x") });
    expect((await w.queries.forum(w.member, forum.id, { page: 1 })).topics.map((t) => t.id)).toEqual([mine.topicId]);
    expect((await w.queries.forum(w.root, forum.id, { page: 1 })).topics).toHaveLength(2);
    expect((await w.queries.forum(w.guest, forum.id, { page: 1 })).topics).toEqual([]);
    await expect(w.queries.topic(w.member, theirs.topicId, { page: 1 })).rejects.toBeInstanceOf(GcsNotFound);
    await w.clearFlood(w.member);
    await expect(w.posts.reply(w.member, { topicId: theirs.topicId, content: doc("intru") })).rejects.toBeInstanceOf(GcsNotFound);
    expect((await w.queries.recentTopics(w.member, 10)).map((t) => t.id)).toEqual([mine.topicId]);
    // Rândul forumului nu arată titlul ultimului topic (ar fi al altcuiva).
    expect((await w.queries.index(w.member))[0]!.forums[0]!.last).toBeNull();
  });

  test("regulile de acceptat, pragul de postări, sondajele și tag-urile oprite", async () => {
    const { forum } = await w.createTree();
    await w.forums.saveOptions(w.root, forum.id, { rulesMode: "accept", rules: { type: "doc", content: [p("Fără spam.")] }, pollsEnabled: false, tagsEnabled: false });
    expect((await w.queries.forum(w.member, forum.id, { page: 1 })).rulesHtml).toBe("<p>Fără spam.</p>");
    await expect(w.topics.create(w.member, { forumId: forum.id, title: "Salut lume", content: doc("x") })).rejects.toMatchObject({ params: { reason: "rules_not_accepted" } });
    await w.db.forumRulesAcceptance.create({ data: { forumId: forum.id, userId: w.member.userId! } });
    await expect(w.topics.create(w.member, { forumId: forum.id, title: "Cu sondaj", content: doc("x"), poll: { question: "Da?", options: ["Da", "Nu"], multiple: false } })).rejects.toMatchObject({ fields: { poll: "disabled" } });
    await expect(w.topics.create(w.member, { forumId: forum.id, title: "Cu tag", content: doc("x"), tags: ["cs2"] })).rejects.toMatchObject({ fields: { tags: "disabled" } });
    expect((await w.topics.create(w.member, { forumId: forum.id, title: "Acum merge", content: doc("x") })).pending).toBe(false);

    await w.forums.saveOptions(w.root, forum.id, { minPosts: 5 });
    const newbie = await newActor("Nou", "member");
    await w.db.forumRulesAcceptance.create({ data: { forumId: forum.id, userId: newbie.userId! } });
    await expect(w.topics.create(newbie, { forumId: forum.id, title: "Prea devreme", content: doc("x") })).rejects.toMatchObject({ params: { reason: "min_posts" } });
    // Schimbarea regulilor cere din nou acceptarea.
    await w.forums.saveOptions(w.root, forum.id, { rules: { type: "doc", content: [p("Reguli noi.")] } });
    expect(await w.db.forumRulesAcceptance.count({ where: { forumId: forum.id } })).toBe(0);
  });

  test("parola se salvează ca hash; „numără postările” oprit nu crește contorul membrului; sortarea implicită", async () => {
    const { forum } = await w.createTree();
    await w.forums.saveOptions(w.root, forum.id, { password: "secret123", countPosts: false, defaultSort: "title" });
    const row = await w.db.forum.findUniqueOrThrow({ where: { id: forum.id } });
    expect(row.passwordHash).toMatch(/^\$argon2/);
    expect((await w.queries.forum(w.member, forum.id, { page: 1 })).options).toMatchObject({ hasPassword: true, defaultSort: "title" });
    await w.topics.create(w.member, { forumId: forum.id, title: "Zebra", content: doc("x") });
    await w.clearFlood(w.member);
    await w.topics.create(w.member, { forumId: forum.id, title: "Alfa", content: doc("x") });
    expect((await w.db.user.findUniqueOrThrow({ where: { id: w.member.userId! } })).postsCount).toBe(0);
    expect((await w.queries.forum(w.member, forum.id, { page: 1 })).topics.map((t) => t.title)).toEqual(["Alfa", "Zebra"]);
    expect((await w.queries.forum(w.member, forum.id, { page: 1, sort: "created" })).topics.map((t) => t.title)).toEqual(["Alfa", "Zebra"]);
    await expect(w.forums.saveOptions(w.root, forum.id, { password: "ab" })).rejects.toMatchObject({ fields: { password: "invalid_length" } });
    await w.forums.saveOptions(w.root, forum.id, { password: "" });
    expect((await w.db.forum.findUniqueOrThrow({ where: { id: forum.id } })).passwordHash).toBeNull();
  });
});

describe("nota cu stele pe topicuri", () => {
  test("pornită pe forum: media cu jumătăți, sortarea „Cele mai bine notate” și filtrul 4★+", async () => {
    const { forum } = await w.createTree();
    const author = await newActor("Autor", "member");
    const t1 = await w.topics.create(author, { forumId: forum.id, title: "Ghid bun", content: doc("x") });
    await w.clearFlood(author);
    const t2 = await w.topics.create(author, { forumId: forum.id, title: "Ghid slab", content: doc("x") });
    await expect(ratings.rate(w.member, TOPIC_RATING_TYPE, String(t1.topicId), 5)).rejects.toMatchObject({ params: { reason: "disabled" } });

    await w.forums.saveOptions(w.root, forum.id, { ratingEnabled: true });
    const voter = await newActor("Votant", "member");
    await ratings.rate(w.member, TOPIC_RATING_TYPE, String(t1.topicId), 5);
    await ratings.rate(voter, TOPIC_RATING_TYPE, String(t1.topicId), 4);
    await ratings.rate(w.member, TOPIC_RATING_TYPE, String(t2.topicId), 2);
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: t1.topicId } })).toMatchObject({ ratingAvg: 4.5, ratingCount: 2 });

    const sorted = await w.queries.forum(w.member, forum.id, { page: 1, sort: "rating" });
    expect(sorted.topics.map((t) => t.id)).toEqual([t1.topicId, t2.topicId]);
    expect(sorted.topics[0]!.rating).toEqual({ avg: 4.5, count: 2 });
    expect((await w.queries.forum(w.member, forum.id, { page: 1, minRating: 4 })).topics.map((t) => t.id)).toEqual([t1.topicId]);
    expect((await w.queries.topic(w.member, t1.topicId, { page: 1 })).topic.rating).toEqual({ avg: 4.5, count: 2 });
    expect((await w.queries.topRated(w.guest, { limit: 5, minVotes: 2, days: 0 })).map((t) => t.id)).toEqual([t1.topicId]);
  });

  test("autorul nu-și notează topicul (setarea), vechimea și postările minime, schimbarea votului oprită, grupurile din matrice", async () => {
    const { forum } = await w.createTree();
    await w.forums.saveOptions(w.root, forum.id, { ratingEnabled: true });
    const t = await w.topics.create(w.member, { forumId: forum.id, title: "Topicul meu", content: doc("x") });
    const id = String(t.topicId);
    await expect(ratings.rate(w.member, TOPIC_RATING_TYPE, id, 5)).rejects.toMatchObject({ params: { reason: "own_content" } });
    await w.settings.set("forums.rating_own", true, w.root);
    expect(await ratings.rate(w.member, TOPIC_RATING_TYPE, id, 5)).toEqual({ avg: 5, count: 1 });

    const fresh = await newActor("Proaspăt", "member");
    await w.settings.set("forums.rating_min_posts", 3, w.root);
    await expect(ratings.rate(fresh, TOPIC_RATING_TYPE, id, 4)).rejects.toMatchObject({ params: { reason: "not_enough_posts" } });
    await w.settings.set("forums.rating_min_posts", 0, w.root);
    await w.settings.set("forums.rating_min_age_days", 7, w.root);
    await expect(ratings.rate(fresh, TOPIC_RATING_TYPE, id, 4)).rejects.toMatchObject({ params: { reason: "account_too_new" } });
    await w.settings.set("forums.rating_min_age_days", 0, w.root);

    await w.settings.set("forums.rating_change_vote", false, w.root);
    await ratings.rate(fresh, TOPIC_RATING_TYPE, id, 4);
    await expect(ratings.rate(fresh, TOPIC_RATING_TYPE, id, 1)).rejects.toMatchObject({ params: { reason: "already_rated" } });

    // Grupul scos din „Notează topicurile” (matricea forumului) nu mai poate nota.
    const rows = await w.db.containerPermission.findMany({ where: { containerType: "forum", action: "forums.rate", groupId: w.groups.member! } });
    expect(rows.length).toBeGreaterThan(0);
    await w.db.containerPermission.deleteMany({ where: { containerType: "forum", action: "forums.rate", groupId: w.groups.member! } });
    await w.permissions.bumpVersion();
    const late = await newActor("Târziu", "member");
    await expect(ratings.rate(late, TOPIC_RATING_TYPE, id, 3)).rejects.toMatchObject({ params: { reason: "no_permission" } });

    // Resetarea notelor forumului (ACP).
    await w.forums.resetRatings(w.root, forum.id);
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: t.topicId } })).toMatchObject({ ratingAvg: 0, ratingCount: 0 });
  });
});

describe("uneltele topicului", () => {
  test("„Adaugă mesaj”: mesajul moderatorului apare sus; membrii nu pot; ștergerea; istoricul moderării", async () => {
    const { forum } = await w.createTree();
    const t = await w.topics.create(w.member, { forumId: forum.id, title: "Problemă server", content: doc("x") });
    await expect(tools.addNotice(w.member, t.topicId, { content: doc("x"), tone: "info" })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(tools.addNotice(w.root, t.topicId, { content: doc("x"), tone: "rainbow" })).rejects.toBeInstanceOf(GcsValidationError);
    const noticeId = await tools.addNotice(w.root, t.topicId, { content: doc("Topicul e în lucru."), tone: "warn" });
    const page = await w.queries.topic(w.member, t.topicId, { page: 1 });
    expect(page.notices).toEqual([expect.objectContaining({ id: noticeId, html: "<p>Topicul e în lucru.</p>", tone: "warn" })]);
    expect(page.notices[0]!.author?.id).toBe(w.root.userId);

    await w.moderation.setPinned(w.root, [t.topicId], true);
    await tools.deleteNotice(w.root, noticeId);
    expect((await w.queries.topic(w.member, t.topicId, { page: 1 })).notices).toEqual([]);
    const history = await tools.history(w.root, t.topicId);
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(["mod.topic.notice", "mod.topic.notice_delete", "mod.topic.pin"]));
    await expect(tools.history(w.member, t.topicId)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("„Recomandat”: un răspuns vizibil (nu prima postare) apare sus pe prima pagină", async () => {
    const { forum } = await w.createTree();
    const t = await w.topics.create(w.member, { forumId: forum.id, title: "Întrebare", content: doc("Cum?") });
    const helper = await newActor("Ajutor", "member");
    const reply = await w.posts.reply(helper, { topicId: t.topicId, content: doc("Așa.") });
    await expect(tools.setRecommended(w.root, t.topicId, t.postId)).rejects.toMatchObject({ fields: { postId: "invalid_choice" } });
    await expect(tools.setRecommended(w.member, t.topicId, reply.postId)).rejects.toBeInstanceOf(GcsForbidden);
    await tools.setRecommended(w.root, t.topicId, reply.postId);
    const page = await w.queries.topic(w.guest, t.topicId, { page: 1 });
    expect(page.topic.recommendedPostId).toBe(reply.postId);
    expect(page.recommended).toMatchObject({ id: reply.postId, number: 2, html: "<p>Așa.</p>" });
    await tools.setRecommended(w.root, t.topicId, null);
    expect((await w.queries.topic(w.guest, t.topicId, { page: 1 })).recommended).toBeNull();
  });

  test("„Aprobare postări” pe topic: răspunsurile membrilor așteaptă aprobarea, ale moderatorilor nu", async () => {
    const { forum } = await w.createTree();
    const t = await w.topics.create(w.member, { forumId: forum.id, title: "Topic moderat", content: doc("x") });
    await tools.setRequireApproval(w.root, t.topicId, true);
    const other = await newActor("Ana", "member");
    expect((await w.posts.reply(other, { topicId: t.topicId, content: doc("răspuns") })).pending).toBe(true);
    expect((await w.posts.reply(w.root, { topicId: t.topicId, content: doc("staff") })).pending).toBe(false);
  });

  test("acțiunile salvate din meniul topicului: doar cele ale forumului (sau ale tuturor), aplicate dintr-un click", async () => {
    const { forum, category } = await w.createTree();
    const other = await w.forums.create({ parentId: category.id, type: "FORUM", name: "Altul" }, w.root);
    const all = await w.moderation.saveAction(w.root, { name: "Inchide si fixeaza", forumIds: [], actions: { lock: true, pin: true } });
    const here = await w.moderation.saveAction(w.root, { name: "Rezolvat", forumIds: [forum.id], actions: { lock: true } });
    await w.moderation.saveAction(w.root, { name: "Altundeva", forumIds: [other.id], actions: { lock: true } });
    const menu = savedActionsForForum(await w.moderation.listActions(), forum.id);
    expect(menu).toEqual([
      { id: all.id, name: "Inchide si fixeaza" },
      { id: here.id, name: "Rezolvat" },
    ]);
    const t = await w.topics.create(w.member, { forumId: forum.id, title: "De închis", content: doc("x") });
    await w.moderation.applySavedAction(w.root, menu[0]!.id, [t.topicId]);
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: t.topicId } })).toMatchObject({ locked: true, pinned: true });
  });

  test("IP-ul postării doar pentru moderatorii globali; pastila de staff din grupurile de staff; rândul celor care au reacționat", async () => {
    const { forum } = await w.createTree();
    const t = await w.topics.create(w.member, { forumId: forum.id, title: "Salut", content: doc("x") });
    await w.posts.reply(w.root, { topicId: t.topicId, content: doc("Bun venit") });
    const asRoot = await w.queries.topic(w.root, t.topicId, { page: 1 });
    expect(asRoot.posts[0]!.ip).toBe(w.member.ip);
    expect((await w.queries.topic(w.member, t.topicId, { page: 1 })).posts[0]!.ip).toBeNull();
    expect(asRoot.posts.map((p) => p.staff)).toEqual([false, true]);
  });
});

describe("blocurile sigure: permisiunile pe grup și conținutul ascuns", () => {
  test("membrii au blocurile structurate, doar Root Admin are HTML; un bloc nepermis e refuzat la postare", async () => {
    const admin = await newActor("Admin", "admin");
    expect(await allowedBlocks(w, w.member)).not.toContain("html");
    expect(await allowedBlocks(w, w.member)).toContain("callout");
    expect(await allowedBlocks(w, w.root)).toContain("html");
    // Permisiunea dată din greșeală unui alt grup nu deschide HTML-ul (cere și grupul Root Admin).
    await w.db.groupSetting.upsert({ where: { groupId_key: { groupId: w.groups.admin!, key: "forums.block_html" } }, create: { groupId: w.groups.admin!, key: "forums.block_html", value: true }, update: { value: true } });
    await w.permissions.bumpVersion();
    expect(await allowedBlocks(w, admin)).not.toContain("html");

    const { forum } = await w.createTree();
    const html = { type: "doc", content: [{ type: "gcsHtml", attrs: { html: "<p>x</p>" } }] };
    await expect(w.topics.create(w.member, { forumId: forum.id, title: "HTML", content: html })).rejects.toMatchObject({ fields: { content: "block_forbidden" } });
    // Grupul fără blocul „Casetă” (setarea de grup oprită) nu-l poate folosi.
    await w.db.groupSetting.upsert({ where: { groupId_key: { groupId: w.groups.member!, key: "forums.block_callout" } }, create: { groupId: w.groups.member!, key: "forums.block_callout", value: false }, update: { value: false } });
    await w.permissions.bumpVersion();
    await w.clearFlood(w.member);
    const callout = { type: "doc", content: [{ type: "gcsCallout", attrs: { kind: "info" }, content: [p("x")] }] };
    await expect(w.topics.create(w.member, { forumId: forum.id, title: "Casetă", content: callout })).rejects.toMatchObject({ fields: { content: "block_forbidden" } });
  });

  test("„Răspunde ca să vezi”: ascuns vizitatorilor și celor care n-au răspuns; autorul și cine a răspuns îl văd", async () => {
    const { forum } = await w.createTree();
    const content = { type: "doc", content: [p("Giveaway!"), { type: "gcsHidden", attrs: { mode: "reply", label: "Codul" }, content: [p("COD-777")] }] };
    const t = await w.topics.create(w.member, { forumId: forum.id, title: "Giveaway", content });
    const post = await w.db.post.findUniqueOrThrow({ where: { id: t.postId } });
    expect(post.contentHtml).not.toContain("COD-777");

    const firstHtml = async (actor: GcsActor) => (await w.queries.topic(actor, t.topicId, { page: 1, locale: "ro" })).posts[0]!.html;
    const reader = await newActor("Cititor", "member");
    expect(await firstHtml(w.guest)).toContain("gcs-hiddenBlock--locked");
    expect(await firstHtml(w.guest)).not.toContain("COD-777");
    expect(await firstHtml(reader)).not.toContain("COD-777");
    expect(await firstHtml(w.member)).toContain("COD-777");
    await w.posts.reply(reader, { topicId: t.topicId, content: doc("Mersi!") });
    expect(await firstHtml(reader)).toContain("COD-777");
    // Grupurile: doar membrii grupurilor alese.
    expect(revealHidden(post.contentHtml, post.hiddenParts, { userId: "x", groupIds: [], replied: true, isAuthor: false })).toContain("COD-777");
    const groupOnly = revealHidden('<div class="gcs-hiddenBlock" data-hidden-id="h1" data-hidden-mode="groups"></div>', [{ id: "h1", mode: "groups", groups: [5], label: null, html: "<p>VIP</p>" }], { userId: "x", groupIds: [4], replied: true, isAuthor: false });
    expect(groupOnly).not.toContain("<p>VIP</p>");
  });
});

describe("votul Q&A", () => {
  test("membrii votează răspunsurile (+1 / −1, al doilea click îl anulează); scorul și votul meu apar în topic", async () => {
    const { forum } = await w.createTree({ type: "QA" });
    const q = await w.topics.create(w.member, { forumId: forum.id, title: "Cum setez tickrate?", content: doc("Ajutor") });
    const helper = await newActor("Ajutor", "member");
    const answer = await w.posts.reply(helper, { topicId: q.topicId, content: doc("Cu -tickrate 128") });
    const ana = await newActor("Ana", "member");

    expect(await tools.vote(w.member, answer.postId, 1)).toEqual({ score: 1, mine: 1 });
    expect(await tools.vote(ana, answer.postId, 1)).toEqual({ score: 2, mine: 1 });
    expect(await tools.vote(ana, answer.postId, -1)).toEqual({ score: 0, mine: -1 });
    expect(await tools.vote(ana, answer.postId, -1)).toEqual({ score: 1, mine: 0 });

    const page = await w.queries.topic(w.member, q.topicId, { page: 1 });
    expect(page.posts.find((p) => p.id === answer.postId)).toMatchObject({ votes: { score: 1, mine: 1 } });
    expect((await w.queries.topic(w.guest, q.topicId, { page: 1 })).posts.find((p) => p.id === answer.postId)).toMatchObject({ votes: { score: 1, mine: 0 } });
  });

  test("nu pe propria postare, nu ca vizitator, nu în afara Q&A, nu când setarea e oprită", async () => {
    const { forum, category } = await w.createTree({ type: "QA" });
    const q = await w.topics.create(w.member, { forumId: forum.id, title: "Întrebare", content: doc("?") });
    const helper = await newActor("Ajutor", "member");
    const answer = await w.posts.reply(helper, { topicId: q.topicId, content: doc("!") });
    await expect(tools.vote(helper, answer.postId, 1)).rejects.toMatchObject({ fields: { postId: "own_post" } });
    await expect(tools.vote(w.guest, answer.postId, 1)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(tools.vote(w.member, answer.postId, 2 as 1)).rejects.toMatchObject({ fields: { value: "invalid_choice" } });

    const plain = await w.forums.create({ parentId: category.id, type: "FORUM", name: "Discuții" }, w.root);
    await w.clearFlood(w.member);
    await w.clearFlood(helper);
    const t = await w.topics.create(w.member, { forumId: plain.id, title: "Discuție", content: doc("x") });
    const r = await w.posts.reply(helper, { topicId: t.topicId, content: doc("y") });
    await expect(tools.vote(w.member, r.postId, 1)).rejects.toMatchObject({ fields: { forum: "not_qa" } });
    expect((await w.queries.topic(w.member, t.topicId, { page: 1 })).posts[1]!.votes).toBeNull();

    await w.settings.set("forums.qa_voting", false, w.root);
    await expect(tools.vote(w.member, answer.postId, 1)).rejects.toMatchObject({ fields: { forum: "voting_off" } });
    expect((await w.queries.topic(w.member, q.topicId, { page: 1 })).posts[1]!.votes).toBeNull();
    await expect(tools.vote(w.member, 999_999, 1)).rejects.toBeInstanceOf(GcsNotFound);
  });
});
