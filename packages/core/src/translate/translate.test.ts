import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsRedisRateLimiter } from "../auth/rateLimit";
import { GcsForbidden, GcsNotFound, GcsRateLimited } from "../errors";
import type { GcsModule } from "../modules/registry";
import { GcsSettingsService } from "../settings/service";
import { GcsDeepLProvider, GcsLibreTranslateProvider, type GcsTranslateProvider } from "./providers";
import { GcsTranslationService } from "./service";

const perms: GcsModule = {
  key: "translatetest",
  settings: [],
  acpMenu: [],
  eventListeners: [],
  permissions: [{ key: "core.translate", scope: "group", labelKey: "p", default: { member: true, admin: true } }],
};

let w: GcsTestWorld;
let calls: string[];
let provider: GcsTranslateProvider;
let svc: GcsTranslationService;
const visible = new Set(["1"]);

beforeEach(async () => {
  w = await createWorld([perms]);
  calls = [];
  provider = {
    name: "fake",
    translateHtml: async (html, target) => {
      calls.push(html);
      // Ca un traducător real: textul se schimbă, tag-urile rămân; încearcă și să strecoare un script.
      return `${html.replace(/salut/g, target === "de" ? "hallo" : "hello")}<script>alert(1)</script>`;
    },
  };
  svc = new GcsTranslationService({
    db: w.db,
    cache: w.cache,
    settings: new GcsSettingsService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry }),
    permissions: w.permissions,
    rateLimiter: new GcsRedisRateLimiter(w.redis),
    provider,
  });
  svc.registerContent("post", {
    canView: async (_actor, id) => visible.has(id),
    html: async (id) => (id === "1" || id === "2" ? `<p>salut <a href="https://x.ro" rel="nofollow ugc noopener">link</a> <strong>tare</strong></p>` : null),
  });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("GcsTranslationService", () => {
  test("traduce HTML-ul, păstrează linkurile și formatarea, iar rezultatul e re-sanitizat", async () => {
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    const res = await svc.translate(ana, { contentType: "post", contentId: "1" }, "de");
    expect(res.cached).toBe(false);
    expect(res.html).toContain("hallo");
    expect(res.html).toContain('<a href="https://x.ro" rel="nofollow ugc noopener">link</a>');
    expect(res.html).toContain("<strong>tare</strong>");
    expect(res.html).not.toContain("<script");
  });

  test("a doua cerere vine din cache (Redis, apoi baza), fără providerul extern", async () => {
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    await svc.translate(ana, { contentType: "post", contentId: "1" }, "de");
    expect((await svc.translate(ana, { contentType: "post", contentId: "1" }, "de")).cached).toBe(true);
    await w.redis.flushdb();
    expect((await svc.translate(ana, { contentType: "post", contentId: "1" }, "de")).cached).toBe(true);
    expect(calls).toHaveLength(1);
    expect(await w.db.translationCache.count()).toBe(1);
  });

  test("conținutul invizibil sau inexistent nu se traduce; fără permisiune sau fără provider → refuzat", async () => {
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    await expect(svc.translate(ana, { contentType: "post", contentId: "2" }, "de")).rejects.toBeInstanceOf(GcsNotFound);
    await expect(svc.translate(ana, { contentType: "nimic", contentId: "1" }, "de")).rejects.toBeInstanceOf(GcsNotFound);
    await expect(svc.translate(ana, { contentType: "post", contentId: "1" }, "xx")).rejects.toThrow();
    const guest = { userId: null, groupIds: [w.groups.guest!], primaryGroupId: w.groups.guest!, isBanned: false, ip: "1.2.3.4" };
    await expect(svc.translate(guest, { contentType: "post", contentId: "1" }, "de")).rejects.toBeInstanceOf(GcsForbidden);
    expect(await svc.available(guest)).toBe(false);
    expect(await svc.available(ana)).toBe(true);
    expect(calls).toHaveLength(0);

    const off = new GcsTranslationService({ db: w.db, cache: w.cache, settings: new GcsSettingsService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry }), permissions: w.permissions, rateLimiter: new GcsRedisRateLimiter(w.redis), provider: null });
    expect(await off.available(ana)).toBe(false);
  });

  test("peste 30 de traduceri noi pe minut → GcsRateLimited", async () => {
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    const targets = ["de", "es", "fr", "ru", "en", "ro"];
    let limited = false;
    for (let i = 0; i < 31 && !limited; i++) {
      svc.registerContent(`t${i}`, { canView: async () => true, html: async () => `<p>salut ${i}</p>` });
      try {
        await svc.translate(ana, { contentType: `t${i}`, contentId: "x" }, targets[i % targets.length]!);
      } catch (error) {
        expect(error).toBeInstanceOf(GcsRateLimited);
        limited = true;
      }
    }
    expect(limited).toBe(true);
  });
});

describe("providerii", () => {
  test("LibreTranslate: format html, limba sursă detectată", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ translatedText: "<p>hallo</p>" }), { status: 200 }));
    const p = new GcsLibreTranslateProvider("http://translate:5000/", fetchMock as unknown as typeof fetch);
    expect(await p.translateHtml("<p>salut</p>", "de")).toBe("<p>hallo</p>");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://translate:5000/translate");
    expect(JSON.parse(init.body as string)).toEqual({ q: "<p>salut</p>", source: "auto", target: "de", format: "html" });
  });

  test("DeepL: cheile gratuite merg pe api-free, cu tag_handling html", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ translations: [{ text: "<p>Hello</p>" }] }), { status: 200 }));
    const p = new GcsDeepLProvider("abc:fx", fetchMock as unknown as typeof fetch);
    expect(await p.translateHtml("<p>salut</p>", "en")).toBe("<p>Hello</p>");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-free.deepl.com/v2/translate");
    expect(JSON.parse(init.body as string)).toMatchObject({ target_lang: "EN-GB", tag_handling: "html" });
    expect((init.headers as Record<string, string>).authorization).toBe("DeepL-Auth-Key abc:fx");
  });

  test("o eroare HTTP a providerului devine eroare", async () => {
    const p = new GcsLibreTranslateProvider("http://x", (async () => new Response("down", { status: 503 })) as unknown as typeof fetch);
    await expect(p.translateHtml("<p>x</p>", "de")).rejects.toThrow("503");
  });
});
