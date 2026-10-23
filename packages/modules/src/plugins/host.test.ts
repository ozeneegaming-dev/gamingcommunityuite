import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { GcsActor } from "@gcs/core";
import { closePluginServices, createPluginServices, installTestPlugin, pluginFiles, resetPluginWorld } from "../../test/pluginWorld";
import type { GcsServices } from "../services";
import { isBlockedAddress } from "./http";
import { isPluginRedirect, matchPluginRoute, plainPayload } from "./host";

const KEYS = ["acme.probe", "acme.spin", "acme.filter", "acme.ctx", "acme.events", "acme.throw", "acme.slow", "acme.assets"];

let services: GcsServices;
let configDir: string;
let root: GcsActor;
let member: GcsActor;
let guest: GcsActor;

beforeAll(async () => {
  ({ services, configDir } = await createPluginServices());
});

afterAll(async () => {
  await closePluginServices(services, configDir, KEYS);
});

beforeEach(async () => {
  ({ root, member, guest } = await resetPluginWorld(services, KEYS));
});

const api = (key: string, path: string, actor: GcsActor) => services.plugins.handleApi(key, { method: "GET", path, query: {}, body: null, actor, locale: "ro" });

describe("izolarea firului pluginului", () => {
  test("fără module Node, fără mediul procesului, fără rețea", async () => {
    const server = `
      export default {
        api: {
          "/probe": async () => {
            const out = {};
            for (const spec of ["node:fs", "fs", "node:child_process", "node:net", "node:http", "node:worker_threads", "node:module", "node:vm", "data:text/javascript,export default 1", "../../../../package.json", "./server.mjs"]) {
              try { await import(spec); out[spec] = "allowed"; } catch { out[spec] = "blocked"; }
            }
            out.env = JSON.stringify(process.env);
            out.binding = typeof process.binding;
            out.dlopen = typeof process.dlopen;
            out.getBuiltinModule = typeof process.getBuiltinModule;
            out.kill = typeof process.kill;
            out.fetch = typeof fetch;
            out.require = typeof require;
            out.websocket = typeof WebSocket;
            out.broadcast = typeof BroadcastChannel;
            try { out.ctor = (function () {}).constructor("return typeof process.binding")(); } catch (e) { out.ctor = "error"; }
            console.log("salut din plugin");
            return { body: out };
          },
        },
      };`;
    const key = await installTestPlugin(services, root, pluginFiles({ key: "acme.probe", capabilities: ["api"], routes: { api: [{ path: "/probe", methods: ["GET"] }] } }, server));
    const res = await api(key, "/probe", root);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      "node:fs": "blocked",
      fs: "blocked",
      "node:child_process": "blocked",
      "node:net": "blocked",
      "node:http": "blocked",
      "node:worker_threads": "blocked",
      "node:module": "blocked",
      "node:vm": "blocked",
      "data:text/javascript,export default 1": "blocked",
      "../../../../package.json": "blocked",
      "./server.mjs": "allowed",
      env: "{}",
      binding: "undefined",
      dlopen: "undefined",
      getBuiltinModule: "undefined",
      kill: "undefined",
      fetch: "undefined",
      require: "undefined",
      websocket: "undefined",
      broadcast: "undefined",
      ctor: "undefined",
    });
    await services.plugins.idle();
    expect((await services.pluginAdmin.logs(key)).map((l) => l.message)).toContain("salut din plugin");
  });

  test("bucla infinită: timeout, firul oprit, apoi dezactivarea automată după 2 eșecuri", async () => {
    const server = `export default { widgets: { spin: () => { while (true) {} } } };`;
    const key = await installTestPlugin(services, root, pluginFiles({ key: "acme.spin", capabilities: ["widgets"], widgets: [{ key: "spin", label: "Spin" }] }, server));
    const type = "plugin.acme.spin.spin";
    expect(services.registry.widgetDef(type)).toBeDefined();
    const render = () => services.plugins.renderWidget(type, { config: {}, actor: guest, locale: "ro", page: "index", zone: "sidebar" });

    const started = Date.now();
    expect(await render()).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
    // Serverul răspunde în continuare (bucla e în firul pluginului).
    expect(await services.db.user.count()).toBeGreaterThan(0);
    expect(await render()).toBeNull();
    await services.plugins.idle();

    expect(await services.pluginAdmin.get(key)).toMatchObject({ enabled: false, disabledReason: "auto" });
    expect(services.plugins.loadedKeys()).not.toContain(key);
    expect(services.registry.widgetDef(type)).toBeUndefined();
    expect(await services.db.auditLog.findFirst({ where: { action: "plugin.auto_disable", targetId: key } })).not.toBeNull();
    expect((await services.pluginAdmin.logs(key)).some((l) => /timeout/.test(l.message))).toBe(true);
  }, 40_000);
});

describe("dezactivarea automată: doar eșecurile pluginului", () => {
  test("erorile aruncate pe datele unui vizitator se jurnalizează și apar în metrici, dar nu opresc pluginul", async () => {
    const server = `export default { api: { "/item": (req) => ({ body: req.query.id.trim() }) } };`;
    const key = await installTestPlugin(services, root, pluginFiles({ key: "acme.throw", capabilities: ["api"], routes: { api: [{ path: "/item", methods: ["GET"] }] } }, server));
    // Pragul testelor e 2: patru cereri construite să arunce o eroare nu ajung să-l dezactiveze.
    for (const res of await Promise.all([1, 2, 3, 4].map(() => api(key, "/item", guest)))) expect(res).toEqual({ status: 500, body: { error: "plugin_error" } });
    await services.plugins.idle();
    expect(await services.pluginAdmin.get(key)).toMatchObject({ enabled: true, disabledReason: null });
    expect(services.plugins.loadedKeys()).toContain(key);
    expect((await services.pluginAdmin.logs(key)).filter((l) => l.level === "error")).toHaveLength(4);
    expect((await services.plugins.hookMetrics(key))["api:/item"]).toMatchObject({ count: 4, failures: 4 });
    expect(await services.plugins.handleApi(key, { method: "GET", path: "/item", query: { id: " 7 " }, body: null, actor: guest, locale: "ro" })).toEqual({ status: 200, body: "7" });
  });

  test("apelurile în curs la descărcarea pluginului nu se numără ca eșecuri", async () => {
    const server = `export default { api: { "/slow": async () => { await new Promise((r) => setTimeout(r, 1500)); return { body: 1 }; } } };`;
    const key = await installTestPlugin(services, root, pluginFiles({ key: "acme.slow", capabilities: ["api"], routes: { api: [{ path: "/slow", methods: ["GET"] }] } }, server));
    const calls = [1, 2, 3].map(() => api(key, "/slow", guest));
    await new Promise((r) => setTimeout(r, 300));
    await services.pluginAdmin.setEnabled(root, key, false);
    for (const res of await Promise.all(calls)) expect(res.status).toBe(500);
    await services.plugins.idle();
    expect((await services.pluginAdmin.logs(key)).filter((l) => l.level === "error" || l.level === "warn")).toEqual([]);
    expect(await services.kv.get(`gcs:plugin:fail:${key}`)).toBeNull();
    expect(await services.pluginAdmin.get(key)).toMatchObject({ enabled: false, disabledReason: "admin" });
  });
});

describe("fișierele client", () => {
  test("extensia contează cu litere mici: un plugin nesemnat nu primește niciodată JS servit ca script", async () => {
    const key = await installTestPlugin(services, root, pluginFiles({ key: "acme.assets" }, "export default {};", { "assets/evil.js": "alert(1)", "assets/logo.png": "png" }), { signed: false });
    expect(await services.plugins.asset(key, "assets/logo.png")).toMatchObject({ contentType: "image/png" });
    for (const p of ["assets/evil.js", "assets/evil.JS", "assets/evil.Js", "assets/logo.PNG", "assets/evil.SVG", "assets/evil.HTML"]) {
      expect([p, await services.plugins.asset(key, p)]).toEqual([p, null]);
    }
  });
});

describe("hook-urile", () => {
  test("filtrul post.before_save modifică titlul sau respinge; un filtru stricat e sărit", async () => {
    const server = `
      export default {
        filters: {
          "post.before_save": (data) => {
            if (JSON.stringify(data.content).includes("spam")) return { reject: "Fără spam aici" };
            if (JSON.stringify(data.content).includes("boom")) throw new Error("boom");
            return { ...data, title: data.title ? data.title.toUpperCase() : data.title, forumId: 999 };
          },
        },
      };`;
    await installTestPlugin(services, root, pluginFiles({ key: "acme.filter", capabilities: ["filters"], filters: [{ point: "post.before_save" }] }, server));
    const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const base = { kind: "topic" as const, forumId: 1, topicId: null, authorId: member.userId };

    const out = await services.posting.filterContent(member, { ...base, title: "salut", content: doc("ok") });
    expect(out).toMatchObject({ title: "SALUT", forumId: 1 });
    await expect(services.posting.filterContent(member, { ...base, title: "x", content: doc("spam") })).rejects.toMatchObject({
      code: "validation",
      fields: { content: "Test: Fără spam aici" },
      params: { plugin: "acme.filter" },
    });
    expect(await services.posting.filterContent(member, { ...base, title: "neschimbat", content: doc("boom") })).toMatchObject({ title: "neschimbat" });

    // Oprit din pagina Hook-uri: nu mai rulează.
    await services.pluginAdmin.setHook(root, "acme.filter", "post.before_save", { enabled: false, priority: null });
    expect(await services.posting.filterContent(member, { ...base, title: "salut", content: doc("ok") })).toMatchObject({ title: "salut" });
  });

  test("evenimentele: livrare asincronă, doar câmpurile simple, în tabelul pluginului", async () => {
    const server = `
      export default {
        events: {
          "post.created": async (e, ctx) => {
            await ctx.db.execute("INSERT INTO seen (payload) VALUES ($1)", [JSON.stringify(e.payload)]);
          },
        },
      };`;
    const key = await installTestPlugin(
      services,
      root,
      pluginFiles({ key: "acme.events", capabilities: ["events", "db"], events: ["post.created"] }, server, { "migrations/001_seen.sql": "CREATE TABLE seen (payload text NOT NULL);" }),
    );
    await services.bus.emit({ name: "post.created", payload: { postId: 7, topicId: 3, nested: { secret: 1 }, tags: ["a", "b"] }, tags: [] });
    await services.bus.emit({ name: "settings.updated", payload: { key: "x" }, tags: [] });
    await services.plugins.idle();
    const creds = (await services.pluginAdmin.credentials(key))!;
    const { GcsPluginDatabase } = await import("@gcs/core");
    const database = new GcsPluginDatabase({ databaseUrl: process.env.DATABASE_URL });
    const rows = (await database.query(key, creds, "SELECT payload FROM seen")).rows.map((r) => JSON.parse(r.payload as string));
    await database.close();
    expect(rows).toEqual([{ postId: 7, topicId: 3, tags: ["a", "b"] }]);
  });

  test("contextul: SQL doar în schema proprie, capabilități, permisiuni, API cu drepturile vizitatorului", async () => {
    const server = `
      export default {
        api: {
          "/ctx": async (_req, ctx) => {
            const r = {};
            const attempt = async (name, fn) => { try { r[name] = await fn(); } catch (e) { r[name] = "error: " + e.message; } };
            await attempt("public", () => ctx.db.query("SELECT * FROM public.users"));
            await attempt("multi", () => ctx.db.query("SELECT 1; DELETE FROM items"));
            await attempt("own", () => ctx.db.query("SELECT count(*)::int AS n FROM items"));
            await attempt("http", () => ctx.http.fetch("https://example.com"));
            await attempt("perm", () => ctx.permissions.can("view"));
            await attempt("corePerm", () => ctx.permissions.can("acp.access"));
            await attempt("topic", () => ctx.api.topics.get(999999));
            await attempt("stats", () => ctx.api.stats());
            await attempt("cache", async () => { await ctx.cache.set("k", { a: 1 }, 60); return ctx.cache.get("k"); });
            await attempt("job", () => ctx.jobs.enqueue("nope"));
            r.viewer = ctx.viewer;
            r.setting = ctx.settings.get("mode");
            r.text = ctx.t("hello", { name: "Ana" });
            return { body: r };
          },
        },
      };`;
    const manifest = {
      key: "acme.ctx",
      capabilities: ["api", "db", "permissions", "settings"],
      permissions: [{ key: "view", scope: "group", label: "V", default: { member: true } }],
      settings: { tabs: [{ key: "g", label: "G", fields: [{ type: "select", key: "mode", label: "M", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "b" }] }] },
      routes: { api: [{ path: "/ctx", methods: ["GET"] }] },
    };
    const key = await installTestPlugin(
      services,
      root,
      pluginFiles(manifest, server, {
        "migrations/001_items.sql": "CREATE TABLE items (id serial PRIMARY KEY);",
        "lang/ro.json": JSON.stringify({ hello: "Salut, {name}!" }),
      }),
    );
    const asMember = (await api(key, "/ctx", member)).body as Record<string, unknown>;
    expect(asMember).toMatchObject({
      public: "error: sql_schema",
      multi: "error: sql_multiple",
      own: [{ n: 0 }],
      http: "error: capability_required: http-out",
      perm: true,
      corePerm: false,
      topic: null,
      stats: { topics: 0, posts: 0 },
      cache: { a: 1 },
      job: "error: capability_required: jobs",
      viewer: { userId: member.userId, isGuest: false },
      setting: "b",
      text: "Salut, Ana!",
    });
    expect(((await api(key, "/ctx", guest)).body as Record<string, unknown>).perm).toBe(false);
    expect((await api(key, "/nope", guest)).status).toBe(404);
    expect((await services.plugins.handleApi(key, { method: "POST", path: "/ctx", query: {}, body: null, actor: guest, locale: "ro" })).status).toBe(405);
  });
});

describe("șabloanele pluginului", () => {
  test("`{ template, data }` trece prin motorul de șabloane (escapare implicită) și apoi prin sanitizer", async () => {
    const server = `export default { widgets: { tpl: () => ({ template: '<p class="gcsp-x">Salut, {{ who }}!</p><script>alert(1)</script>', data: { who: "<b>Ana</b>" } }) } };`;
    await installTestPlugin(services, root, pluginFiles({ key: "acme.probe", capabilities: ["widgets"], widgets: [{ key: "tpl", label: "Tpl" }] }, server));
    const out = await services.plugins.renderWidget("plugin.acme.probe.tpl", { config: {}, actor: guest, locale: "ro", page: "index", zone: "sidebar" });
    expect(out?.html).toBe('<div class="gcsp gcsp--acme--probe" data-gcs-plugin="acme.probe"><p class="gcsp-x">Salut, &lt;b&gt;Ana&lt;/b&gt;!</p></div>');
  });
});

describe("utilitare", () => {
  test("rutele pluginului: fixe înaintea celor cu parametri", () => {
    expect(matchPluginRoute(["/", "/item/:id", "/item/new"], "/item/new")).toEqual({ pattern: "/item/new", params: {} });
    expect(matchPluginRoute(["/", "/item/:id"], "/item/42")).toEqual({ pattern: "/item/:id", params: { id: "42" } });
    expect(matchPluginRoute(["/", "/item/:id"], "")).toEqual({ pattern: "/", params: {} });
    expect(matchPluginRoute(["/item/:id"], "/item/a%2Fb")).toBeNull();
    expect(matchPluginRoute(["/item/:id"], "/item/1/2")).toBeNull();
  });

  test("redirecționările pluginului rămân în spațiul lui (și cu segmente codate)", () => {
    for (const ok of ["/p/acme.x", "/p/acme.x/", "/p/acme.x/item/1?next=%2Fp%2Facme.x", "/p/acme.x?tab=2"]) expect([ok, isPluginRedirect(ok, "/p/acme.x")]).toEqual([ok, true]);
    for (const bad of [
      "/p/acme.xy",
      "/admin",
      "/p/acme.x/../../admin",
      "/p/acme.x/%2e%2e/%2e%2e/admin",
      "/p/acme.x/%2E%2E/admin",
      "/p/acme.x/.%2e/admin",
      "/p/acme.x/%2e./admin",
      "/p/acme.x/a%2f..%2f..%2fadmin",
      "/p/acme.x/%5c..%5cadmin",
      "/p/acme.x/\..\admin",
    ]) {
      expect([bad, isPluginRedirect(bad, "/p/acme.x")]).toEqual([bad, false]);
    }
  });

  test("payload-ul evenimentelor: listele de obiecte simple devin liste pe câmp (post.approved)", () => {
    expect(plainPayload({ posts: [{ postId: 8, authorId: "u1" }, { postId: 9, authorId: null }] })).toEqual({ postIds: [8, 9], authorIds: ["u1", null] });
    expect(plainPayload({ postId: 7, nested: { secret: 1 }, items: [{ deep: { x: 1 } }], tags: ["a"] })).toEqual({ postId: 7, tags: ["a"] });
  });

  test("adresele blocate pentru http-out", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "100.64.0.1", "nu-e-ip"]) {
      expect([a, isBlockedAddress(a)]).toEqual([a, true]);
    }
    for (const a of ["93.184.216.34", "2606:4700::1111", "::ffff:8.8.8.8"]) expect([a, isBlockedAddress(a)]).toEqual([a, false]);
  });
});
