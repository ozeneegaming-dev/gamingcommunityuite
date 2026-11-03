import { communityBotId, type GcsActor, type GcsTranslateProvider } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import type { GcsChatService } from "../chat/chat";
import { BOT_WELCOME_SETTING, GcsCommunityBot } from "./service";

let w: GcsProfileWorld;
let bot: GcsCommunityBot;
let botId: string;
let forumId: number;
let now: Date;
let provider: GcsTranslateProvider | null;
const chatSent: { key: string; text: string; bot: boolean }[] = [];

beforeEach(async () => {
  w = await createProfileWorld();
  now = new Date("2026-10-26T10:00:00Z");
  provider = null;
  chatSent.length = 0;
  const chat = {
    send: async (_actor: GcsActor, key: string, text: unknown, opts: { bot?: boolean }) => {
      chatSent.push({ key, text: String(text), bot: opts.bot === true });
      return { id: chatSent.length };
    },
  } as unknown as GcsChatService;
  bot = new GcsCommunityBot({
    db: w.db,
    settings: w.settings,
    topics: w.topics,
    posts: w.posts,
    moderation: w.moderation,
    conversations: w.conversations,
    chat,
    acp: w.acp,
    translator: async () => provider,
    setAvatar: async () => "/avatar.png",
    clock: () => now,
  });
  botId = (await communityBotId(w.db))!;
  forumId = (await w.createTree()).forum.id;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("GcsCommunityBot.post (bot-stiri §1–2)", () => {
  test("topicul e al botului, cu metadatele sursei; fixat și închis la cerere; botul nu urmărește topicul", async () => {
    const res = await bot.post("plugin:gcs.news_bot", {
      forumId,
      title: "Actualizare Counter-Strike 2",
      content: { html: '<p>Note de patch</p><ul><li>[DIVERSE] Mănuși noi</li></ul><script>alert(1)</script><a href="https://example.com/x">link</a>' },
      pin: true,
      lock: true,
      dedupeKey: "gcs.news_bot:steam-730:5001",
      meta: { label: "UPDATE CS2", sourceName: "știrile oficiale Steam", sourceUrl: "https://example.com/x", importEveryMinutes: 30 },
    });
    expect(res).toMatchObject({ duplicate: false });
    const topic = await w.db.topic.findUniqueOrThrow({ where: { id: res!.topicId }, include: { posts: true } });
    expect(topic).toMatchObject({ authorId: botId, pinned: true, locked: true, title: "Actualizare Counter-Strike 2" });
    expect(topic.posts[0]!.contentHtml).toContain("Mănuși noi");
    expect(topic.posts[0]!.contentHtml).not.toContain("<script");
    expect(await w.db.botPost.findFirst({ where: { postId: res!.postId } })).toMatchObject({
      feature: "plugin:gcs.news_bot",
      label: "UPDATE CS2",
      sourceName: "știrile oficiale Steam",
      sourceUrl: "https://example.com/x",
      importEveryMinutes: 30,
      translatedFrom: null,
    });
    expect(await w.db.follow.count({ where: { userId: botId } })).toBe(0);
  });

  test("aceeași cheie de deduplicare → un singur topic; un link de sursă nesigur nu se salvează", async () => {
    const input = { forumId, title: "Știre", content: { text: "Text" }, dedupeKey: "feed:1", meta: { sourceUrl: "javascript:alert(1)" } };
    const first = await bot.post("plugin:gcs.news_bot", input);
    const again = await bot.post("plugin:gcs.news_bot", input);
    expect(again).toEqual({ topicId: first!.topicId, postId: first!.postId, duplicate: true });
    expect(await w.db.topic.count({ where: { authorId: botId } })).toBe(1);
    expect((await w.db.botPost.findFirstOrThrow({ where: { dedupeKey: "feed:1" } })).sourceUrl).toBeNull();
  });

  test("funcția oprită → nimic publicat (`null`); ce exista rămâne; pornită din nou → publică", async () => {
    const admin = await w.actorFor(await w.createUser("Admin", "root_admin"));
    await bot.post("plugin:gcs.news_bot", { forumId, title: "Prima", content: { text: "a" } });
    await bot.toggle(admin, "plugin:gcs.news_bot", false);
    expect(await bot.post("plugin:gcs.news_bot", { forumId, title: "A doua", content: { text: "b" } })).toBeNull();
    expect(await w.db.topic.count({ where: { authorId: botId } })).toBe(1);
    await bot.toggle(admin, "plugin:gcs.news_bot", true);
    expect(await bot.post("plugin:gcs.news_bot", { forumId, title: "A treia", content: { text: "c" } })).toMatchObject({ duplicate: false });
  });

  test("traducerea automată: titlul și textul în limba site-ului, cu limba originalului; o eroare lasă originalul", async () => {
    provider = { translateHtml: async (html, target) => `[${target}] ${html}` } as GcsTranslateProvider;
    const res = await bot.post("plugin:gcs.news_bot", { forumId, title: "Update", content: { html: "<p>Fixed bugs</p>" }, translateFrom: "en" });
    const topic = await w.db.topic.findUniqueOrThrow({ where: { id: res!.topicId }, include: { posts: true } });
    expect(topic.title).toBe("[ro] Update");
    expect(topic.posts[0]!.contentHtml).toContain("[ro]");
    expect((await w.db.botPost.findFirstOrThrow({ where: { postId: res!.postId } })).translatedFrom).toBe("en");

    provider = { translateHtml: async () => Promise.reject(new Error("down")) } as unknown as GcsTranslateProvider;
    const plain = await bot.post("plugin:gcs.news_bot", { forumId, title: "Patch", content: { html: "<p>Original</p>" }, translateFrom: "en" });
    expect((await w.db.topic.findUniqueOrThrow({ where: { id: plain!.topicId } })).title).toBe("Patch");
    expect((await w.db.botPost.findFirstOrThrow({ where: { postId: plain!.postId } })).translatedFrom).toBeNull();
  });

  test("chat: mesajul pleacă marcat `bot`", async () => {
    await bot.chat("plugin:gcs.news_bot", { channelKey: "general", text: "Server repornit" });
    expect(chatSent).toEqual([{ key: "general", text: "Server repornit", bot: true }]);
  });
});

describe("bun venitul și postările programate", () => {
  test("bun venitul: oprit implicit; pornit → mesaj privat de la bot cu numele membrului și al site-ului, o singură dată", async () => {
    const user = await w.createUser("Ionut", "new_member");
    expect(await bot.welcome(user.id)).toBe(false);
    await bot.toggle(w.root, "welcome_pm", true);
    await w.settings.set(BOT_WELCOME_SETTING, "Salut, {name}! Bine ai venit pe {site}.", w.root);
    expect(await bot.welcome(user.id)).toBe(true);
    expect(await bot.welcome(user.id)).toBe(false);
    const conv = await w.db.conversation.findFirstOrThrow({ where: { participants: { some: { userId: user.id } } }, include: { messages: true } });
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0]!.authorId).toBe(botId);
    expect(conv.messages[0]!.contentHtml).toContain("Salut, Ionut! Bine ai venit pe");

    const other = await w.createUser("Ana", "new_member");
    await bot.toggle(w.root, "welcome_pm", false);
    expect(await bot.welcome(other.id)).toBe(false);
    expect(await bot.welcome(botId)).toBe(false);
  });

  test("o postare programată pleacă o singură dată, la data ei; anularea și data din trecut", async () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Turneul începe sâmbătă." }] }] };
    const { id } = await bot.schedule(w.root, { forumId, title: "Anunț turneu", content: doc, publishAt: new Date("2026-10-26T12:00:00Z"), pin: true });
    expect(await bot.publishScheduled()).toBe(0);
    now = new Date("2026-10-26T12:00:30Z");
    expect(await bot.publishScheduled()).toBe(1);
    expect(await bot.publishScheduled()).toBe(0);
    const row = await w.db.botScheduledPost.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("posted");
    expect(await w.db.topic.findUniqueOrThrow({ where: { id: row.topicId! } })).toMatchObject({ title: "Anunț turneu", authorId: botId, pinned: true });
    await expect(bot.unschedule(w.root, id)).rejects.toMatchObject({ status: 404 });

    await expect(bot.schedule(w.root, { forumId, title: "Trecut", content: doc, publishAt: new Date("2026-10-26T08:00:00Z") })).rejects.toMatchObject({ fields: { publishAt: "in_past" } });
    const later = await bot.schedule(w.root, { forumId, title: "Mai târziu", content: doc, publishAt: new Date("2026-10-27T08:00:00Z") });
    await bot.unschedule(w.root, later.id);
    expect(await w.db.botScheduledPost.count()).toBe(1);
  });

  test("editarea unei postări programate: titlul, conținutul, data și opțiunile; nu după publicare", async () => {
    const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const { id } = await bot.schedule(w.root, { forumId, title: "Prima variantă", content: doc("Vechi"), publishAt: new Date("2026-10-27T10:00:00Z"), pin: true });
    await bot.reschedule(w.root, id, { forumId, title: "  A doua variantă ", content: doc("Nou"), publishAt: new Date("2026-10-28T09:00:00Z"), lock: true });
    const view = (await bot.scheduled(w.root)).find((p) => p.id === id)!;
    expect(view).toMatchObject({ title: "A doua variantă", publishAt: "2026-10-28T09:00:00.000Z", lock: true, pin: false, status: "pending", content: doc("Nou") });
    await expect(bot.reschedule(w.root, id, { forumId, title: "Trecut", content: doc("x"), publishAt: new Date("2026-10-20T09:00:00Z") })).rejects.toMatchObject({ fields: { publishAt: "in_past" } });

    now = new Date("2026-10-28T09:00:30Z");
    expect(await bot.publishScheduled()).toBe(1);
    await expect(bot.reschedule(w.root, id, { forumId, title: "Prea târziu", content: doc("x"), publishAt: new Date("2026-11-01T09:00:00Z") })).rejects.toMatchObject({ status: 404 });
    expect(await w.db.auditLog.count({ where: { action: "bot.reschedule", targetId: String(id) } })).toBe(1);
  });

  test("ACP: numele botului se schimbă (unic); un membru fără drept ACP e refuzat", async () => {
    await bot.rename(w.root, "Știri GCS");
    expect((await bot.account())!.name).toBe("Știri GCS");
    await expect(bot.rename(w.root, "Mara")).rejects.toMatchObject({ params: { reason: "username_taken" } });
    await expect(bot.rename(w.member, "Altceva")).rejects.toMatchObject({ status: 403 });
  });
});
