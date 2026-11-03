import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { analyticsConfigError, analyticsTags, DEFAULT_ANALYTICS, integrationsOverview } from "./integrations";

let w: GcsRemovalWorld;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
});

describe("cheile API", () => {
  test("cheia se vede o singură dată, se verifică după hash, drepturi, revocare și jurnal", async () => {
    const root = await w.user("RootApi", "root_admin");
    const { apiKeys } = w.s;
    await expect(apiKeys.create(root, "Bot", [])).rejects.toMatchObject({ fields: { scopes: "required" } });
    const { id, key } = await apiKeys.create(root, "Bot Discord", ["stats:read", "necunoscut"]);
    expect(key).toMatch(/^gcs_[a-f0-9]{12}_[A-Za-z0-9_-]{32}$/);
    const row = await w.s.db.apiKey.findUniqueOrThrow({ where: { id } });
    expect(row.hash).not.toContain(key.split("_")[2]!);
    expect(row.scopes).toEqual(["stats:read"]);

    expect(await apiKeys.authorize(`Bearer ${key}`, "stats:read")).toBe(id);
    await expect(apiKeys.authorize(`Bearer ${key}`, "members:read")).rejects.toMatchObject({ params: { reason: "api_scope" } });
    await expect(apiKeys.authorize(`Bearer ${key.slice(0, -1)}x`, "stats:read")).rejects.toMatchObject({ params: { reason: "api_key" } });
    await expect(apiKeys.authorize(null, "stats:read")).rejects.toMatchObject({ params: { reason: "api_key" } });

    await apiKeys.record(id, { at: 1, path: "/api/v1/stats", status: 200, ip: "203.0.113.9" });
    await apiKeys.record(id, { at: 2, path: "/api/v1/members/x", status: 404, ip: null });
    const [view] = await apiKeys.list(root);
    expect(view).toMatchObject({ name: "Bot Discord", scopes: ["stats:read"] });
    expect(view!.lastUsedAt).not.toBeNull();
    expect(view!.log.map((c) => c.status)).toEqual([404, 200]);
    expect(view).not.toHaveProperty("hash");

    await apiKeys.update(root, id, "Bot nou", ["stats:read", "members:read"]);
    expect(await apiKeys.authorize(`Bearer ${key}`, "members:read")).toBe(id);
    await apiKeys.revoke(root, id);
    await expect(apiKeys.authorize(`Bearer ${key}`, "stats:read")).rejects.toMatchObject({ params: { reason: "api_key" } });
    await apiKeys.remove(root, id);
    expect(await apiKeys.list(root)).toEqual([]);
    await expect(apiKeys.list(await w.user("FaraDreptApi"))).rejects.toThrow();
  });

  test("limita pe minut a unei chei", async () => {
    const root = await w.user("RootRate", "root_admin");
    const { key } = await w.s.apiKeys.create(root, "Grăbit", ["stats:read"]);
    for (let i = 0; i < 60; i++) await w.s.apiKeys.authorize(`Bearer ${key}`, "stats:read");
    await expect(w.s.apiKeys.authorize(`Bearer ${key}`, "stats:read")).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("datele publice: statistici, topicuri și profiluri văzute ca vizitator", async () => {
    await w.s.settings.set("site.url", "https://forum.test/", await w.user("RootSite", "root_admin"));
    const member = await w.user("Jucator Unu");
    const forum = await w.forum();
    await w.topic(member, forum, "Turneu de vineri");
    const guest = await w.s.actors.forGuest("203.0.113.20");

    const stats = await w.s.publicApi.stats();
    expect(stats).toMatchObject({ topics: 1, posts: 1 });
    expect(stats.newestMember?.url).toMatch(/^https:\/\/forum\.test\/members\//);

    const topics = await w.s.publicApi.topics(guest, 500);
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ title: "Turneu de vineri", lastPoster: { name: "Jucator Unu" } });
    expect(topics[0]!.url).toMatch(/^https:\/\/forum\.test\/topic\/\d+-/);

    const profile = await w.s.publicApi.member(guest, "jucator unu");
    expect(profile).toMatchObject({ name: "Jucator Unu", posts: 1 });
    expect(profile).not.toHaveProperty("email");
    expect(await w.s.publicApi.member(guest, "nimeni")).toBeNull();
  });
});

describe("integrările", () => {
  test("analiza traficului: validarea și scripturile fiecărui serviciu", () => {
    expect(analyticsConfigError(DEFAULT_ANALYTICS)).toBeNull();
    expect(analyticsConfigError({ ...DEFAULT_ANALYTICS, provider: "ga4" })).toBe("invalid_ga4");
    expect(analyticsConfigError({ ...DEFAULT_ANALYTICS, provider: "ga4", ga4Id: "G-ABC123\";alert(1)//" })).toBe("invalid_ga4");
    expect(analyticsConfigError({ ...DEFAULT_ANALYTICS, provider: "plausible", plausibleDomain: "forum.exemplu.ro", plausibleSrc: "http://plausible.io/js/script.js" })).toBe("invalid_url");
    expect(analyticsConfigError({ ...DEFAULT_ANALYTICS, provider: "umami", umamiId: "nu-e-uuid" })).toBe("invalid_uuid");

    expect(analyticsTags(DEFAULT_ANALYTICS)).toBeNull();
    const ga = analyticsTags({ ...DEFAULT_ANALYTICS, provider: "ga4", ga4Id: "G-ABC1234" })!;
    expect(ga.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-ABC1234");
    expect(ga.inline).toContain('gtag("config","G-ABC1234")');
    expect(analyticsTags({ ...DEFAULT_ANALYTICS, provider: "plausible", plausibleDomain: "forum.exemplu.ro" })).toMatchObject({ attrs: { "data-domain": "forum.exemplu.ro" }, inline: null });
  });

  test("starea serviciilor externe după setări", async () => {
    const root = await w.user("RootIntegr", "root_admin");
    const { settings, db } = w.s;
    await settings.set("auth.discord_client_id", "123", root);
    await settings.set("auth.google_client_id", "abc", root);
    await settings.set("auth.google_client_secret", "secret", root);
    await settings.set("antispam.captcha", "turnstile", root);
    await w.s.apiKeys.create(root, "Bot", ["stats:read"]);
    const items = Object.fromEntries((await integrationsOverview({ db, settings })).map((i) => [i.key, i]));
    expect(items.discord).toMatchObject({ level: "warn", href: "/admin/settings/auth" });
    expect(items.google!.level).toBe("ok");
    expect(items.steam!.level).toBe("off");
    expect(items.turnstile!.level).toBe("warn");
    expect(items.api).toMatchObject({ level: "ok", detail: "1" });
    expect(items.webhooks).toMatchObject({ level: "off", detail: "0" });
  });
});
