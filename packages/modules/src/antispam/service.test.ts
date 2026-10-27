import { solvePow } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, doc, type GcsForumWorld } from "../../test/world";

let w: GcsForumWorld;
let forumId: number;

beforeEach(async () => {
  w = await createForumWorld();
  forumId = (await w.createTree()).forum.id;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const set = (key: string, value: unknown) => w.settings.set(key, value, w.root);
const check = (overrides: Partial<Parameters<GcsForumWorld["antispam"]["verifyRegistration"]>[0]> = {}) =>
  w.antispam.verifyRegistration({ ip: "198.51.100.7", email: "nou@mail.test", pow: null, questionId: null, answer: null, locale: "ro", ...overrides });
const logKinds = async () => (await w.db.spamLog.findMany({ orderBy: { id: "asc" } })).map((l) => l.kind);

describe("înregistrarea", () => {
  test("captcha-ul proof-of-work: soluția trece o dată; fără soluție sau refolosită → refuz în jurnal", async () => {
    await set("antispam.pow_difficulty", 8);
    const challenge = await w.antispam.powChallenge();
    const token = solvePow(challenge);
    await expect(check({ pow: token })).resolves.toBeUndefined();
    await expect(check({ pow: token })).rejects.toMatchObject({ params: { reason: "captcha_failed" } });
    await expect(check()).rejects.toMatchObject({ params: { reason: "captcha_failed" } });
    expect(await logKinds()).toEqual(["captcha_failed", "captcha_failed"]);
    // Fără captcha (ACP): nu se mai cere.
    await set("antispam.captcha", "none");
    await expect(check()).resolves.toBeUndefined();
  });

  test("întrebarea: răspunsurile acceptate (fără diacritice / litere mari), pe limba vizitatorului", async () => {
    await set("antispam.captcha", "none");
    const q = await w.antispam.saveQuestion(w.root, { locale: null, question: "Ce joc are serverul nostru?", answers: ["Counter-Strike 2", "cs2", ""], enabled: true });
    expect(q.answers).toEqual(["Counter-Strike 2", "cs2"]);
    await w.antispam.saveQuestion(w.root, { locale: "en", question: "English only?", answers: ["yes"], enabled: true });
    await expect(w.antispam.saveQuestion(w.member, { locale: null, question: "Hack?", answers: ["x"], enabled: true })).rejects.toThrow();
    await expect(w.antispam.saveQuestion(w.root, { locale: null, question: "?", answers: [], enabled: true })).rejects.toMatchObject({ fields: { question: "invalid_length", answers: "required" } });

    expect((await w.antispam.registrationChallenge("ro")).question).toEqual({ id: q.id, text: "Ce joc are serverul nostru?" });
    await expect(check({ questionId: q.id })).rejects.toMatchObject({ params: { reason: "qa_failed" } });
    await expect(check({ questionId: q.id, answer: "minecraft" })).rejects.toMatchObject({ params: { reason: "qa_failed" } });
    await expect(check({ questionId: q.id, answer: "  COUNTER-strike 2 " })).resolves.toBeUndefined();
    // Întrebarea în engleză nu e valabilă pentru limba română.
    const en = (await w.antispam.questions(w.root)).find((x) => x.locale === "en")!;
    await expect(check({ questionId: en.id, answer: "yes" })).rejects.toMatchObject({ params: { reason: "qa_failed" } });
    // Oprite din ACP: nu se mai cere nicio întrebare.
    await set("antispam.qa_enabled", false);
    await expect(w.antispam.registrationChallenge("ro")).resolves.toEqual({ captcha: "none", question: null });
    await expect(check()).resolves.toBeUndefined();
  });

  test("lista publică de spammeri: încrederea peste prag blochează, rezultatul stă în cache, o eroare lasă să treacă", async () => {
    await set("antispam.captcha", "none");
    await set("antispam.sfs_enabled", true);
    const calls: string[] = [];
    w.fetchRef.current = async (url) => {
      calls.push(url);
      const listed = url.includes("ip=198.51.100.66");
      return Response.json({ success: 1, ip: { appears: listed ? 1 : 0, confidence: listed ? 92.5 : 0 }, email: { appears: 0 } });
    };
    await expect(check({ ip: "198.51.100.66" })).rejects.toMatchObject({ params: { reason: "spam_source" } });
    await expect(check({ ip: "198.51.100.66" })).rejects.toMatchObject({ params: { reason: "spam_source" } });
    expect(calls.filter((u) => u.includes("198.51.100.66"))).toHaveLength(1);
    await expect(check({ ip: "198.51.100.67", email: "curat@mail.test" })).resolves.toBeUndefined();
    w.fetchRef.current = async () => {
      throw new Error("timeout");
    };
    await expect(check({ ip: "198.51.100.68", email: "altul@mail.test" })).resolves.toBeUndefined();
    expect(await logKinds()).toEqual(["spam_source", "spam_source"]);
  });
});

describe("conținutul", () => {
  test("un link de phishing se refuză oricui, în postare și la editare", async () => {
    const t = await w.topics.create(w.member, { forumId, title: "Schimburi de skinuri", content: doc("salut") });
    await w.clearFlood(w.member);
    await expect(w.posts.reply(w.member, { topicId: t.topicId, content: doc("ia cadou: steamcornmunity.com/gift/123") })).rejects.toMatchObject({ params: { reason: "phishing_link", domain: "steamcornmunity.com" } });
    await expect(w.posts.edit(w.member, t.postId, { content: doc("vezi https://steamcommunity.com.verify-login.ru/") })).rejects.toMatchObject({ params: { reason: "phishing_link" } });
    await expect(w.posts.reply(w.root, { topicId: t.topicId, content: doc("https://steamcommunlty.com/id/x") })).rejects.toMatchObject({ params: { reason: "phishing_link" } });
    // Linkurile oficiale trec; lista „permise” din ACP câștigă.
    await w.clearFlood(w.member);
    await expect(w.posts.reply(w.member, { topicId: t.topicId, content: doc("profilul meu: https://steamcommunity.com/id/mara") })).resolves.toMatchObject({ pending: false });
    await set("antispam.phishing_allow", "steamcornmunity.com");
    await w.clearFlood(w.member);
    await expect(w.posts.reply(w.member, { topicId: t.topicId, content: doc("steamcornmunity.com") })).resolves.toMatchObject({ pending: false });
    expect(await logKinds()).toEqual(["phishing_blocked", "phishing_blocked", "phishing_blocked"]);
  });

  test("membrii noi: linkurile intră în aprobare (moderatorii nu), blocate în PM / chat; imaginile limitate", async () => {
    await set("antispam.new_member_days", 7);
    const t = await w.topics.create(w.root, { forumId, title: "Anunțuri", content: doc("bun venit") });
    await expect(w.posts.reply(w.member, { topicId: t.topicId, content: doc("intră pe https://exemplu.test/server") })).resolves.toMatchObject({ pending: true });
    await w.clearFlood(w.member);
    await expect(w.posts.reply(w.member, { topicId: t.topicId, content: doc("fără linkuri") })).resolves.toMatchObject({ pending: false });
    await w.clearFlood(w.root);
    await expect(w.posts.reply(w.root, { topicId: t.topicId, content: doc("https://exemplu.test/regulament") })).resolves.toMatchObject({ pending: false });
    await expect(w.antispam.checkContent(w.member, { kind: "chat", text: "www.exemplu.test" })).rejects.toMatchObject({ params: { reason: "new_member_links" } });
    await expect(w.antispam.checkContent(w.member, { kind: "pm", html: '<p><img src="/a"><img src="/b"><img src="/c"></p>', text: "" })).rejects.toMatchObject({ params: { reason: "new_member_images", max: "2" } });
    await set("antispam.new_member_links", "block");
    await w.clearFlood(w.member);
    await expect(w.posts.reply(w.member, { topicId: t.topicId, content: doc("https://exemplu.test") })).rejects.toMatchObject({ params: { reason: "new_member_links" } });
    // Linkurile spre site-ul propriu nu contează.
    await set("site.url", "https://forum.test");
    await expect(w.antispam.checkContent(w.member, { kind: "chat", text: "https://forum.test/topic/1" })).resolves.toEqual({ moderate: false });
    // Un membru vechi (după zilele de probă) nu mai are restricții.
    await w.db.user.update({ where: { id: w.member.userId! }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    await expect(w.antispam.checkContent(w.member, { kind: "chat", text: "https://exemplu.test" })).resolves.toEqual({ moderate: false });
    expect(await logKinds()).toEqual(["links_moderated", "links_blocked", "images_blocked", "links_blocked"]);
  });

  test("membrii noi: aprobarea tuturor postărilor, mesajele private pe zi și ritmul din chat", async () => {
    await set("antispam.new_member_posts", 5);
    await set("antispam.new_member_approval", true);
    await expect(w.antispam.checkContent(w.member, { kind: "post", text: "salut" })).resolves.toEqual({ moderate: true });
    await expect(w.antispam.checkContent(w.member, { kind: "status", text: "salut" })).resolves.toEqual({ moderate: false });
    await set("antispam.new_member_pms_per_day", 2);
    await w.antispam.checkPmQuota(w.member);
    await w.antispam.checkPmQuota(w.member);
    await expect(w.antispam.checkPmQuota(w.member)).rejects.toMatchObject({ code: "rate_limited", params: { reason: "new_member_pm_limit" } });
    await w.antispam.checkChatPace(w.member);
    await expect(w.antispam.checkChatPace(w.member)).rejects.toMatchObject({ params: { reason: "slow_mode" } });
    // Peste pragul de postări aprobate, membrul nu mai e nou.
    await w.db.user.update({ where: { id: w.member.userId! }, data: { approvedPostsCount: 5 } });
    await expect(w.antispam.isNewMember(w.member.userId)).resolves.toBe(false);
  });
});

describe("„Marchează ca spammer”", () => {
  test("ban pe cont, IP și domeniu, conținutul ascuns, jurnalul; fără drept sau pe propriul cont → refuz", async () => {
    w.antispam.registerContent({
      key: "forums.posts",
      hide: async (userId, actor) => {
        const rows = await w.db.post.findMany({ where: { authorId: userId, visibility: "VISIBLE" }, select: { id: true } });
        for (const r of rows) await w.posts.hide(actor, r.id, "spam");
        return rows.length;
      },
    });
    const spammerUser = await w.createUser("Reclama", "member");
    await w.db.user.update({ where: { id: spammerUser.id }, data: { email: "bot@spam-mail.test", registrationIp: "203.0.113.77" } });
    const spammer = await w.actorFor(spammerUser);
    const t = await w.topics.create(w.root, { forumId, title: "Topic", content: doc("text") });
    await w.posts.reply(spammer, { topicId: t.topicId, content: doc("cumpără acum") });

    await expect(w.antispam.markSpammer(w.member, spammerUser.id, { banIp: true, banEmailDomain: true, hideContent: true, report: false })).rejects.toThrow();
    await expect(w.antispam.markSpammer(w.root, w.root.userId!, { banIp: false, banEmailDomain: false, hideContent: false, report: false })).rejects.toMatchObject({ params: { reason: "self" } });

    const result = await w.antispam.markSpammer(w.root, spammerUser.id, { banIp: true, banEmailDomain: true, hideContent: true, report: true, reason: "reclame" });
    expect(result).toEqual({ banned: true, ips: ["203.0.113.77"], domain: "spam-mail.test", hidden: { "forums.posts": 1 }, reported: false });
    expect((await w.db.user.findUniqueOrThrow({ where: { id: spammerUser.id } })).isSpammer).toBe(true);
    await expect(w.bans.activeFor({ userId: spammerUser.id })).resolves.toMatchObject({ type: "ACCOUNT", reason: "reclame" });
    await expect(w.bans.activeFor({ ip: "203.0.113.77" })).resolves.toMatchObject({ type: "IP" });
    await expect(w.bans.activeFor({ email: "altul@spam-mail.test" })).resolves.toMatchObject({ type: "EMAIL" });
    expect(await w.db.post.count({ where: { authorId: spammerUser.id, visibility: "VISIBLE" } })).toBe(0);
    expect(await logKinds()).toEqual(["spammer_marked"]);

    // Furnizorii mari de email nu se banează ca domeniu.
    const other = await w.createUser("Altul", "member");
    await w.db.user.update({ where: { id: other.id }, data: { email: "cineva@gmail.com", registrationIp: "127.0.0.1" } });
    // Nici IP-urile locale / private (un proxy greșit ar bloca tot site-ul).
    await w.db.session.create({ data: { id: "spam-sess", token: "spam-sess", userId: other.id, ipAddress: "192.168.1.5", expiresAt: new Date(Date.now() + 86_400_000) } });
    await expect(w.antispam.markSpammer(w.root, other.id, { banIp: true, banEmailDomain: true, hideContent: false, report: false })).resolves.toMatchObject({ domain: null, ips: [] });

  });
});

describe("jurnalul și statisticile", () => {
  test("pe tip și pe zi; filtrele; doar staff-ul cu acces la Anti-spam", async () => {
    await w.antispam.log("captcha_failed", { ip: "198.51.100.1" });
    await w.antispam.log("captcha_failed", { ip: "198.51.100.2" });
    await w.antispam.log("phishing_blocked", { userId: w.member.userId, detail: { domain: "x.test" } });
    const stats = await w.antispam.stats(w.root, 7);
    expect(stats.total).toBe(3);
    expect(stats.byKind).toEqual({ captcha_failed: 2, phishing_blocked: 1 });
    expect(stats.perDay).toHaveLength(7);
    expect(stats.perDay.at(-1)!.count).toBe(3);
    const filtered = await w.antispam.logs(w.root, { kind: "captcha_failed" });
    expect(filtered.rows.map((r) => r.ip)).toEqual(["198.51.100.2", "198.51.100.1"]);
    expect((await w.antispam.logs(w.root, { kind: "phishing_blocked" })).rows[0]!.user?.name).toBe("Mara");
    expect((await w.antispam.logs(w.root, { q: "198.51.100.1" })).total).toBe(1);
    await expect(w.antispam.stats(w.member)).rejects.toThrow();
  });
});
