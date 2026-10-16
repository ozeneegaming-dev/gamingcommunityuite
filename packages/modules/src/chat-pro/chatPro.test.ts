import { GcsAppService, GcsForbidden, GcsNotFound, GcsValidationError, type GcsActor } from "@gcs/core";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsChatService } from "../chat/chat";
import { GcsChatExtensions } from "../chat/extensions";
import { registerChatNotifications } from "../chat/notify";
import { GcsChatQueries } from "../chat/queries";
import { emoteCodeFrom, renderEmotes } from "./emotes";
import { cleanGif, searchGifs, trendingGifs } from "./gifs";
import { chatProMemberData } from "./memberData";
import { addDays, dayKey, rankingPeriod } from "./period";
import { chatProPrefsError, DEFAULT_CHAT_PRO_PREFS, hexToHsva, hsvaToHex, normalizeChatProPrefs } from "./prefs";
import { GcsChatProService } from "./service";

let w: GcsProfileWorld;
let chat: GcsChatService;
let queries: GcsChatQueries;
let apps: GcsAppService;
let pro: GcsChatProService;
let rolls: number[];

beforeEach(async () => {
  w = await createProfileWorld();
  const extensions = new GcsChatExtensions();
  chat = new GcsChatService({ db: w.db, bus: w.bus, permissions: w.permissions, settings: w.settings, rateLimiter: w.rateLimiter, realtime: w.realtime, acp: w.acp, attachments: w.attachments, extensions });
  queries = new GcsChatQueries({ db: w.db, permissions: w.permissions, extensions });
  apps = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, permissions: w.permissions, settings: w.settings });
  rolls = [];
  pro = new GcsChatProService({
    db: w.db,
    cache: w.cache,
    settings: w.settings,
    permissions: w.permissions,
    apps,
    acp: w.acp,
    chat,
    chatQueries: queries,
    attachments: w.attachments,
    realtime: w.realtime,
    rateLimiter: w.rateLimiter,
    notifications: w.notifications,
    reports: w.reports,
    grantBadge: (userId, key, reason) => w.achievements.grantSystemBadge(userId, key, reason),
    // Aleatorul testelor: valorile date, apoi 0.5.
    random: () => rolls.shift() ?? 0.5,
  });
  pro.register();
  registerChatNotifications({ db: w.db, bus: w.bus, notifications: w.notifications, chatQueries: queries, actors: w.actors });
  // Fără pauza de numărare (testele trimit mesaje rapid); flood-ul chat-ului e oprit pentru membri.
  await w.settings.set("chat_pro.count_cooldown", 0, w.root);
  await w.settings.set("chat.flood_seconds", 0, w.root);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

async function member(name: string, group = "member"): Promise<GcsActor> {
  return w.actorFor(await w.createUser(name, group));
}
const noFlood = (a: GcsActor) => w.redis.del(`gcs:rl:chat:${a.userId}`);
const enable = () => apps.setEnabled(w.root, "chat_pro", true);

describe("aplicația și punctele de extensie", () => {
  test("instalată oprită: chat-ul standard rămâne neschimbat (fără date Pro, comenzile sunt text, nimic numărat)", async () => {
    expect(await apps.enabled("chat_pro")).toBe(false);
    expect((await apps.catalog()).find((a) => a.key === "chat_pro")).toMatchObject({ enabled: false, requires: ["chat"], premium: true });
    const a = await member("Ana");
    const m = await chat.send(a, "general", "/roll 6");
    expect(m.body).toBe("/roll 6");
    expect(m.pro).toBeUndefined();
    expect((await queries.recent(a, "general")).every((v) => v.pro === undefined)).toBe(true);
    expect(await w.db.chatProDailyStat.count()).toBe(0);
    expect((await w.db.chatMessage.findUniqueOrThrow({ where: { id: m.id } })).meta).toBeNull();
  });

  test("pornită: „Primul mesaj” o singură dată, comenzile își scriu rezultatul, doar mesajele normale se numără", async () => {
    await enable();
    const a = await member("Ana");
    const first = await chat.send(a, "general", "salut");
    expect(first.pro).toMatchObject({ first: true, nickname: null, winner: false, badges: [], replyTo: null, bot: null });
    await noFlood(a);
    rolls.push(0.999);
    const roll = await chat.send(a, "general", "/roll 6");
    expect(roll.body).toBe("🎲 6 (1-6)");
    expect(roll.pro).toMatchObject({ first: false, bot: { command: "roll", max: 6, result: 6 } });
    await noFlood(a);
    rolls.push(0);
    expect((await chat.send(a, "general", "/IQ")).pro?.bot).toEqual({ command: "iq", value: 50 });
    // Un text care doar începe cu „/” dar nu e o comandă rămâne text.
    await noFlood(a);
    expect((await chat.send(a, "general", "/nuexista ceva")).pro?.bot).toBeNull();
    const stats = await w.db.chatProDailyStat.findMany({ where: { userId: a.userId! } });
    expect(stats.map((s) => s.messages)).toEqual([2]);
    // Argumente greșite → eroare pe câmp, mesajul nu se salvează.
    await noFlood(a);
    await expect(chat.send(a, "general", "/roll 1")).rejects.toMatchObject({ fields: { body: "command_args" } });
  });

  test("comenzile oprite din ACP nu rulează; pauza de numărare ignoră mesajele prea dese", async () => {
    await enable();
    await w.settings.set("chat_pro.commands", ["roll"], w.root);
    await w.settings.set("chat_pro.count_cooldown", 60, w.root);
    const a = await member("Ana");
    await expect(chat.send(a, "general", "/iq")).rejects.toMatchObject({ fields: { body: "command_disabled" } });
    await noFlood(a);
    await chat.send(a, "general", "unu");
    await noFlood(a);
    await chat.send(a, "general", "doi");
    expect((await w.db.chatProDailyStat.findFirstOrThrow({ where: { userId: a.userId! } })).messages).toBe(1);
  });

  test("piatră-hârtie-foarfecă: alegerea provocatorului e secretă până răspunde adversarul; doar adversarul răspunde", async () => {
    await enable();
    const a = await member("Ana");
    const b = await member("Bogdan");
    const c = await member("Cezar");
    const challenge = await chat.send(a, "general", "/rps @Bogdan piatră");
    expect(challenge.body).toBe("✊✋✌️ @Bogdan");
    expect(challenge.pro?.bot).toMatchObject({ command: "rps", state: "open", opponent: { name: "Bogdan" } });
    expect(JSON.stringify(challenge)).not.toContain("rock");
    await expect(pro.answerRps(c, challenge.id, "hârtie")).rejects.toBeInstanceOf(GcsForbidden);
    await expect(pro.answerRps(b, challenge.id, "lopată")).rejects.toBeInstanceOf(GcsValidationError);
    const done = await pro.answerRps(b, challenge.id, "hartie");
    expect(done.pro?.bot).toMatchObject({ state: "done", result: { challenger: "rock", opponent: "paper", winner: "opponent" } });
    expect(done.body).toBe("✊✋✌️ @Bogdan: ✊ vs ✋");
    await expect(pro.answerRps(b, challenge.id, "piatra")).rejects.toMatchObject({ fields: { choice: "closed" } });
    await noFlood(a);
    await expect(chat.send(a, "general", "/rps @Ana")).rejects.toMatchObject({ fields: { body: "command_self" } });
    await noFlood(a);
    await expect(chat.send(a, "general", "/rps @NimeniNimic")).rejects.toMatchObject({ fields: { body: "command_user" } });
    // O provocare fără răspuns în 10 minute apare expirată.
    await noFlood(a);
    const old = await chat.send(a, "general", "/rps @Cezar");
    const meta = (await w.db.chatMessage.findUniqueOrThrow({ where: { id: old.id } })).meta as { bot: Record<string, unknown> };
    await w.db.chatMessage.update({ where: { id: old.id }, data: { meta: { ...meta, bot: { ...meta.bot, expiresAt: new Date(Date.now() - 1000).toISOString() } } } });
    expect((await queries.recent(a, "general")).find((m) => m.id === old.id)?.pro?.bot).toMatchObject({ state: "expired" });
  });

  test("/zi-de-nastere: doar membrii care își arată ziua de naștere și o au azi", async () => {
    await enable();
    const a = await member("Ana");
    const today = dayKey(new Date(), "Europe/Bucharest");
    const birth = new Date(`1999-${today.slice(5)}T00:00:00Z`);
    const visible = await w.createUser("Sărbătorit", "member");
    const hidden = await w.createUser("Discret", "member");
    await w.db.user.update({ where: { id: visible.id }, data: { birthday: birth, birthdayVisible: true } });
    await w.db.user.update({ where: { id: hidden.id }, data: { birthday: birth, birthdayVisible: false } });
    const m = await chat.send(a, "general", "/zi-de-nastere");
    expect(m.body).toBe("🎂 Sărbătorit");
    expect(m.pro?.bot).toMatchObject({ command: "birthday", users: [{ id: visible.id, name: "Sărbătorit" }] });
  });
});

describe("profilul de chat", () => {
  test("preferințele: valorile implicite, validarea, salvarea parțială, culorile cu opacitate", async () => {
    await enable();
    const a = await member("Ana");
    expect((await pro.me(a.userId!)).prefs).toEqual(DEFAULT_CHAT_PRO_PREFS);
    expect(chatProPrefsError({ layout: "grid" })).toBe("layout");
    expect(chatProPrefsError({ colors: { messageBg: "#123456" } })).toBe("colors");
    expect(chatProPrefsError({ necunoscut: true })).toBe("necunoscut");
    await expect(pro.updatePrefs(a, { height: 5000 })).rejects.toMatchObject({ fields: { height: "invalid_value" } });
    const p = await pro.updatePrefs(a, { layout: "bubbles", sound: false, colors: { messageBg: "#11223380" }, commandResults: { iq: false } });
    expect(p).toMatchObject({ layout: "bubbles", sound: false, colors: { messageBg: "#11223380" }, commandResults: { roll: true, iq: false } });
    const reset = await pro.updatePrefs(a, { colors: { messageBg: null } });
    expect(reset.colors).toEqual({});
    expect(normalizeChatProPrefs({ voiceVolume: 300, layout: "x" })).toMatchObject({ voiceVolume: 100, layout: "cards" });
    // Oprit pentru un vizitator / aplicația oprită.
    await expect(pro.updatePrefs(w.guest, { sound: false })).rejects.toBeInstanceOf(GcsForbidden);
    await apps.setEnabled(w.root, "chat_pro", false);
    await expect(pro.updatePrefs(a, { sound: false })).rejects.toBeInstanceOf(GcsNotFound);
  });

  test("culorile: HEX ↔ HSV cu opacitate", () => {
    expect(hsvaToHex({ h: 0, s: 1, v: 1, a: 1 })).toBe("#FF0000FF");
    expect(hsvaToHex(hexToHsva("#33AA77")!)).toBe("#33AA77FF");
    expect(hexToHsva("#00000080")).toMatchObject({ a: 128 / 255 });
    expect(hexToHsva("rosu")).toBeNull();
  });

  test("porecla: unică, nu poate fi numele altui membru; gol = numele de pe forum", async () => {
    await enable();
    const a = await member("Ana");
    const b = await member("Bogdan");
    expect(await pro.setNickname(a, "  Ana  Pro ")).toBe("Ana Pro");
    await expect(pro.setNickname(b, "ana pro")).rejects.toMatchObject({ fields: { nickname: "taken" } });
    await expect(pro.setNickname(b, "Ana")).rejects.toMatchObject({ fields: { nickname: "taken" } });
    await expect(pro.setNickname(b, "<script>")).rejects.toMatchObject({ fields: { nickname: "invalid_nickname" } });
    expect(await pro.setNickname(b, "Bogdan")).toBe("Bogdan");
    const m = await chat.send(a, "general", "cu poreclă");
    expect(m.pro?.nickname).toBe("Ana Pro");
    expect(await pro.displayName(a.userId!)).toBe("Ana Pro");
    expect(await pro.setNickname(a, "")).toBeNull();
    expect(await pro.displayName(a.userId!)).toBe("Ana");
  });

  test("insignele alese: cel mult 2, doar obținute; apar lângă nume; răspunsul citat și notificarea autorului", async () => {
    await enable();
    const a = await member("Ana");
    const b = await member("Bogdan");
    const badges = await w.db.badge.findMany({ orderBy: { id: "asc" }, take: 3 });
    await w.db.userBadge.createMany({ data: badges.slice(0, 2).map((x) => ({ userId: a.userId!, badgeId: x.id })) });
    await expect(pro.setBadges(a, badges.map((x) => x.id))).rejects.toMatchObject({ fields: { badges: "too_many" } });
    await expect(pro.setBadges(a, [badges[2]!.id])).rejects.toMatchObject({ fields: { badges: "not_owned" } });
    await pro.setBadges(a, [badges[1]!.id]);
    expect((await pro.earnedBadges(a.userId!)).map((x) => x.key)).toEqual([badges[0]!.key, badges[1]!.key]);
    const original = await chat.send(a, "general", "întrebare: cine joacă diseară?");
    expect(original.pro?.badges).toEqual([expect.objectContaining({ kind: "badge", key: badges[1]!.key, art: expect.stringContaining("/badge-art/") })]);
    const reply = await chat.send(b, "general", "eu!", { replyTo: original.id });
    expect(reply.replyToId).toBe(original.id);
    expect(reply.pro?.replyTo).toEqual({ id: original.id, author: "Ana", snippet: "întrebare: cine joacă diseară?" });
    expect(await w.db.notification.count({ where: { userId: a.userId!, type: "chat_pro.reply" } })).toBe(1);
    expect((await pro.notifications(a, "all")).map((n) => n.type)).toContain("chat_pro.reply");
    expect((await pro.notifications(a, "mentions")).map((n) => n.type)).not.toContain("chat_pro.reply");
    // Un mesaj citat din altă cameră sau inexistent: eroare.
    await noFlood(b);
    await expect(chat.send(b, "general", "x", { replyTo: 999_999 })).rejects.toMatchObject({ fields: { replyTo: "invalid" } });
  });
});

describe("emoticoanele", () => {
  const png = (side: number) => sharp({ create: { width: side, height: side, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } } }).png().toBuffer();

  test("încărcarea în masă: coduri din numele fișierelor (unice), fișierele greșite sau prea mari respinse", async () => {
    await enable();
    const { id: packId } = await pro.emotes.savePack(w.root, null, { name: "Gaming", enabled: true });
    const res = await pro.emotes.upload(w.root, packId, [
      { name: "GG Wp.png", bytes: await png(64) },
      { name: "gg_wp.png", bytes: await png(32) },
      { name: "uriaș.png", bytes: await png(400) },
      { name: "text.png", bytes: Buffer.from("nu e imagine") },
    ]);
    expect(res.added.map((e) => e.code)).toEqual(["gg_wp", "gg_wp_2"]);
    expect(res.rejected).toEqual([
      { name: "uriaș.png", reason: "too_big_dimensions" },
      { name: "text.png", reason: "unsupported_type" },
    ]);
    // Fișierul respins nu rămâne în baza de date.
    expect(await w.db.attachment.count({ where: { contentType: null, ownerId: w.root.userId! } })).toBe(0);
    expect((await pro.emotes.packs())[0]!.emotes).toHaveLength(2);
    await expect(pro.emotes.rename(w.root, res.added[1]!.id, "gg_wp")).rejects.toMatchObject({ fields: { code: "taken" } });
    await pro.emotes.rename(w.root, res.added[1]!.id, ":ez:");
    await expect(pro.emotes.upload(w.member, packId, [{ name: "x.png", bytes: await png(32) }])).rejects.toBeInstanceOf(GcsForbidden);

    // În mesaje: `:cod:` devine imaginea, dar nu în linkuri; favoritele.
    const a = await member("Ana");
    const m = await chat.send(a, "general", "gg :gg_wp: și :ez: https://ex.com/:ez:/a");
    expect(m.html).toContain('<img class="gcs-emote" src="/files/');
    expect(m.html).toContain('alt=":ez:"');
    expect(m.html).toContain('href="https://ex.com/:ez:/a"');
    expect(await pro.toggleEmoteFavorite(a, "ez")).toEqual(["ez"]);
    expect(await pro.toggleEmoteFavorite(a, "ez")).toEqual([]);
    await expect(pro.toggleEmoteFavorite(a, "nuexista")).rejects.toBeInstanceOf(GcsValidationError);
    await pro.emotes.deletePack(w.root, packId);
    expect(await pro.emotes.packs()).toEqual([]);
  });

  test("codul din numele fișierului și înlocuirea în HTML", () => {
    expect(emoteCodeFrom("Pepe Râde!.GIF")).toBe("pepe_rade");
    expect(emoteCodeFrom("x.png")).toBe("emote_x");
    const map = new Map([["kek", { id: 1, code: "kek", url: "/files/k", width: 32, height: 32, animated: false }]]);
    expect(renderEmotes("a :kek: <a href=\"https://x/:kek:\">:kek:</a> :nu:", map)).toBe(
      'a <img class="gcs-emote" src="/files/k" alt=":kek:" title=":kek:" width="32" height="32" loading="lazy" decoding="async"> <a href="https://x/:kek:">:kek:</a> :nu:',
    );
  });
});

describe("clasamentul", () => {
  test("podiumul perioadei, spammer-ul zilei, statisticile mele; câștigătorul perioadei trecute primește badge-ul", async () => {
    await enable();
    const [a, b, c] = [await member("Ana"), await member("Bogdan"), await member("Cezar")];
    const banned = await member("Banat", "banned");
    const now = new Date();
    const today = dayKey(now, "Europe/Bucharest");
    const period = rankingPeriod(today, "month", 1);
    const prevDay = addDays(period.start, -3);
    await w.db.chatProDailyStat.createMany({
      data: [
        { userId: a.userId!, day: today, messages: 2 },
        { userId: b.userId!, day: today, messages: 7 },
        { userId: c.userId!, day: period.start, messages: 4 },
        { userId: banned.userId!, day: today, messages: 99 },
        { userId: c.userId!, day: prevDay, messages: 30 },
        { userId: a.userId!, day: prevDay, messages: 10 },
      ],
    });
    const r = await pro.ranking.view(a.userId, now);
    // Membrul banat nu apare, deși are cele mai multe mesaje.
    expect(r.top.map((x) => [x.user.name, x.messages])).toEqual([
      ["Bogdan", 7],
      ["Cezar", 4],
      ["Ana", 2],
    ]);
    expect(r.spammer?.user.name).toBe("Bogdan");
    // „Față de perioada trecută”: mesajele perioadei anterioare (Ana: 10).
    expect(r.me).toMatchObject({ position: 3, today: 2, period: 2, previous: 10 });
    expect(r.resetsIn).toBeGreaterThan(0);
    // Ultimul câștigător, cu insigna primită (badge-ul câștigătorului, ca medalion).
    expect(r.lastWinner).toMatchObject({ user: { name: "Cezar" }, messages: 30, badge: { key: "chat_pro_winner" } });
    expect(r.lastWinner?.badge?.art).toMatch(/^data:image\/svg\+xml|^\//);
    const badge = await w.db.badge.findUniqueOrThrow({ where: { key: "chat_pro_winner" } });
    expect(await w.db.userBadge.count({ where: { userId: c.userId!, badgeId: badge.id } })).toBe(1);
    // Idempotent: a doua citire nu mai creează nimic.
    await pro.ranking.view(null, now);
    expect(await w.db.chatProWinner.count()).toBe(1);
    // Câștigătorul are insigna lângă nume.
    expect((await chat.send(c, "general", "gg")).pro?.winner).toBe(true);
  });
});

describe("bara de anunțuri și istoricul", () => {
  test("bara: elementele pornite, în program, pentru grupurile viewer-ului; validarea; dreptul ACP", async () => {
    await enable();
    const base = { ctaLabel: "", ctaUrl: "", startsAt: null, endsAt: null, groupIds: [] as number[], enabled: true };
    await pro.bar.save(w.root, null, { ...base, text: "Votează serverele", ctaLabel: "Votează", ctaUrl: "https://vot.example/gcs" });
    await pro.bar.save(w.root, null, { ...base, text: "Doar VIP", groupIds: [w.groups.vip_gold!] });
    await pro.bar.save(w.root, null, { ...base, text: "Viitor", startsAt: new Date(Date.now() + 3600_000).toISOString() });
    await pro.bar.save(w.root, null, { ...base, text: "Oprit", enabled: false });
    expect((await pro.bar.visible([w.groups.member!])).map((i) => i.text)).toEqual(["Votează serverele"]);
    expect((await pro.bar.visible([w.groups.vip_gold!])).map((i) => i.text)).toEqual(["Votează serverele", "Doar VIP"]);
    await expect(pro.bar.save(w.root, null, { ...base, text: "x", ctaLabel: "Click", ctaUrl: "javascript:alert(1)" })).rejects.toMatchObject({ fields: { ctaUrl: "invalid_url" } });
    await expect(pro.bar.save(w.root, null, { ...base, text: "x", endsAt: "2020-01-01", startsAt: "2021-01-01" })).rejects.toMatchObject({ fields: { endsAt: "before_start" } });
    await expect(pro.bar.save(w.member, null, { ...base, text: "x" })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("istoricul: totalurile, căutarea după text / membru / zi, doar camerele citibile, permisiunea", async () => {
    await enable();
    const a = await member("Ana");
    const b = await member("Bogdan");
    await pro.setNickname(b, "Bobo");
    await chat.send(a, "general", "salut tuturor");
    await chat.send(b, "general", "Salut, Ana!");
    await noFlood(b);
    const edited = await chat.send(b, "general", "gresit");
    await chat.edit(b, edited.id, "corect");
    const page = await pro.history.page(a, {});
    expect(page.totals).toEqual({ messages: 3, users: 2, edited: 1 });
    expect(page.rows.map((r) => r.body)).toEqual(["corect", "Salut, Ana!", "salut tuturor"]);
    expect((await pro.history.page(a, { q: "SALUT" })).total).toBe(2);
    expect((await pro.history.page(a, { member: "bobo" })).rows.map((r) => r.author?.name)).toEqual(["Bogdan", "Bogdan"]);
    expect((await pro.history.page(a, { from: "2000-01-01", to: "2000-01-02" })).total).toBe(0);
    await expect(pro.history.page(w.guest, {})).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("istoricul: ascunsele doar pentru staff, la cerere; GIF-urile ca miniaturi (fără adresă); grupul autorului; exportul CSV cu permisiune", async () => {
    await enable();
    const a = await member("Ana");
    const hidden = await chat.send(a, "general", "reclamă");
    await noFlood(a);
    await chat.send(a, "general", "uite https://media.giphy.com/media/abc123/giphy.gif haha");
    await w.db.chatMessage.update({ where: { id: hidden.id }, data: { hiddenAt: new Date(), hiddenById: w.moderator.userId } });
    const mine = await pro.history.page(a, { hidden: true });
    expect(mine.rows.map((r) => r.body)).not.toContain("reclamă");
    expect(mine.can).toMatchObject({ hidden: false, export: false });
    const gif = mine.rows[0]!;
    expect(gif.embeds).toEqual([{ kind: "image", url: "https://media.giphy.com/media/abc123/giphy.gif" }]);
    expect(gif.html).toBe("uite haha");
    expect(gif.group).toMatchObject({ name: expect.any(String) });
    const staff = await pro.history.page(w.moderator, { hidden: true });
    expect(staff.can).toMatchObject({ hidden: true, export: true });
    expect(staff.rows.find((r) => r.body === "reclamă")?.hidden).toMatchObject({ by: { name: "NeoX" } });
    expect((await pro.history.page(w.moderator, {})).rows.map((r) => r.body)).not.toContain("reclamă");
    const csv = await pro.history.exportCsv(w.moderator, { hidden: true });
    expect(csv.split("\r\n")[0]).toBe("id,room,member,message,created_at,edited_at,hidden");
    expect(csv).toContain("reclamă");
    await expect(pro.history.exportCsv(a, {})).rejects.toBeInstanceOf(GcsForbidden);
  });
});

describe("GIF-urile și datele membrilor", () => {
  const fakeFetch = (body: unknown, seen: string[]) =>
    (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

  test("GIPHY și Tenor: căutare, trending, URL-uri doar de la furnizor; favoritele curățate", async () => {
    const seen: string[] = [];
    const giphy = await searchGifs("giphy", "k", "gg", { fetch: fakeFetch({ data: [{ id: "abc123", title: "gg", images: { fixed_height: { width: "300", height: "200" } } }, { id: "../x" }] }, seen) });
    expect(giphy).toEqual([{ id: "abc123", title: "gg", url: "https://media.giphy.com/media/abc123/200.gif", preview: "https://media.giphy.com/media/abc123/200w.gif", width: 300, height: 200 }]);
    const tenorBody = {
      results: [
        { id: "123", content_description: "wave", media_formats: { gif: { url: "https://media.tenor.com/AbCdEf12/wave.gif", dims: [220, 180] }, tinygif: { url: "https://media.tenor.com/AbCdEf34/wave.gif" } } },
        { id: "456", media_formats: { gif: { url: "https://evil.example/x.gif" } } },
      ],
    };
    const tenor = await trendingGifs("tenor", "k", { fetch: fakeFetch(tenorBody, seen) });
    expect(tenor).toEqual([{ id: "123", title: "wave", url: "https://media.tenor.com/AbCdEf12/wave.gif", preview: "https://media.tenor.com/AbCdEf34/wave.gif", width: 220, height: 180 }]);
    expect(seen[0]).toContain("api.giphy.com/v1/gifs/search");
    expect(seen[1]).toContain("tenor.googleapis.com/v2/featured");
    expect(cleanGif({ ...tenor[0], url: "https://evil.example/a.gif" })).toBeNull();
    expect(cleanGif(giphy[0])).toEqual(giphy[0]);
    // Fără cheie: fără GIF-uri (fără buton).
    await enable();
    expect(await pro.gifs(await member("Ana"), null)).toBeNull();
    expect((await pro.config()).gif).toBeNull();
  });

  test("unirea conturilor: statisticile se adună pe zile, profilul sursei trece la țintă", async () => {
    await enable();
    const a = await member("Ana");
    const b = await member("Bogdan");
    await pro.setNickname(a, "Anuța");
    await w.db.chatProDailyStat.createMany({
      data: [
        { userId: a.userId!, day: "2026-10-01", messages: 3 },
        { userId: b.userId!, day: "2026-10-01", messages: 2 },
        { userId: a.userId!, day: "2026-10-02", messages: 1 },
      ],
    });
    const handler = chatProMemberData({ db: w.db });
    expect(await handler.summary(a.userId!)).toEqual([
      { key: "chat_pro.days", count: 2 },
      { key: "chat_pro.wins", count: 0 },
    ]);
    await handler.merge({ sourceId: a.userId!, targetId: b.userId!, batchSize: 100 } as Parameters<typeof handler.merge>[0]);
    expect((await w.db.chatProDailyStat.findMany({ where: { userId: b.userId! }, orderBy: { day: "asc" } })).map((s) => s.messages)).toEqual([5, 1]);
    expect((await pro.me(b.userId!)).nickname).toBe("Anuța");
    expect(await w.db.chatProProfile.count({ where: { userId: a.userId! } })).toBe(0);
  });
});
