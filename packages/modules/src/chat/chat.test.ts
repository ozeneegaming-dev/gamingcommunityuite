import { GcsForbidden, GcsRateLimited, REALTIME_CHANNEL, type GcsActor } from "@gcs/core";
import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, inject, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsChatService } from "./chat";
import { GcsChatQueries } from "./queries";
import { applyWordFilter, cleanChatText, renderChatText } from "./text";

let w: GcsProfileWorld;
let chat: GcsChatService;
let queries: GcsChatQueries;
let staff: GcsActor;

beforeEach(async () => {
  w = await createProfileWorld();
  chat = new GcsChatService({ db: w.db, bus: w.bus, permissions: w.permissions, settings: w.settings, rateLimiter: w.rateLimiter, realtime: w.realtime, acp: w.acp });
  queries = new GcsChatQueries({ db: w.db, permissions: w.permissions });
  staff = w.moderator;
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

async function member(name: string, group = "member"): Promise<GcsActor> {
  return w.actorFor(await w.createUser(name, group));
}

const clear = (a: GcsActor) => w.redis.del(`gcs:rl:chat:${a.userId}`);

describe("textul", () => {
  test("<script> e escapat, javascript: nu devine link, http(s) da", () => {
    expect(renderChatText(`<script>alert(1)</script>`)).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(renderChatText("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(renderChatText(`vezi https://ex.com/a?b=1&c="x" acum.`)).toBe(
      'vezi <a href="https://ex.com/a?b=1&amp;c=" rel="nofollow ugc noopener" target="_blank">https://ex.com/a?b=1&amp;c=</a>&quot;x&quot; acum.',
    );
    expect(renderChatText("link: https://ex.com.")).toBe('link: <a href="https://ex.com" rel="nofollow ugc noopener" target="_blank">https://ex.com</a>.');
  });

  test("filtrul înlocuiește cuvintele întregi, fără să conteze literele mari sau diacriticele", () => {
    expect(applyWordFilter("Prost și prost, dar nu prostie", ["prost"])).toBe("*** și ***, dar nu prostie");
    expect(applyWordFilter("Ești un PROȘTI", ["prosti"])).toBe("Ești un ***");
    expect(applyWordFilter("nimic", [])).toBe("nimic");
  });

  test("curățarea: un singur rând, fără caractere de control, max 500", () => {
    expect(cleanChatText("  a\nb\u0000c‮ ")).toBe("a bc");
    expect(cleanChatText("x".repeat(600))).toHaveLength(500);
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

  test("ștergerea (moderator) ascunde mesajul din recent; un membru nu poate șterge", async () => {
    const a = await member("Ana");
    const m = await chat.send(a, "general", "de șters");
    await expect(chat.delete(a, m.id)).rejects.toBeInstanceOf(GcsForbidden);
    await chat.delete(staff, m.id);
    expect(await queries.recent(a, "general")).toEqual([]);
    expect(await w.db.auditLog.count({ where: { action: "chat.message.delete" } })).toBe(1);
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
    const sub = new Redis(inject("redisUrl"), { db: Number(process.env.VITEST_POOL_ID ?? "1") });
    try {
      await sub.subscribe(REALTIME_CHANNEL);
      // Pe canal ajung și alte mesaje (ex. notificări); așteptăm doar mesajul din camera chat-ului.
      const got = new Promise<unknown>((resolve) =>
        sub.on("message", (_c, raw: string) => {
          const m = JSON.parse(raw) as { room: string };
          if (m.room === "chat:general") resolve(m);
        }),
      );
      await chat.send(w.root, "general", "live");
      expect(await got).toEqual(expect.objectContaining({ room: "chat:general", event: "message", data: expect.objectContaining({ body: "live" }) }));
    } finally {
      sub.disconnect();
    }
  });
});
