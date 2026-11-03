import type { GcsActor } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { GcsIndexNowService, INDEXNOW_STATE_KEY } from "./indexnow";
import { GcsSitemapService } from "./sitemap";

let w: GcsRemovalWorld;
let author: GcsActor;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  author = await w.user("Autor");
});

const sys = () => w.system();
const set = (key: string, value: unknown) => w.s.settings.set(key, value, sys());

/** Ascunde forumul de vizitatori (matricea proprie, fără citire pentru grupul `guest`), ca în ACP. */
async function hideFromGuests(forumId: number): Promise<void> {
  const { db } = w.s;
  // Matricea efectivă (urcând pe moștenire), cu grupul `guest` fără nicio acțiune.
  let source = String(forumId);
  for (;;) {
    const inherit = await db.containerInherit.findFirst({ where: { containerType: "forum", containerId: source } });
    if (!inherit?.inherits || !inherit.parentId) break;
    source = inherit.parentId;
  }
  const matrix: Record<number, string[]> = {};
  for (const r of await db.containerPermission.findMany({ where: { containerType: "forum", containerId: source } })) (matrix[r.groupId] ??= []).push(r.action);
  matrix[w.group("guest")] = [];
  await w.s.groups.setContainerInherit("forum", String(forumId), { inherits: false, parentId: null }, sys());
  await w.s.groups.setContainerPermissions("forum", String(forumId), matrix, sys());
}

/** Un sitemap cu bucăți mici (2 adrese), peste serviciile reale. */
function smallSitemap(): GcsSitemapService {
  const s = w.s;
  return new GcsSitemapService({
    db: s.db,
    settings: s.settings,
    permissions: s.permissions,
    apps: s.apps,
    guest: async () => {
      const g = await s.db.group.findUniqueOrThrow({ where: { key: "guest" } });
      return { userId: null, groupIds: [g.id], primaryGroupId: g.id, isBanned: false, ip: "0.0.0.0" };
    },
    clansVisible: (a) => s.clanQueries.canView(a),
    serverIds: (a) => s.serverQueries.visibleIds(a),
    chunk: 2,
  });
}

const paths = (entries: { path: string }[] | null) => (entries ?? []).map((e) => e.path);

describe("sitemap: doar ce vede un vizitator", () => {
  test("forumurile ascunse, cu parolă și topicurile lor lipsesc; topicurile vizibile au lastmod", async () => {
    const open = await w.forum("Public");
    const hidden = await w.forum("Staff");
    const locked = await w.forum("Parola");
    await hideFromGuests(hidden);
    await w.s.db.forum.update({ where: { id: locked }, data: { passwordHash: "x" } });
    const a = await w.topic(author, open, "Ghid public");
    const b = await w.topic(author, hidden, "Secret staff");
    const c = await w.topic(author, locked, "Cu parolă");

    const { sitemap } = w.s;
    const forums = paths(await sitemap.entries({ type: "forums", page: 1 }));
    expect(forums.some((p) => p.startsWith(`/forum/${open}-`))).toBe(true);
    expect(forums.some((p) => p.startsWith(`/forum/${hidden}-`) || p.startsWith(`/forum/${locked}-`))).toBe(false);
    const topics = await sitemap.entries({ type: "topics", page: 1 });
    expect(paths(topics)).toEqual([`/topic/${a.topicId}-ghid-public`]);
    expect(topics![0]!.lastModified).toBeInstanceOf(Date);
    expect(paths(topics).join()).not.toMatch(new RegExp(`/topic/(${b.topicId}|${c.topicId})-`));

    const index = await sitemap.indexXml("https://forum.exemplu.ro");
    expect(index).toContain("<loc>https://forum.exemplu.ro/sitemap/topics-1.xml</loc>");
    const xml = await sitemap.chunkXml("https://forum.exemplu.ro", "topics-1.xml");
    expect(xml).toContain(`<loc>https://forum.exemplu.ro/topic/${a.topicId}-ghid-public</loc><lastmod>`);
    expect(await sitemap.chunkXml("https://forum.exemplu.ro", "topics-2.xml")).toBeNull();
  });

  test("bucățile: index împărțit, fiecare fișier cu fereastra lui; limita pe tip taie restul", async () => {
    const forum = await w.forum();
    const ids: number[] = [];
    for (let i = 1; i <= 5; i++) ids.push((await w.topic(author, forum, `Topic ${i}`)).topicId);
    const sitemap = smallSitemap();
    expect((await sitemap.chunks()).filter((n) => n.startsWith("topics-"))).toEqual(["topics-1.xml", "topics-2.xml", "topics-3.xml"]);
    // Cele mai noi primele: 5, 4 | 3, 2 | 1.
    expect(paths(await sitemap.entries({ type: "topics", page: 2 }))).toEqual([ids[2], ids[1]].map((id) => `/topic/${id}-topic-${ids.indexOf(id!) + 1}`));
    expect(paths(await sitemap.entries({ type: "topics", page: 3 }))).toHaveLength(1);

    // Limita (scrisă direct: în ACP minimul e 100) → 3 adrese = 2 fișiere, al doilea cu una.
    await w.s.db.setting.create({ data: { key: "seo.sitemap_max_urls", value: 3 } });
    await w.s.cache.invalidateTags(["settings"]);
    expect((await sitemap.chunks()).filter((n) => n.startsWith("topics-"))).toEqual(["topics-1.xml", "topics-2.xml"]);
    expect(paths(await sitemap.entries({ type: "topics", page: 2 }))).toHaveLength(1);
    expect(await sitemap.entries({ type: "topics", page: 3 })).toBeNull();
  });

  test("profilurile: doar cele publice cu postări; oprite din ACP → fără fișier", async () => {
    const forum = await w.forum();
    await w.topic(author, forum, "Primul topic");
    const shy = await w.user("Discret");
    await w.topic(shy, forum, "Al doilea");
    await w.s.db.user.update({ where: { id: shy.userId! }, data: { privacy: { profile: "MEMBERS", messages: "MEMBERS", wall: "MEMBERS", showOnline: true } } });
    await w.user("FaraPostari");

    const { sitemap } = w.s;
    expect(paths(await sitemap.entries({ type: "members", page: 1 }))).toEqual([`/members/${author.userId}-autor`]);
    expect(await sitemap.chunks()).toContain("members-1.xml");

    await set("seo.index_profiles", false);
    expect(await sitemap.chunks()).not.toContain("members-1.xml");
    expect(await sitemap.entries({ type: "members", page: 1 })).toBeNull();
    await set("seo.index_profiles", true);
    await set("seo.sitemap_members", false);
    expect(await sitemap.entries({ type: "members", page: 1 })).toBeNull();
  });

  test("paginile: principala mereu; regulile apar doar după ce sunt scrise; sitemap oprit → 404", async () => {
    const { sitemap } = w.s;
    expect(paths(await sitemap.entries({ type: "pages", page: 1 }))).toContain("/");
    expect(paths(await sitemap.entries({ type: "pages", page: 1 }))).not.toContain("/rules");
    await set("rules.content", { doc: { type: "doc", content: [] }, html: "<p>Reguli</p>", updatedAt: "2026-11-01T10:00:00.000Z" });
    const pages = await sitemap.entries({ type: "pages", page: 1 });
    expect(pages?.find((p) => p.path === "/rules")?.lastModified?.toISOString()).toBe("2026-11-01T10:00:00.000Z");

    await set("seo.sitemap_enabled", false);
    expect(await sitemap.indexXml("https://forum.exemplu.ro")).toBeNull();
    expect(await sitemap.chunkXml("https://forum.exemplu.ro", "pages-1.xml")).toBeNull();
  });
});

describe("IndexNow", () => {
  type Sent = { url: string; body: { host: string; key: string; keyLocation: string; urlList: string[] } };
  let sent: Sent[];
  let reply: { status: number; retryAfter?: string } | "network";

  function service(batch = 100): GcsIndexNowService {
    const s = w.s;
    return new GcsIndexNowService({
      db: s.db,
      settings: s.settings,
      siteUrl: async () => (await s.settings.get<string>("site.url")) || "http://localhost:3000",
      changedTopics: (since, limit) => s.sitemap.changedTopics(since, limit),
      batch,
      fetch: (async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)) as Sent["body"] });
        if (reply === "network") throw new TypeError("fetch failed");
        return new Response(null, { status: reply.status, headers: reply.retryAfter ? { "Retry-After": reply.retryAfter } : {} });
      }) as unknown as typeof fetch,
    });
  }

  beforeEach(async () => {
    sent = [];
    reply = { status: 200 };
    await set("site.url", "https://forum.exemplu.ro");
  });

  test("oprit sau pe un site local nu trimite nimic", async () => {
    const svc = service();
    expect(await svc.run()).toEqual({ sent: 0, skipped: "disabled" });
    await set("seo.indexnow_enabled", true);
    await set("site.url", "http://localhost:3100");
    expect(await svc.run()).toEqual({ sent: 0, skipped: "local_site" });
    expect(sent).toHaveLength(0);
  });

  test("trimite doar topicurile publice noi, într-un lot, cu cheia și fișierul ei; apoi doar ce s-a schimbat", async () => {
    const svc = service();
    await set("seo.indexnow_enabled", true);
    const start = new Date(Date.now() - 60_000);
    await svc.markStart(start);
    const open = await w.forum("Public");
    const hidden = await w.forum("Staff");
    await hideFromGuests(hidden);
    const a = await w.topic(author, open, "Turneu nou");
    const b = await w.topic(author, open, "Mix de seară");
    await w.topic(author, hidden, "Doar staff");

    const first = await svc.run();
    expect(first).toEqual({ sent: 2, status: 200 });
    const key = await w.s.settings.get<string>("seo.indexnow_key");
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(sent[0]!.url).toBe("https://api.indexnow.org/indexnow");
    expect(sent[0]!.body).toEqual({
      host: "forum.exemplu.ro",
      key,
      keyLocation: `https://forum.exemplu.ro/${key}.txt`,
      urlList: [`https://forum.exemplu.ro/topic/${a.topicId}-turneu-nou`, `https://forum.exemplu.ro/topic/${b.topicId}-mix-de-seara`],
    });
    expect(await svc.servedKey(key)).toBe(key);
    expect(await svc.servedKey("0".repeat(32))).toBeNull();

    // Nimic nou: nicio cerere. Un răspuns nou la un topic: doar acel topic (20 de răspunsuri ar fi tot o adresă).
    expect(await svc.run()).toEqual({ sent: 0, skipped: "nothing" });
    await new Promise((r) => setTimeout(r, 15));
    await w.reply(author, a.topicId, "Mă înscriu");
    await w.reply(author, a.topicId, "Și eu");
    expect(await svc.run()).toEqual({ sent: 1, status: 200 });
    expect(sent[1]!.body.urlList).toEqual([`https://forum.exemplu.ro/topic/${a.topicId}-turneu-nou`]);
  });

  test("loturile: cel mult `batch` adrese pe rulare, restul la rularea următoare", async () => {
    const svc = service(2);
    await set("seo.indexnow_enabled", true);
    await svc.markStart(new Date(Date.now() - 60_000));
    const forum = await w.forum();
    for (let i = 1; i <= 3; i++) await w.topic(author, forum, `Lot ${i}`);
    expect(await svc.run()).toEqual({ sent: 2, status: 200 });
    expect(await svc.run()).toEqual({ sent: 1, status: 200 });
    expect(sent.map((s) => s.body.urlList.length)).toEqual([2, 1]);
  });

  test("429: așteaptă (Retry-After), fără să piardă adresele; după pauză le retrimite", async () => {
    const svc = service();
    await set("seo.indexnow_enabled", true);
    await svc.markStart(new Date(Date.now() - 60_000));
    const forum = await w.forum();
    await w.topic(author, forum, "Prea repede");
    reply = { status: 429, retryAfter: "7200" };
    const now = new Date();
    expect(await svc.run(now)).toEqual({ sent: 0, status: 429, error: "http_429" });
    const state = await svc.state();
    expect(new Date(state.retryAt!).getTime()).toBe(now.getTime() + 7_200_000);
    expect(state.failures).toBe(1);
    expect(await svc.run(new Date(now.getTime() + 3_600_000))).toEqual({ sent: 0, skipped: "backoff" });

    reply = { status: 202 };
    expect(await svc.run(new Date(now.getTime() + 7_300_000))).toEqual({ sent: 1, status: 202 });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.urlList).toEqual(sent[0]!.body.urlList);
    expect((await svc.state()).failures).toBe(0);
  });

  test("eroare de rețea → reîncercare exponențială; 422 → lotul respins, se trece mai departe", async () => {
    const svc = service();
    await set("seo.indexnow_enabled", true);
    await svc.markStart(new Date(Date.now() - 60_000));
    const forum = await w.forum();
    await w.topic(author, forum, "Rețea căzută");
    reply = "network";
    const now = new Date();
    expect(await svc.run(now)).toMatchObject({ sent: 0, status: 0, error: "TypeError" });
    expect(new Date((await svc.state()).retryAt!).getTime()).toBe(now.getTime() + 5 * 60_000);

    reply = { status: 422 };
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(await svc.run(later)).toEqual({ sent: 0, status: 422, error: "http_422" });
    const state = await svc.state();
    expect(state).toMatchObject({ retryAt: null, failures: 0, lastStatus: 422, lastError: "http_422" });
    expect(await svc.run(new Date(later.getTime() + 1000))).toEqual({ sent: 0, skipped: "nothing" });
    // Starea e un rând intern din `settings` (fără definiție în ACP).
    expect(await w.s.db.setting.findUnique({ where: { key: INDEXNOW_STATE_KEY } })).not.toBeNull();
  });
});
