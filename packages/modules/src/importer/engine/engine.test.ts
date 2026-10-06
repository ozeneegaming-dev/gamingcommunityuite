import { verifyPassword, type GcsDocNode, type GcsJobQueue } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, type GcsForumWorld } from "../../../test/world";
import { RENDER_LABELS } from "../../forums/labels";
import { coreSchemaFixture, prefixedSchemaFixture } from "../fixtures";
import { GcsImportService, type GcsImportConfigInput } from "../service";
import { GcsImportMap } from "./map";

let w: GcsForumWorld;
let importer: GcsImportService;
const enqueued: string[] = [];

/** Coada falsă: testele rulează importul direct (`importer.run`), ca worker-ul. */
const jobs = { register: () => {}, enqueue: async (_name: string, data: { jobId?: unknown }) => void enqueued.push(String(data.jobId)) } as unknown as GcsJobQueue;

function makeImporter(world: GcsForumWorld): GcsImportService {
  return new GcsImportService(deps(world));
}

function deps(world: GcsForumWorld): ConstructorParameters<typeof GcsImportService>[0] {
  return {
    db: world.db,
    bus: world.bus,
    registry: world.registry,
    attachments: world.attachments,
    groups: world.groupService,
    permissions: world.permissions,
    actors: world.actors,
    cache: world.cache,
    jobs,
    acp: world.acp,
    settings: world.settings,
    renderOptions: async () => ({ embeds: ["youtube", "twitch", "medal", "image"], siteHost: "forum.test", labels: RENDER_LABELS.ro! }),
    clearCache: async () => {},
  };
}

const config = (database: "core-schema" | "prefixed-schema", oldUrl: string): GcsImportConfigInput => ({
  host: "fixture",
  port: 3306,
  database,
  user: "",
  prefix: "",
  filesMode: "folder",
  filesPath: process.platform === "win32" ? "C:\\vechi" : "/vechi",
  oldUrl,
});
const ALL = ["profile_fields", "forums", "attachments", "reactions", "conversations", "follows", "warnings", "statuses"];

/** Configurare + test + pornire + rulare (ca din ACP, cu worker-ul). */
async function runImport(database: "core-schema" | "prefixed-schema", oldUrl: string, opts: { dryRun?: boolean } = {}) {
  const saved = await importer.saveConfig(w.root, config(database, oldUrl));
  const tested = await importer.testConnection(w.root, saved.id);
  expect(tested.status).toBe("READY");
  await importer.start(w.root, saved.id, { dryRun: opts.dryRun ?? false, options: ALL, redirects: true });
  await importer.run(saved.id);
  return importer.get(w.root, saved.id);
}

const nodesOf = (json: unknown): GcsDocNode[] => {
  const out: GcsDocNode[] = [];
  const walk = (n: GcsDocNode) => {
    out.push(n);
    (n.content ?? []).forEach(walk);
  };
  walk(json as GcsDocNode);
  return out;
};

beforeAll(() => {
  process.env.GCS_TEST_ROUTES = "1";
});

beforeEach(async () => {
  w = await createForumWorld();
  importer = makeImporter(w);
  enqueued.length = 0;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("importul unei comunități core-schema (HTML)", () => {
  test("toți pașii: membri, grupuri, forumuri cu permisiuni, topicuri, postări convertite, PM, urmăriri, redirecturi", async () => {
    const existing = await w.db.user.create({ data: { name: "Existent", nameNormalized: "existent", email: "existent@exemplu.ro", primaryGroupId: w.groups.member! } });
    const job = await runImport("core-schema", "https://vechi.exemplu.ro/forum");
    expect(job.status).toBe("DONE");
    expect(job.detected).toMatchObject({ schema: "core-schema", version: "4.7.18", supported: true, postsPerPage: 25 });
    const step = (key: string) => job.steps.find((s) => s.key === key)!;
    expect(step("members")).toMatchObject({ status: "done", imported: 4, errors: 0 });
    expect(step("topics")).toMatchObject({ imported: 3, skipped: 1 });
    expect(step("posts")).toMatchObject({ imported: 4, errors: 0 });
    expect(step("attachments")).toMatchObject({ imported: 3 });

    const map = new GcsImportMap(w.db, "core-schema@vechi.exemplu.ro");
    const member = async (id: string) => w.db.user.findUniqueOrThrow({ where: { id: (await map.one("member", id))! }, include: { groups: true, accounts: true, bans: true, profileValues: true } });

    // Grupurile după rol; „Veterani” devine un grup nou, cu culoarea lui.
    const groups = await map.all("group");
    expect(Number(groups.get("4"))).toBe(w.groups.admin);
    expect(Number(groups.get("6"))).toBe(w.groups.super_moderator);
    expect(Number(groups.get("2"))).toBe(w.groups.guest);
    const veterani = await w.db.group.findUniqueOrThrow({ where: { id: Number(groups.get("7")) } });
    expect(veterani).toMatchObject({ name: "Veterani", color: "#29A3A3" });

    // Membrii: grupuri, IP, reputație, titlu, semnătură, avatar, parola veche, banul, legarea după email.
    const admin = await member("1");
    expect(admin).toMatchObject({ name: "Vechiul Admin", primaryGroupId: w.groups.admin, registrationIp: "198.51.100.10", reputation: 42, customTitle: "Fondator" });
    expect(admin.signatureHtml).toContain("<em>2010</em>");
    expect(admin.image).toMatch(/^\/files\//);
    await expect(verifyPassword(admin.accounts[0]!.password!, "parola-veche-1")).resolves.toBe(true);
    const ana = await member("2");
    expect(ana.email).toBe("ana@exemplu.ro");
    expect(ana.groups.map((g) => g.groupId)).toEqual([veterani.id]);
    await expect(verifyPassword(ana.accounts[0]!.password!, "parola-veche-2")).resolves.toBe(true);
    const codrin = await member("3");
    expect(codrin.bans).toHaveLength(1);
    await expect(verifyPassword(codrin.accounts[0]!.password!, "parola-veche-3")).resolves.toBe(true);
    expect(await map.one("member", "4")).toBe(existing.id);
    expect(await w.db.user.count({ where: { email: "existent@exemplu.ro" } })).toBe(1);
    expect(admin.profileValues.map((v) => v.value).sort()).toEqual(["03.05.1990", "Rust"]);

    // Forumurile și matricea de permisiuni tradusă.
    const forumId = async (id: string) => Number(await map.one("forum", id));
    const general = await w.db.forum.findUniqueOrThrow({ where: { id: await forumId("2") } });
    expect(general).toMatchObject({ name: "Discuții generale", type: "FORUM", parentId: await forumId("1"), description: "Despre orice." });
    expect((await w.db.forum.findUniqueOrThrow({ where: { id: await forumId("4") } })).linkUrl).toBe("https://exemplu.ro/");
    const can = async (groupKey: string, forum: string, action: string) =>
      (await w.db.containerPermission.count({ where: { containerType: "forum", containerId: String(await forumId(forum)), groupId: w.groups[groupKey]!, action } })) > 0;
    expect(await can("guest", "2", "forums.read")).toBe(true);
    expect(await can("guest", "2", "forums.reply")).toBe(false);
    expect(await can("member", "2", "forums.reply")).toBe(true);
    expect(await can("new_member", "2", "forums.reply")).toBe(true);
    expect(await can("member", "3", "forums.read")).toBe(false);
    expect(await can("super_moderator", "3", "forums.read")).toBe(true);
    expect(await can("root_admin", "3", "forums.read")).toBe(true);

    // Topicul cu prefix, tag-uri și sondaj; topicul mutat lipsește; cel ascuns rămâne ascuns.
    const topic = await w.db.topic.findUniqueOrThrow({ where: { id: Number(await map.one("topic", "10")) }, include: { prefix: true, tags: { include: { tag: true } }, poll: { include: { options: true, votes: true } } } });
    expect(topic).toMatchObject({ title: "Bun venit pe forum", pinned: true, viewsCount: 120, repliesCount: 1, authorId: admin.id });
    expect(topic.prefix?.name).toBe("Ghid");
    expect(topic.tags.map((t) => t.tag.slug).sort()).toEqual(["config", "cs2"]);
    expect(topic.poll?.options.map((o) => [o.text, o.votesCount])).toEqual([
      ["CS2", 1],
      ["Valorant", 0],
    ]);
    expect(await map.one("topic", "12")).toBeNull();
    expect((await w.db.topic.findUniqueOrThrow({ where: { id: Number(await map.one("topic", "13")) } })).visibility).toBe("HIDDEN");

    // Postările: citatul legat de postarea nouă, mențiunea, atașamentele (inline și la final).
    const postId = async (id: string) => Number(await map.one("post", id));
    const p100 = await w.db.post.findUniqueOrThrow({ where: { id: await postId("100") } });
    const p101 = await w.db.post.findUniqueOrThrow({ where: { id: await postId("101") } });
    const p102 = await w.db.post.findUniqueOrThrow({ where: { id: await postId("102") } });
    expect(topic.firstPostId).toBe(p100.id);
    expect(topic.lastPostId).toBe(p101.id);
    const quote = nodesOf(p101.contentJson).find((n) => n.type === "quote");
    expect(quote?.attrs).toMatchObject({ postId: p100.id, authorId: admin.id });
    expect(nodesOf(p101.contentJson).find((n) => n.type === "mention")?.attrs).toMatchObject({ id: admin.id });
    expect(p100.contentHtml).toContain(`href="/topic/${await map.one("topic", "11")}-configul-meu-de-cs2"`);
    const image = nodesOf(p100.contentJson).find((n) => n.type === "image");
    expect(await w.db.attachment.findUniqueOrThrow({ where: { id: String(image!.attrs!.attachmentId) } })).toMatchObject({ contentType: "forums.post", contentId: String(p100.id) });
    expect(p102.contentHtml).toMatch(/href="\/files\/[a-z0-9]+"[^>]*>config\.cfg<\/a>/);
    expect(p102.contentHtml).not.toMatch(/<script|javascript:/);
    expect(step("posts").unrecognized).toBeGreaterThan(0);

    // Contoarele recalculate.
    expect(general).toBeDefined();
    const generalAfter = await w.db.forum.findUniqueOrThrow({ where: { id: general.id } });
    expect(generalAfter).toMatchObject({ topicsCount: 2, postsCount: 3, lastPostId: p102.id });
    expect((await w.db.user.findUniqueOrThrow({ where: { id: ana.id } })).postsCount).toBe(2);

    // Reacțiile: „Thanks” → thanks, „Confused” (fără corespondent) → Like.
    const reactions = await w.db.contentReaction.findMany({ include: { reaction: true }, orderBy: { id: "asc" } });
    expect(reactions.map((r) => [r.contentId, r.reaction.key])).toEqual([
      [String(p100.id), "thanks"],
      [String(p101.id), "like"],
    ]);

    // Conversația, cu atașamentul și starea de citire.
    const conv = await w.db.conversation.findFirstOrThrow({ include: { participants: true, messages: { orderBy: { id: "asc" } } } });
    expect(conv).toMatchObject({ title: "Salut din privat", messagesCount: 2 });
    const lastRead = Object.fromEntries(conv.participants.map((p) => [p.userId, p.lastReadMessageId]));
    expect(lastRead[ana.id]).toBe(conv.messages[1]!.id);
    expect(lastRead[admin.id]).toBe(conv.messages[0]!.id);
    expect(await w.db.attachment.count({ where: { contentType: "pm.message", contentId: String(conv.messages[0]!.id) } })).toBe(1);

    // Urmăririle, ignorările, avertismentele, status-urile.
    expect(await w.db.follow.count({ where: { userId: ana.id } })).toBe(2);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: admin.id } })).followersCount).toBe(1);
    expect(await w.db.userIgnore.count({ where: { userId: admin.id, ignoredId: codrin.id } })).toBe(1);
    expect(await w.db.warning.findFirstOrThrow({ where: { userId: codrin.id } })).toMatchObject({ points: 2, reason: "Limbaj nepotrivit", issuedById: admin.id });
    const status = await w.db.statusUpdate.findFirstOrThrow({ where: { parentId: null }, include: { replies: true } });
    expect(status).toMatchObject({ profileUserId: ana.id, repliesCount: 1 });

    // Redirecturile 301 (pornite la final, cu prefixul căii vechi).
    const t10 = await map.one("topic", "10");
    expect(await importer.resolveLegacy("/forum/topic/10-bun-venit-pe-forum/", "")).toBe(`/topic/${t10}-bun-venit-pe-forum`);
    expect(await importer.resolveLegacy("/forum/topic/10-bun-venit-pe-forum/page/2/", "")).toBe(`/topic/${t10}-bun-venit-pe-forum?page=2`);
    expect(await importer.resolveLegacy("/forum/topic/10-x/", "?do=findComment&comment=101")).toBe(`/topic/${t10}/post/${p101.id}`);
    expect(await importer.resolveLegacy("/forum/profile/2-ana-pop/", "")).toBe(`/members/${ana.id}-ana-pop`);
    expect(await importer.resolveLegacy("/forum/index.php", "?showforum=2")).toBe(`/forum/${general.id}-discutii-generale`);
    expect(await importer.resolveLegacy("/altceva/topic/10-x/", "")).toBeNull();
    expect(await w.db.auditLog.count({ where: { action: { in: ["import.test", "import.start"] } } })).toBe(2);
  });

  test("o rulare nouă (sincronizare) nu dublează nimic; harta rămâne aceeași", async () => {
    const first = await runImport("core-schema", "https://vechi.exemplu.ro/forum");
    const counts = async () => ({
      users: await w.db.user.count(),
      topics: await w.db.topic.count(),
      posts: await w.db.post.count(),
      attachments: await w.db.attachment.count(),
      map: await w.db.importMap.count(),
      reactions: await w.db.contentReaction.count(),
      follows: await w.db.follow.count(),
    });
    const before = await counts();
    await importer.start(w.root, first.id, { dryRun: false, options: ALL, redirects: true });
    await importer.run(first.id);
    const again = await importer.get(w.root, first.id);
    expect(again.status).toBe("DONE");
    expect(again.steps.find((s) => s.key === "posts")).toMatchObject({ imported: 0, skipped: 4 });
    expect(await counts()).toEqual(before);
  });

  test("pauza oprește între loturi, reluarea continuă până la capăt", async () => {
    const saved = await importer.saveConfig(w.root, config("core-schema", "https://vechi.exemplu.ro/forum"));
    await importer.testConnection(w.root, saved.id);
    await importer.start(w.root, saved.id, { dryRun: false, options: ALL, redirects: false });
    // Pauza cerută înainte ca worker-ul să ajungă la primul checkpoint.
    await w.db.importJob.update({ where: { id: saved.id }, data: { control: "pause" } });
    await w.db.importJob.update({ where: { id: saved.id }, data: { status: "QUEUED" } });
    await importer.run(saved.id);
    expect((await importer.get(w.root, saved.id)).status).toBe("PAUSED");
    await importer.resume(w.root, saved.id);
    expect(enqueued).toHaveLength(2);
    await importer.run(saved.id);
    const done = await importer.get(w.root, saved.id);
    expect(done.status).toBe("DONE");
    expect(done.steps.find((s) => s.key === "posts")).toMatchObject({ imported: 4 });
    expect((await importer.redirectConfig(w.root)).enabled).toBe(false);
  });

  test("rularea de probă doar numără: nimic nu se scrie în tabelele site-ului", async () => {
    await w.db.user.create({ data: { name: "Existent", nameNormalized: "existent", email: "existent@exemplu.ro", primaryGroupId: w.groups.member! } });
    const users = await w.db.user.count();
    const forums = await w.db.forum.count();
    const job = await runImport("core-schema", "https://vechi.exemplu.ro/forum", { dryRun: true });
    expect(job.status).toBe("DONE");
    expect(job.dryRun).toBe(true);
    expect(job.detected?.dryRun).toEqual({ linkedByEmail: 1, sampledPosts: 4, unrecognized: 1, fallbacks: 0 });
    expect(job.steps.find((s) => s.key === "posts")?.total).toBe(4);
    expect(await w.db.user.count()).toBe(users);
    expect(await w.db.forum.count()).toBe(forums);
    expect(await w.db.importMap.count()).toBe(0);
  });

  test("un rând stricat ajunge în lista de erori, restul lotului se importă", async () => {
    // O dată imposibilă pe postarea 103: inserarea ei pică, tranzacția lotului la fel, apoi lotul se reia rând cu rând.
    const broken = () => {
      const f = coreSchemaFixture();
      f.tables.forums_posts!.find((p) => p.pid === 103)!.post_date = 9e15;
      return f;
    };
    importer = new GcsImportService({ ...deps(w), fixtures: { "core-schema": broken, "prefixed-schema": prefixedSchemaFixture } });
    const job = await runImport("core-schema", "https://vechi.exemplu.ro/forum");
    expect(job.status).toBe("DONE");
    expect(job.steps.find((s) => s.key === "posts")).toMatchObject({ imported: 3, errors: 1 });
    const errors = await importer.logs(w.root, job.id, { level: "error" });
    expect(errors.map((e) => [e.step, e.sourceId])).toEqual([["posts", "103"]]);
    // Citatul din postarea 101 indică tot postarea nouă 100 (cache-ul lotului eșuat a fost aruncat).
    const map = new GcsImportMap(w.db, "core-schema@vechi.exemplu.ro");
    const p101 = await w.db.post.findUniqueOrThrow({ where: { id: Number(await map.one("post", "101")) } });
    expect(nodesOf(p101.contentJson).find((n) => n.type === "quote")?.attrs?.postId).toBe(Number(await map.one("post", "100")));
  });

  test("fără drept pe secțiunea ACP → refuzat; configurația invalidă → erori pe câmp", async () => {
    await expect(importer.saveConfig(w.member, config("core-schema", ""))).rejects.toMatchObject({ code: "forbidden" });
    await expect(importer.saveConfig(w.root, { ...config("core-schema", "javascript:alert(1)"), host: "a b", port: 0, prefix: "x;y" })).rejects.toMatchObject({
      fields: { host: "invalid_host", port: "invalid_port", prefix: "invalid_prefix", oldUrl: "invalid_url" },
    });
  });
});

describe("importul unei comunități prefixed-schema (BBCode)", () => {
  test("membri, permisiuni cu `reset` pe nod, BBCode convertit, atașamente din internal_data, redirecturi", async () => {
    const job = await runImport("prefixed-schema", "https://comunitate.exemplu.ro");
    expect(job.status).toBe("DONE");
    expect(job.detected).toMatchObject({ schema: "prefixed-schema", version: "2.2.13", postsPerPage: 20 });
    const map = new GcsImportMap(w.db, "prefixed-schema@comunitate.exemplu.ro");
    const mihai = await w.db.user.findUniqueOrThrow({ where: { id: (await map.one("member", "2"))! }, include: { accounts: true, groups: true } });
    await expect(verifyPassword(mihai.accounts[0]!.password!, "parola-veche-4")).resolves.toBe(true);
    expect(mihai.image).toMatch(/^\/files\//);
    expect(mihai.registrationIp).toBe("203.0.113.2");
    const spammer = await w.db.user.findUniqueOrThrow({ where: { id: (await map.one("member", "3"))! }, include: { accounts: true, bans: true } });
    expect(spammer.accounts).toHaveLength(0);
    expect(spammer.bans[0]?.reason).toBe("Spam");
    // Semnătura ostilă: linkul `javascript:` dispare.
    expect(spammer.signatureHtml).not.toContain("javascript");

    const news = String(await map.one("forum", "2"));
    const can = async (groupKey: string, action: string) => (await w.db.containerPermission.count({ where: { containerType: "forum", containerId: news, groupId: w.groups[groupKey]!, action } })) > 0;
    expect(await can("member", "forums.reply")).toBe(true);
    expect(await can("member", "forums.create")).toBe(false);
    expect(await can("admin", "forums.create")).toBe(true);
    expect(await can("guest", "forums.read")).toBe(true);
    expect(await map.one("forum", "3")).toBeNull();

    const p200 = await w.db.post.findUniqueOrThrow({ where: { id: Number(await map.one("post", "200")) } });
    const p201 = await w.db.post.findUniqueOrThrow({ where: { id: Number(await map.one("post", "201")) } });
    expect(p200.contentHtml).toContain('style="text-align:center"');
    expect(p200.contentHtml).toMatch(/<img class="gcs-postImage" src="\/files\/[a-z0-9]+"/);
    expect(nodesOf(p201.contentJson).find((n) => n.type === "quote")?.attrs).toMatchObject({ postId: p200.id });
    expect(p201.contentHtml).toContain('class="language-php"');
    expect(p201.editedById).toBe(mihai.id);
    expect(p201.ip).toBe("203.0.113.2");
    const reactions = await w.db.contentReaction.findMany({ include: { reaction: true }, orderBy: { id: "asc" } });
    expect(reactions.map((r) => r.reaction.key)).toEqual(["haha", "thanks"]);
    const t20 = await map.one("topic", "20");
    expect(await importer.resolveLegacy("/threads/serverul-se-redeschide.20/", "")).toBe(`/topic/${t20}-serverul-se-redeschide`);
    expect(await importer.resolveLegacy("/index.php", "?threads/x.20/")).toBe(`/topic/${t20}-serverul-se-redeschide`);
    expect(await importer.resolveLegacy("/posts/201/", "")).toBe(`/topic/${t20}/post/${p201.id}`);
    expect(await importer.resolveLegacy(`/members/mihai-ionescu.2/`, "")).toBe(`/members/${mihai.id}-mihai-ionescu`);
    const samples = await importer.redirectSamples(w.root, job.id);
    expect(samples).toEqual([{ from: "/threads/serverul-se-redeschide.20/", to: `/topic/${t20}-serverul-se-redeschide` }]);
  });

  test("redirecturile se pot opri din ACP", async () => {
    const job = await runImport("prefixed-schema", "https://comunitate.exemplu.ro");
    expect(await importer.resolveLegacy("/posts/200/", "")).not.toBeNull();
    await importer.setRedirects(w.root, job.id, false);
    expect(await importer.resolveLegacy("/posts/200/", "")).toBeNull();
    expect(await importer.checkRedirect(w.root, "https://comunitate.exemplu.ro/posts/200/")).toEqual({ from: "/posts/200/", to: null });
  });
});
