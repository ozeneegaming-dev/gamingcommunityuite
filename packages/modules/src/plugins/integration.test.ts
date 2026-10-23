import { buildExamplePlugin } from "@gcs/plugin-sdk/example";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { GcsPluginDatabase, type GcsActor } from "@gcs/core";
import { closePluginServices, createPluginServices, resetPluginWorld } from "../../test/pluginWorld";
import type { GcsServices } from "../services";

const KEY = "gcs.hello";
const WIDGET = "plugin.gcs.hello.greeting";

let services: GcsServices;
let configDir: string;
let root: GcsActor;
let member: GcsActor;
let guest: GcsActor;

beforeAll(async () => {
  ({ services, configDir } = await createPluginServices());
  ({ root, member, guest } = await resetPluginWorld(services, [KEY]));
});

afterAll(async () => {
  await closePluginServices(services, configDir, [KEY]);
});

async function upload(zip: Buffer) {
  const { id, report } = await services.pluginAdmin.stage(root, { fileName: "gcs.hello.zip", data: zip });
  expect(report.checks.filter((c) => c.level === "error")).toEqual([]);
  return { id, report };
}

const widget = (actor: GcsActor) => services.plugins.renderWidget(WIDGET, { config: {}, actor, locale: "ro", page: "index", zone: "sidebar" });
const page = (actor: GcsActor) => services.plugins.renderPage(KEY, "/", { actor, locale: "ro", query: {}, area: "site" });

describe("pluginul de exemplu, de la zip la dezinstalare, fără repornire", () => {
  test("instalarea (nesemnat, Root Admin cu 2FA și cheia tastată) îl încarcă imediat", async () => {
    const { id, report } = await upload(await buildExamplePlugin());
    expect(report).toMatchObject({ mode: "install", signature: { status: "unsigned" }, migrations: ["001_init.sql"] });
    expect(await services.pluginAdmin.install(root, id, { twoFactorVerified: true, typedKey: KEY })).toEqual({ key: KEY, mode: "install" });

    expect(services.plugins.loadedKeys()).toEqual([KEY]);
    expect(services.registry.widgetDef(WIDGET)?.def).toMatchObject({ icon: "fa-solid fa-hand", labelKey: "pluginText.gcs.hello.widget.title" });
    expect(services.registry.permissionDef("plugin.gcs.hello.view")).toMatchObject({ scope: "group", labelKey: "pluginText.gcs.hello.permissions.view" });
    expect(services.registry.acpMenu().flatMap((s) => s.items).find((i) => i.section === "plugin.gcs.hello")).toMatchObject({ href: "/admin/plugins/gcs.hello" });
    // Navigația ACP: paginile pluginului sunt în zona Aplicații, sub numele lui.
    expect(services.registry.acpMenu().find((s) => s.items.some((i) => i.section === "plugin.gcs.hello"))).toMatchObject({ area: "apps" });
    const messages = services.plugins.messages("ro") as { gcs: { hello: Record<string, unknown> } };
    expect(messages.gcs.hello).toMatchObject({ _name: "Hello", widget: { title: "Hello" } });
  });

  test("widget-ul, pagina, ACP-ul, API-ul, meniul și punctul de extensie", async () => {
    const w = await widget(guest);
    expect(w?.html).toContain("Salut din pluginul Hello!");
    expect(w?.html).toContain("Postări noi văzute: 0");
    expect(w?.html).toMatch(/^<div class="gcsp gcsp--gcs--hello" data-gcs-plugin="gcs.hello">/);
    expect(w?.html).toContain('<svg class="gcs-icon"');
    expect(w?.styles).toEqual([expect.stringMatching(/^\/plugins\/gcs\.hello\/assets\/hello\.css\?v=/)]);

    // Permisiunea `view`: membrii da (implicit), vizitatorii nu.
    expect(await page(member)).toMatchObject({ status: 200, title: "Hello" });
    expect(await page(guest)).toEqual({ status: 403 });
    expect((await services.plugins.menus("user", member, "ro")).map((m) => m.label)).toEqual(["Hello"]);
    expect(await services.plugins.menus("user", guest, "ro")).toEqual([]);

    const acp = await services.plugins.renderPage(KEY, "/", { actor: root, locale: "en", query: {}, area: "acp" });
    expect(acp).toMatchObject({ status: 200, title: "Hello" });
    expect(acp.status === 200 && acp.html).toContain("Posts seen");

    const hook = await services.plugins.renderHook("postbit.after_fields", { postId: 1, authorId: member.userId }, { actor: guest, locale: "ro" });
    expect(hook).toEqual([{ key: KEY, html: expect.stringContaining("Salutat de Hello") }]);

    const css = await services.plugins.asset(KEY, "assets/hello.css");
    expect(css?.contentType).toBe("text/css; charset=utf-8");
    expect(String(css?.body)).toMatch(/^\.gcsp--gcs--hello \{\n/);
    expect(await services.plugins.asset(KEY, "plugin.json")).toBeNull();
    expect(await services.plugins.asset(KEY, "assets/../plugin.json")).toBeNull();
  });

  test("Forum v2: tabul „Hello” din formularul forumului și sloturile rândului (eticheta, culoarea, salutul)", async () => {
    const category = await services.forums.create({ parentId: null, type: "CATEGORY", name: "Hello" }, root);
    const forum = await services.forums.create({ parentId: category.id, type: "FORUM", name: "Salutări" }, root);
    const ext = "plugin.gcs.hello";
    const opts = { plugins: true };
    const tab = (await services.forumSlots.editTabs(forum, opts)).find((t) => t.extension === ext);
    expect(tab).toMatchObject({ plugin: KEY, tab: { key: "look", labelKey: "pluginText.gcs.hello.forum.tab" }, values: { label: "", wave: false } });
    // Categoriile nu primesc tabul (tipurile din manifest).
    expect((await services.forumSlots.editTabs(category, opts)).some((t) => t.extension === ext)).toBe(false);

    await services.forumSlots.saveTab(root, { forumId: forum.id, extension: ext, tab: "look", values: { label: "Salut", titleColor: "#ff6a3d", wave: "on" } }, opts);
    const ref = { id: forum.id, type: forum.type, parentId: category.id, name: forum.name, slug: forum.slug };
    const row = (await services.forumSlots.list(guest, "ro", "index", [ref], opts)).get(forum.id)!;
    expect(row.title).toEqual([{ kind: "chip", label: "Salut", icon: "fa-solid fa-hand", tone: "accent", id: "label" }]);
    expect(row.meta).toEqual([expect.objectContaining({ kind: "html", plugin: KEY, html: expect.stringContaining("gcsp-hello__wave") })]);
    expect(row.style.vars).toMatchObject({ "--gcs-forum-title-color": "#FF6A3D", "--gcsp-hello-wave": "1" });
    // Rândul stilizat de plugin devine containerul CSS-ului lui (`gcsp--gcs--hello`), iar pagina îi adaugă foaia de stil.
    expect(row.style.classes).toEqual(expect.arrayContaining(["gcsp-hello-row", "gcsp--gcs--hello"]));
    expect(row.plugins).toEqual([KEY]);
    expect(services.plugins.pluginStyles(KEY)).toEqual([expect.stringMatching(/^\/plugins\/gcs\.hello\/assets\/hello\.css\?v=/)]);
    // Modul sigur: pluginurile nu contribuie nimic.
    expect((await services.forumSlots.list(guest, "ro", "index", [ref], { plugins: false })).get(forum.id)).toBeUndefined();
  });

  test("listenerul post.created scrie în tabelul propriu; API-ul îl citește", async () => {
    await services.bus.emit({ name: "post.created", payload: { postId: 41, topicId: 9, forumId: 2, pending: false, authorId: member.userId }, tags: [] });
    await services.plugins.idle();
    expect(await services.plugins.handleApi(KEY, { method: "GET", path: "/stats", query: {}, body: null, actor: guest, locale: "ro" })).toEqual({
      status: 200,
      body: { posts: 1, greeting: "Salut din pluginul Hello!" },
    });
    expect((await widget(guest))?.html).toContain("Postări noi văzute: 1");
    expect((await page(member)).status === 200 && ((await page(member)) as { html: string }).html).toContain("/topic/9/post/41");
  });

  test("setările din ACP ajung imediat în plugin", async () => {
    await services.pluginAdmin.saveSettings(root, KEY, { greeting: "Bun venit!", showCount: false });
    const html = (await widget(guest))?.html ?? "";
    expect(html).toContain("Bun venit!");
    expect(html).not.toContain("Postări noi văzute");
  });

  test("jobul periodic rulează în plugin", async () => {
    await services.plugins.runJob({ plugin: KEY, job: "cleanup" });
    await services.plugins.idle();
    expect((await services.pluginAdmin.logs(KEY)).map((l) => l.message)).toContain("cleanup: 0 rows removed");
  });

  test("dezactivat: dispare din registry și din pagini; reactivat: revine", async () => {
    await services.pluginAdmin.setEnabled(root, KEY, false);
    expect(services.plugins.loadedKeys()).toEqual([]);
    expect(services.registry.widgetDef(WIDGET)).toBeUndefined();
    expect(services.registry.permissionDef("plugin.gcs.hello.view")).toBeUndefined();
    expect(await widget(guest)).toBeNull();
    expect(await page(member)).toEqual({ status: 404 });

    await services.pluginAdmin.setEnabled(root, KEY, true);
    expect((await widget(guest))?.html).toContain("Bun venit!");
  });

  test("actualizarea la 1.1.0: migrația nouă, datele și setările păstrate", async () => {
    const zip = await buildExamplePlugin({
      version: "1.1.0",
      mutate: (files) => files.set("migrations/002_note.sql", Buffer.from("ALTER TABLE greetings_log ADD COLUMN note text;\n")),
    });
    const { id, report } = await upload(zip);
    expect(report).toMatchObject({ mode: "update", previous: { version: "1.0.0" } });
    await services.pluginAdmin.install(root, id, { twoFactorVerified: true, typedKey: KEY });
    expect(await services.pluginAdmin.get(KEY)).toMatchObject({ version: "1.1.0", migrations: ["001_init.sql", "002_note.sql"], enabled: true });
    expect(services.plugins.loadedKeys()).toEqual([KEY]);
    const stats = await services.plugins.handleApi(KEY, { method: "GET", path: "/stats", query: {}, body: null, actor: guest, locale: "ro" });
    expect(stats.body).toEqual({ posts: 1, greeting: "Bun venit!" });
  });

  test("dezinstalarea completă: schema, rolul și cheile pluginului dispar", async () => {
    const role = (await services.pluginAdmin.credentials(KEY))!.role;
    await services.pluginAdmin.uninstall(root, KEY, { keepData: false });
    expect(await services.pluginAdmin.get(KEY)).toBeNull();
    expect(services.plugins.loadedKeys()).toEqual([]);
    expect(services.registry.widgetDef(WIDGET)).toBeUndefined();
    const [schema] = await services.db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'plugin_gcs__hello'`;
    const [roles] = await services.db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${role}`;
    expect([schema!.n, roles!.n]).toEqual([0, 0]);
    expect(new GcsPluginDatabase({ databaseUrl: process.env.DATABASE_URL }).roleName(KEY)).toBe(role);
  });
});
