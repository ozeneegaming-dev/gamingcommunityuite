import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError, type GcsActor } from "@gcs/core";
import { recordRealtime } from "@gcs/core/test/realtime";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsChatService } from "./chat";
import { searchGiphy } from "./giphy";
import { GcsChatQueries } from "./queries";
import { applyWordFilter, chatEmbeds, cleanChatText, countEmoji, renderChatText } from "./text";

let w: GcsProfileWorld;
let chat: GcsChatService;
let queries: GcsChatQueries;
let staff: GcsActor;

beforeEach(async () => {
  w = await createProfileWorld();
  chat = new GcsChatService({
    db: w.db,
    bus: w.bus,
    permissions: w.permissions,
    settings: w.settings,
    rateLimiter: w.rateLimiter,
    realtime: w.realtime,
    acp: w.acp,
    attachments: w.attachments,
  });
  queries = new GcsChatQueries({ db: w.db, permissions: w.permissions });
  staff = w.moderator;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function member(name: string, group = "member"): Promise<GcsActor> {
  return w.actorFor(await w.createUser(name, group));
}

const clear = (a: GcsActor) => w.kv.del(`gcs:rl:chat:${a.userId}`);

describe("textul", () => {
  test("<script> e escapat, javascript: nu devine link, http(s) da", () => {
    expect(renderChatText(`<script>alert(1)</script>`)).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(renderChatText("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(renderChatText(`vezi https://ex.com/a?b=1&c="x" acum.`)).toBe(
      'vezi <a href="https://ex.com/a?b=1&amp;c=" rel="nofollow ugc noopener" target="_blank">https://ex.com/a?b=1&amp;c=</a>&quot;x&quot; acum.',
    );
    expect(renderChatText("link: https://ex.com.")).toBe('link: <a href="https://ex.com" rel="nofollow ugc noopener" target="_blank">https://ex.com</a>.');
  });

  test("mențiunile hotărâte de server devin pastile (membru, grup); un `@nume` dintr-o adresă rămâne în adresă", () => {
    const ana = { kind: "user" as const, id: "u1", name: "Ana" };
    const mods = { kind: "group" as const, id: "7", name: "Moderatori" };
    expect(renderChatText("hei @ana și @Moderatori <3", [ana, mods])).toBe(
      'hei <a class="gcs-userLink gcs-mention" href="/members/u1" data-user="u1" data-user-id="u1">@ana</a> și <a class="gcs-groupMention" href="/members?group=7" data-group-id="7">@Moderatori</a> &lt;3',
    );
    expect(renderChatText("https://x.ro/@Ana", [ana])).toBe('<a href="https://x.ro/@Ana" rel="nofollow ugc noopener" target="_blank">https://x.ro/@Ana</a>');
  });

  test("filtrul înlocuiește cuvintele întregi, fără să conteze literele mari sau diacriticele", () => {
    expect(applyWordFilter("Prost și prost, dar nu prostie", ["prost"])).toBe("*** și ***, dar nu prostie");
    expect(applyWordFilter("Ești un PROȘTI", ["prosti"])).toBe("Ești un ***");
    expect(applyWordFilter("nimic", [])).toBe("nimic");
  });

  test("curățarea: un singur rând, fără caractere de control, plafonul tehnic 2000", () => {
    expect(cleanChatText("  a\nb\u0000c‮ ")).toBe("a bc");
    expect(cleanChatText("x".repeat(2500))).toHaveLength(2000);
  });

  test("embed-urile: imagini https după extensie, GIF-uri GIPHY, YouTube (watch, youtu.be, shorts); max 3, fără dubluri", () => {
    expect(chatEmbeds("uite https://ex.com/a.PNG și http://ex.com/b.png")).toEqual([{ kind: "image", url: "https://ex.com/a.PNG" }]);
    expect(chatEmbeds("https://media.giphy.com/media/abc123/200.gif")).toEqual([{ kind: "image", url: "https://media.giphy.com/media/abc123/200.gif" }]);
    expect(chatEmbeds("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1 https://youtu.be/dQw4w9WgXcQ")).toEqual([{ kind: "youtube", id: "dQw4w9WgXcQ" }]);
    expect(chatEmbeds("https://youtube.com/shorts/abcdefghijk?x=1")).toEqual([{ kind: "youtube", id: "abcdefghijk" }]);
    expect(chatEmbeds("https://ex.com/pagina https://youtube.com/watch?v=scurt")).toEqual([]);
    expect(chatEmbeds("https://a.com/1.jpg https://a.com/2.jpg https://a.com/3.jpg https://a.com/4.jpg")).toHaveLength(3);
    // Ghilimelele opresc linkul: nimic nu iese din atribut.
    expect(chatEmbeds('https://ex.com/x.png"onerror="alert(1)')).toEqual([{ kind: "image", url: "https://ex.com/x.png" }]);
  });

  test("emoticoanele: o secvență compusă contează o dată", () => {
    expect(countEmoji("salut 😀😀 👍🏽 👨‍👩‍👧 :)")).toBe(4);
    expect(countEmoji("fără")).toBe(0);
  });

  test("GIPHY: cheia și căutarea pleacă la API; rezultatele au URL-uri reconstruite din id", async () => {
    let called = "";
    const fake = (async (url: string) => {
      called = url;
      return new Response(
        JSON.stringify({ data: [{ id: "abc123", title: "Cat", images: { fixed_height: { width: "356", height: "200" } } }, { id: "../rău", title: "x" }] }),
      );
    }) as unknown as typeof fetch;
    const gifs = await searchGiphy("CHEIE", " pisici ", { fetch: fake });
    expect(called).toContain("api_key=CHEIE");
    expect(called).toContain("q=pisici");
    expect(called).toContain("rating=pg-13");
    expect(gifs).toEqual([
      { id: "abc123", title: "Cat", url: "https://media.giphy.com/media/abc123/200.gif", preview: "https://media.giphy.com/media/abc123/200w.gif", width: 356, height: 200 },
    ]);
    await expect(searchGiphy("CHEIE", "  ", { fetch: fake })).rejects.toBeInstanceOf(GcsValidationError);
  });
});

describe("GcsChatService / GcsChatQueries", () => {
  test("seed: canalul General; un vizitator nu-l citește, un membru citește și scrie", async () => {
    const a = await member("Ana");
    expect(await queries.channels(w.guest)).toEqual([]);
    expect(await queries.channels(a)).toMatchObject([{ key: "general", name: "General", showOnHome: true, canWrite: true }]);
    await expect(queries.recent(w.guest, "general")).rejects.toBeInstanceOf(GcsForbidden);
    await expect(chat.send(w.guest, "general", "salut")).rejects.toBeInstanceOf(GcsForbidden);

    const sent = await chat.send(a, "general", "salut https://ex.com");
    expect(sent).toMatchObject({ channel: "general", author: { name: "Ana" }, body: "salut https://ex.com" });
    expect(sent.html).toContain("<a href=");
    expect((await queries.recent(a, "general")).map((m) => m.body)).toEqual(["salut https://ex.com"]);
    expect(await queries.canRead(a, "general")).toBe(true);
    expect(await queries.canRead(w.guest, "general")).toBe(false);
  });

  test("flood: al doilea mesaj imediat e refuzat; un mesaj gol e invalid", async () => {
    const a = await member("Ana");
    await chat.send(a, "general", "unu");
    await expect(chat.send(a, "general", "doi")).rejects.toBeInstanceOf(GcsRateLimited);
    await clear(a);
    await expect(chat.send(a, "general", "   ")).rejects.toThrow();
  });

  test("flood control din ACP: câștigă valoarea mai strictă (setarea sau grupul); moderatorii trec peste", async () => {
    const vip = await member("Vip", "vip_gold"); // grupul: 1 s
    const a = await member("Ana"); // grupul: 3 s
    const refused = async (who: GcsActor) => {
      const error = await chat.send(who, "general", "prea repede").then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(GcsRateLimited);
      return Number((error as GcsRateLimited).params?.retryAfter);
    };

    // Setarea (30 s) e mai strictă decât grupul VIP (1 s).
    await w.settings.set("chat.flood_seconds", 30, w.root);
    await chat.send(vip, "general", "unu");
    expect(await refused(vip)).toBeGreaterThan(5);
    // Moderatorii nu au flood control.
    await chat.send(staff, "general", "mod 1");
    await chat.send(staff, "general", "mod 2");

    // Setarea (1 s) e mai permisivă decât grupul membrilor (3 s): rămâne pauza grupului.
    await w.settings.set("chat.flood_seconds", 1, w.root);
    await chat.send(a, "general", "unu");
    expect(await refused(a)).toBeGreaterThan(1);

    // 0 = niciunul: doar grupul.
    await w.settings.set("chat.flood_seconds", 0, w.root);
    await clear(vip);
    await chat.send(vip, "general", "din nou");
    expect(await refused(vip)).toBeLessThanOrEqual(1);
  });

  test("slow mode 10 s → al doilea mesaj în 5 s e refuzat; staff-ul nu", async () => {
    const a = await member("Ana");
    await chat.setSlowMode(staff, "general", 10);
    await chat.send(a, "general", "unu");
    await clear(a);
    await expect(chat.send(a, "general", "doi")).rejects.toMatchObject({ params: { reason: "slow_mode" } });
    await chat.send(staff, "general", "staff 1");
    await chat.send(staff, "general", "staff 2");
    await expect(chat.setSlowMode(a, "general", 0)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("mute pe canal → refuzat doar acolo; global → peste tot; expirat → permis", async () => {
    const root = w.root;
    const a = await member("Ana");
    await chat.createChannel(root, { key: "offtopic", name: "Offtopic" });

    const local = await chat.mute(staff, a.userId!, { channelKey: "general", minutes: 60, reason: "spam" });
    await expect(chat.send(a, "general", "x")).rejects.toMatchObject({ params: { reason: "muted" } });
    await chat.send(a, "offtopic", "aici pot");
    await clear(a);

    await chat.unmute(staff, local.id);
    const global = await chat.mute(staff, a.userId!, { channelKey: null, minutes: null, reason: "" });
    await expect(chat.send(a, "offtopic", "x")).rejects.toMatchObject({ params: { reason: "muted" } });
    expect((await queries.activeMutes()).map((m) => [m.user.name, m.channel, m.until])).toEqual([["Ana", null, null]]);

    await w.db.chatMute.update({ where: { id: global.id }, data: { until: new Date(Date.now() - 1000) } });
    await chat.send(a, "general", "liber");
    expect(await w.db.auditLog.count({ where: { action: { in: ["chat.mute", "chat.unmute"] } } })).toBe(3);
  });

  test("un moderator nu dă mute staff-ului; un membru nu dă mute", async () => {
    const a = await member("Ana");
    await expect(chat.mute(staff, w.root.userId!, { channelKey: null, minutes: 5, reason: "" })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(chat.mute(a, staff.userId!, { channelKey: null, minutes: 5, reason: "" })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("filtrul din setări se aplică la trimitere", async () => {
    const a = await member("Ana");
    await w.settings.set("chat.word_filter", ["prost"], w.root);
    expect((await chat.send(a, "general", "Ești Prost")).body).toBe("Ești ***");
  });

  test("ștergerea (moderator) ascunde mesajul din recent; alt membru nu poate șterge", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const m = await chat.send(a, "general", "de șters");
    await expect(chat.delete(b, m.id)).rejects.toBeInstanceOf(GcsForbidden);
    await chat.delete(staff, m.id);
    expect(await queries.recent(a, "general")).toEqual([]);
    expect(await w.db.auditLog.count({ where: { action: "chat.message.delete" } })).toBe(1);
  });

  test("autorul își șterge propriul mesaj", async () => {
    const a = await member("Ana");
    const m = await chat.send(a, "general", "greșeală");
    await chat.delete(a, m.id);
    expect(await queries.recent(a, "general")).toEqual([]);
  });

  test("limitele din setări: caractere și emoticoane (0 = nelimitat)", async () => {
    const a = await member("Ana");
    await w.settings.set("chat.max_length", 10, w.root);
    await expect(chat.send(a, "general", "x".repeat(11))).rejects.toBeInstanceOf(GcsValidationError);
    await w.settings.set("chat.max_emoticons", 2, w.root);
    await clear(a);
    await expect(chat.send(a, "general", "😀😀😀")).rejects.toMatchObject({ fields: { body: "too_many_emoticons" } });
    await clear(a);
    expect((await chat.send(a, "general", "😀😀 ok")).body).toBe("😀😀 ok");
    await w.settings.set("chat.max_length", 0, w.root);
    await w.settings.set("chat.max_emoticons", 0, w.root);
    await clear(a);
    expect((await chat.send(a, "general", `${"😀".repeat(20)}${"y".repeat(600)}`)).body).toHaveLength(640);
  });

  test("fișierele: imaginea încărcată se leagă de mesaj; doar ale autorului; cu imaginile oprite e refuzată", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer();
    const upload = (who: GcsActor) => w.attachments.upload(who, { name: "a.png", bytes: png }, { container: { type: "chat", id: "general" }, permission: "chat.write" });
    const mine = await upload(a);
    const theirs = await upload(b);
    await expect(chat.send(a, "general", "", { files: [theirs.id] })).rejects.toBeInstanceOf(GcsForbidden);
    const m = await chat.send(a, "general", "", { files: [mine.id] });
    expect(m.files).toEqual([{ id: mine.id, kind: "image", width: 8, height: 8 }]);
    expect((await queries.recent(b, "general"))[0]!.files).toHaveLength(1);
    // Cine citește camera descarcă fișierul; un vizitator nu.
    await expect(w.attachments.open(b, mine.id)).resolves.toMatchObject({ mime: "image/png" });
    await expect(w.attachments.open(w.guest, mine.id)).rejects.toBeInstanceOf(GcsNotFound);
    // Același fișier nu se poate refolosi într-un alt mesaj.
    await clear(a);
    await expect(chat.send(a, "general", "", { files: [mine.id] })).rejects.toBeInstanceOf(GcsForbidden);
    await w.settings.set("chat.allow_images", false, w.root);
    const again = await upload(a);
    await clear(a);
    await expect(chat.send(a, "general", "", { files: [again.id] })).rejects.toMatchObject({ fields: { files: "unsupported_type" } });
  });

  test("configurația pentru client nu conține cheia GIPHY, doar dacă există", async () => {
    expect((await chat.config()).giphy).toBe(false);
    await w.settings.set("chat.giphy_key", "secret-cheie", w.root);
    const config = await chat.config();
    expect(config).toMatchObject({ giphy: true, timeFormat: "24h", pageSize: 30, maxLength: 500 });
    expect(JSON.stringify(config)).not.toContain("secret-cheie");
    expect(await chat.giphyKey()).toBe("secret-cheie");
    // Linkul „Reguli” oprit din ACP: clientul nu mai primește textul (care rămâne salvat).
    await w.settings.set("chat.rules", "Fără spam.", w.root);
    expect((await chat.config()).rulesHtml).toBe("<p>Fără spam.</p>");
    await w.settings.set("chat.show_rules", false, w.root);
    expect((await chat.config()).rulesHtml).toBe("");
  });

  test("regulile formatate în editor: documentul validat ajunge HTML sanitizat; imaginile și scripturile sunt refuzate", async () => {
    const rules = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Reguli" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Fără spam", marks: [{ type: "bold" }, { type: "textStyle", attrs: { color: "#D62839" } }] }] }] }] },
      ],
    };
    await w.settings.set("chat.rules", rules, w.root);
    expect((await chat.config()).rulesHtml).toBe('<h3>Reguli</h3><ul><li><p><strong><span style="color:#D62839">Fără spam</span></strong></p></li></ul>');
    const rejects = (value: unknown) => w.settings.set("chat.rules", value, w.root).catch((e: unknown) => (e as GcsValidationError).fields);
    expect(await rejects({ type: "doc", content: [{ type: "image", attrs: { src: "https://cdn.example/a.png" } }] })).toEqual({ "chat.rules": "format_not_allowed" });
    expect(await rejects({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] })).toEqual({ "chat.rules": "invalid" });
    expect(await rejects({ type: "html", html: "<script>alert(1)</script>" })).toEqual({ "chat.rules": "invalid" });
    expect(await rejects("x".repeat(5001))).toEqual({ "chat.rules": "too_long" });
    // Golirea regulilor e permisă (fără butonul „Reguli”).
    await w.settings.set("chat.rules", "", w.root);
    expect((await chat.config()).rulesHtml).toBe("");
  });

  test("istoricul cu cursor", async () => {
    const author = w.root;
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push((await chat.send(author, "general", `m${i}`)).id);
    expect((await queries.history(author, "general", ids[3]!, 2)).map((m) => m.body)).toEqual(["m1", "m2"]);
    expect((await queries.recent(author, "general", 2)).map((m) => m.body)).toEqual(["m3", "m4"]);
  });

  test("retenția: 8 zile se șterge, 6 rămâne; alt canal cu 30 de zile nu e atins", async () => {
    await chat.createChannel(w.root, { key: "arhiva", name: "Arhivă", retentionDays: 30 });
    const [general, arhiva] = await Promise.all([w.db.chatChannel.findUniqueOrThrow({ where: { key: "general" } }), w.db.chatChannel.findUniqueOrThrow({ where: { key: "arhiva" } })]);
    const now = new Date("2026-10-06T12:00:00Z");
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    await w.db.chatMessage.createMany({
      data: [
        { channelId: general.id, body: "vechi", createdAt: daysAgo(8) },
        { channelId: general.id, body: "recent", createdAt: daysAgo(6) },
        { channelId: arhiva.id, body: "arhivat", createdAt: daysAgo(8) },
      ],
    });
    expect(await chat.cleanup(now)).toBe(1);
    expect((await w.db.chatMessage.findMany({ orderBy: { id: "asc" } })).map((m) => m.body)).toEqual(["recent", "arhivat"]);
  });

  test("publicarea ajunge pe gcs:rt", async () => {
    const recorder = recordRealtime();
    await recorder.start();
    await chat.send(w.root, "general", "live");
    // În jurnal ajung și alte mesaje (ex. notificări); contează doar cel din camera chat-ului.
    expect(await recorder.messages(["chat:general"])).toContainEqual(expect.objectContaining({ room: "chat:general", event: "message", data: expect.objectContaining({ body: "live" }) }));
  });
});

describe("chat v2 (etapa 5)", () => {
  test("un membru fără drept nu creează camere; cu permisiune individuală poate", async () => {
    const a = await member("Ana");
    await expect(chat.createRoom(a, { name: "Echipa mea", type: "PUBLIC" })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(chat.createRoom(a, { name: "Echipa mea", type: "PRIVATE" })).rejects.toBeInstanceOf(GcsForbidden);
    await w.permissions.setUserPermission(w.root, a.userId!, "chat.create_public", true);
    const room = await chat.createRoom(await w.actorFor({ id: a.userId! }), { name: "Echipa mea", type: "PUBLIC" });
    expect(room).toMatchObject({ name: "Echipa mea", type: "PUBLIC", ownerId: a.userId });
    expect(room.key).toMatch(/^echipa-mea-[a-z0-9]{6}$/);
    expect((await queries.channels(await member("Bogdan"))).map((c) => c.key)).toContain(room.key);
  });

  test("o cameră privată: un necunoscut nu o vede și nu intră; invitatul da; proprietarul o redenumește și o șterge", async () => {
    const vip = await member("Vip", "vip_gold");
    const guest = await member("Invitat");
    const stranger = await member("Strain");
    const room = await chat.createRoom(vip, { name: "Secret", type: "PRIVATE", invite: ["Invitat"] });
    expect(room.type).toBe("PRIVATE");

    expect((await queries.channels(stranger)).map((c) => c.key)).not.toContain(room.key);
    expect(await queries.canRead(stranger, room.key)).toBe(false);
    await expect(queries.recent(stranger, room.key)).rejects.toThrow();
    await expect(chat.send(stranger, room.key, "intru")).rejects.toThrow();

    expect(await queries.canRead(guest, room.key)).toBe(true);
    await chat.send(guest, room.key, "salut");
    expect((await queries.roomMembers(vip, room.key)).map((u) => u.name).sort()).toEqual(["Invitat", "Vip"]);

    await expect(chat.rename(guest, room.key, "Furat")).rejects.toBeInstanceOf(GcsForbidden);
    await chat.rename(vip, room.key, "Secret 2");
    await chat.invite(vip, room.key, [stranger.userId!]);
    expect(await queries.canRead(stranger, room.key)).toBe(true);
    await chat.leave(stranger, room.key);
    expect(await queries.canRead(stranger, room.key)).toBe(false);
    await chat.deleteRoom(vip, room.key);
    expect(await w.db.chatChannel.findUnique({ where: { key: room.key } })).toBeNull();
  });

  test("editarea: doar autorul, doar în 5 minute; mesajul e marcat „editat”", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const m = await chat.send(a, "general", "greseala");
    await expect(chat.edit(b, m.id, "alt text")).rejects.toBeInstanceOf(GcsForbidden);
    const edited = await chat.edit(a, m.id, "corect");
    expect(edited).toMatchObject({ body: "corect" });
    expect(edited.editedAt).not.toBeNull();
    await expect(chat.edit(a, m.id, "tarziu", Date.now() + 6 * 60_000)).rejects.toMatchObject({ params: { reason: "edit_window" } });
  });

  test("reacțiile sunt unice pe user și pe reacție; a doua apăsare o retrage", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const m = await chat.send(a, "general", "gg");
    const [like, other] = await w.db.reaction.findMany({ where: { enabled: true }, orderBy: { id: "asc" }, take: 2 });
    await chat.react(b, m.id, like!.id);
    await chat.react(a, m.id, like!.id);
    expect(await chat.react(b, m.id, other!.id)).toEqual([
      { reactionId: like!.id, count: 2 },
      { reactionId: other!.id, count: 1 },
    ]);
    expect(await chat.react(b, m.id, like!.id)).toEqual([
      { reactionId: like!.id, count: 1 },
      { reactionId: other!.id, count: 1 },
    ]);
    await expect(chat.react(b, m.id, 999_999)).rejects.toThrow();
    const [view] = await queries.recent(b, "general");
    expect(view).toMatchObject({ mine: [other!.id] });
  });

  test("anunțul global apare în toate camerele; fixarea și anunțurile cer `chat.announce`", async () => {
    const a = await member("Ana");
    await chat.createChannel(w.root, { key: "offtopic", name: "Offtopic" });
    await expect(chat.announce(a, "nu am voie", 60)).rejects.toBeInstanceOf(GcsForbidden);

    const recorder = recordRealtime();
    await recorder.start();
    await chat.announce(staff, "Turneu sâmbătă la 20:00!", 120);
    const events = await recorder.messages();
    expect(events.filter((e) => e.event === "announcement").map((e) => e.room).sort()).toEqual(["chat:general", "chat:offtopic"]);
    expect((await queries.announcements()).map((x) => x.body)).toEqual(["Turneu sâmbătă la 20:00!"]);

    const m = await chat.send(a, "general", "regulament");
    await expect(chat.pin(a, "general", m.id)).rejects.toBeInstanceOf(GcsForbidden);
    await chat.pin(staff, "general", m.id);
    expect(await queries.pinned(a, "general")).toMatchObject({ id: m.id });
  });

  test("mențiunea @nume produce o notificare `chat.mention` pentru cel menționat", async () => {
    const { registerChatNotifications } = await import("./notify");
    registerChatNotifications({ db: w.db, bus: w.bus, notifications: w.notifications, chatQueries: queries, actors: w.actors });
    const a = await member("Ana");
    const b = await member("Bogdan");
    await chat.send(a, "general", "@Bogdan vino în joc");
    const rows = await w.db.notification.findMany({ where: { userId: b.userId!, type: "chat.mention" } });
    expect(rows).toHaveLength(1);
  });

  test("mențiunile după id: pastile în HTML, `meta.mentions`, notificări pentru membri și pentru grup", async () => {
    const { registerChatNotifications } = await import("./notify");
    const { GcsTextMentions } = await import("../profile/textMentions");
    registerChatNotifications({ db: w.db, bus: w.bus, notifications: w.notifications, chatQueries: queries, actors: w.actors });
    const withMentions = new GcsChatService({
      db: w.db,
      bus: w.bus,
      permissions: w.permissions,
      settings: w.settings,
      rateLimiter: w.rateLimiter,
      realtime: w.realtime,
      acp: w.acp,
      textMentions: new GcsTextMentions({ db: w.db, groupMentions: w.groupMentions }),
      groupMentions: w.groupMentions,
    });
    const a = await member("Ana");
    const bogdan = await w.createUser("Bogdan Popa", "member");
    const vera = await w.createUser("Vera", "vip_gold");
    await w.groupService.setMentionSettings(w.groups.vip_gold!, { enabled: true, allowedGroupIds: [w.groups.member!], notify: true, notifyLimit: 50, cooldownMinutes: 0 }, w.root);

    // Numele cu spațiu merge doar ales din sugestii; grupul, ales sau scris exact; un id ales dar scos din text nu contează.
    const m = await withMentions.send(a, "general", "salut @Bogdan Popa și @VIP Gold!", {
      mentions: [
        { kind: "user", id: bogdan.id },
        { kind: "group", id: String(w.groups.vip_gold) },
        { kind: "user", id: vera.id },
      ],
    });
    expect(m.mentions).toEqual([
      { kind: "user", id: bogdan.id, name: "Bogdan Popa" },
      { kind: "group", id: String(w.groups.vip_gold), name: "VIP Gold" },
    ]);
    expect(m.html).toContain(`data-user-id="${bogdan.id}"`);
    expect(m.html).toContain(`data-group-id="${w.groups.vip_gold}"`);
    const saved = await w.db.chatMessage.findUniqueOrThrow({ where: { id: m.id }, select: { meta: true } });
    expect((saved.meta as { mentions?: unknown[] }).mentions).toHaveLength(2);
    // Lista de mesaje aduce aceleași pastile (din `meta`), și după o redenumire (după id).
    await w.db.user.update({ where: { id: bogdan.id }, data: { name: "Bogdan P" } });
    const [again] = (await queries.recent(a, "general")).filter((x) => x.id === m.id);
    expect(again?.html).toContain(`href="/members/${bogdan.id}"`);

    await expect.poll(async () => w.db.notification.count({ where: { userId: bogdan.id, type: "chat.mention" } })).toBe(1);
    await expect.poll(async () => w.db.notification.count({ where: { userId: vera.id, type: "core.group_mention" } })).toBe(1);
    // Un grup pe care autorul nu-l poate menționa rămâne text.
    await clear(a);
    const plain = await withMentions.send(a, "general", "@Moderator salut", { mentions: [{ kind: "group", id: String(w.groups.moderator) }] });
    expect(plain.mentions ?? []).toEqual([]);
    expect(plain.html).not.toContain("gcs-groupMention");
  });
});
