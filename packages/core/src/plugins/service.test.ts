import { generateSigningKey } from "@gcs/plugin-sdk/pack";
import { testDbUrl } from "@gcs/db/test/helpers";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testManifest, testPluginZip } from "../../test/pluginFixtures";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { GcsPluginDatabase } from "./database";
import { GcsPluginService, PLUGIN_JOB, PLUGINS_ACP_SECTION, HOOKS_ACP_SECTION } from "./service";
import { trustedPluginKeys } from "./signature";

const market = generateSigningKey();
const sign = { keyId: "market", privateKey: market.privateKeyPem };
const database = new GcsPluginDatabase({ databaseUrl: testDbUrl() });
const KEYS = ["acme.demo", "acme.db"];

let w: GcsTestWorld;
let service: GcsPluginService;
let root: GcsActor;
let admin: GcsActor;
let notified = 0;
let schedulers: Map<string, { everyMs: number; data: unknown }>;

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof GcsError) return { code: e.code, params: e.params, fields: (e as { fields?: unknown }).fields };
    throw e;
  }
  return null;
};

const dbManifest = (over: Record<string, unknown> = {}) =>
  testManifest({
    key: "acme.db",
    capabilities: ["widgets", "db", "settings"],
    settings: {
      tabs: [
        {
          key: "general",
          label: "General",
          fields: [
            { type: "text", key: "greeting", label: "Salut", default: "Bună" },
            { type: "number", key: "limit", label: "Limită", default: 5, min: 1, max: 50, unlimited: true },
            { type: "secret", key: "token", label: "Token" },
          ],
        },
      ],
    },
    ...over,
  });
const MIGRATION_1 = { "migrations/001_init.sql": "CREATE TABLE items (id serial PRIMARY KEY, name text NOT NULL);" };

beforeEach(async () => {
  for (const key of KEYS) await database.drop(key, database.roleName(key)).catch(() => {});
  w = await createWorld([
    {
      key: "plugins-test",
      settings: [],
      permissions: [],
      eventListeners: [],
      acpMenu: [
        {
          app: "system",
          title: "s",
          items: [
            { key: "a", labelKey: "a", href: "/admin/system/applications", section: PLUGINS_ACP_SECTION },
            { key: "h", labelKey: "h", href: "/admin/system/hooks", section: HOOKS_ACP_SECTION },
          ],
        },
      ],
    },
  ]);
  notified = 0;
  schedulers = new Map();
  service = new GcsPluginService({
    db: w.db,
    acp: w.acp,
    database,
    jobs: {
      upsertScheduler: async (id, everyMs, job) => void schedulers.set(id, { everyMs, data: job.data }),
      removeScheduler: async (id) => void schedulers.delete(id),
      schedulerIds: async (prefix) => [...schedulers.keys()].filter((k) => k.startsWith(prefix)),
    },
    notify: async () => void notified++,
    trustedKeys: () => trustedPluginKeys(`market=${market.publicKeyBase64}`).keys,
    unsignedPolicy: () => "allow",
    platformVersion: "0.6.0",
  });
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
  await w.grantAdmin([PLUGINS_ACP_SECTION, HOOKS_ACP_SECTION]);
  admin = await w.actorFor(await w.createUser("Admin", "admin"));
});

afterAll(async () => {
  for (const key of KEYS) await database.drop(key, database.roleName(key)).catch(() => {});
  await database.close();
});

describe("ciclul de viață al pluginurilor", () => {
  test("un pachet semnat: un admin cu drept îl instalează, activ, cu jurnal ACP", async () => {
    const { id, report } = await service.stage(admin, { fileName: "demo.zip", data: testPluginZip({ sign }) });
    expect(report).toMatchObject({ ok: true, mode: "install", signature: { status: "signed" } });
    expect(await service.install(admin, id)).toEqual({ key: "acme.demo", mode: "install" });
    expect(await service.get("acme.demo")).toMatchObject({ enabled: true, signed: true, version: "1.0.0", capabilities: ["widgets"] });
    expect(await w.db.pluginUpload.count()).toBe(0);
    expect(await w.db.auditLog.findFirst({ where: { action: "plugin.install" } })).toMatchObject({ targetId: "acme.demo", actorId: admin.userId });
    expect(notified).toBe(1);
    const member = await w.actorFor(await w.createUser("Membru", "member"));
    expect(await errorOf(service.stage(member, { fileName: "x.zip", data: testPluginZip({ sign }) }))).toMatchObject({ code: "forbidden" });
  });

  test("un pachet nesemnat cere Root Admin, codul 2FA și cheia tastată", async () => {
    const stage = async () => (await service.stage(admin, { fileName: "demo.zip", data: testPluginZip() })).id;
    expect(await errorOf(service.install(admin, await stage(), { twoFactorVerified: true, typedKey: "acme.demo" }))).toMatchObject({ code: "forbidden", params: { reason: "unsigned_requires_root" } });
    const id = await stage();
    expect(await errorOf(service.install(root, id, { typedKey: "acme.demo" }))).toMatchObject({ fields: { code: "invalid_code" } });
    expect(await errorOf(service.install(root, id, { twoFactorVerified: true, typedKey: "acme.dem" }))).toMatchObject({ fields: { confirmKey: "mismatch" } });
    expect(await service.install(root, id, { twoFactorVerified: true, typedKey: " acme.demo " })).toEqual({ key: "acme.demo", mode: "install" });
    expect(await service.get("acme.demo")).toMatchObject({ signed: false, enabled: true });
  });

  test("un pachet invalid nu se instalează, chiar dacă a fost încărcat", async () => {
    const { id, report } = await service.stage(admin, { fileName: "bad.zip", data: testPluginZip({ manifest: testManifest({ minGcs: "9.0.0" }), sign }) });
    expect(report.ok).toBe(false);
    expect(await errorOf(service.install(admin, id))).toMatchObject({ code: "validation" });
  });

  test("baza de date proprie: rolul dedicat nu vede tabelele nucleului", async () => {
    const { id } = await service.stage(admin, { fileName: "db.zip", data: testPluginZip({ manifest: dbManifest(), files: MIGRATION_1, sign }) });
    await service.install(admin, id);
    const row = await service.get("acme.db");
    expect(row).toMatchObject({ migrations: ["001_init.sql"], dbRole: database.roleName("acme.db") });
    const creds = (await service.credentials("acme.db"))!;
    await database.query("acme.db", creds, "INSERT INTO items (name) VALUES ($1)", ["unu"]);
    expect((await database.query("acme.db", creds, "SELECT name FROM items")).rows).toEqual([{ name: "unu" }]);
    expect(await database.batch("acme.db", creds, [{ sql: "INSERT INTO items (name) VALUES ($1)", params: ["doi"] }, { sql: "DELETE FROM items WHERE name = $1", params: ["unu"] }])).toEqual([1, 1]);

    // SQL guard: alte scheme refuzate înainte de a ajunge la server.
    expect(await errorOf(database.query("acme.db", creds, "SELECT * FROM public.users"))).toMatchObject({ fields: { sql: "sql_schema" } });

    // Granița reală: chiar și ocolind verificarea statică, rolul pluginului nu are drepturi pe tabelele nucleului.
    const url = new URL(testDbUrl());
    const direct = new pg.Client({ host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: creds.role, password: creds.password });
    await direct.connect();
    try {
      await expect(direct.query("SELECT * FROM public.users")).rejects.toThrow(/permission denied/);
      await expect(direct.query("RESET ROLE; SELECT * FROM public.users")).rejects.toThrow(/permission denied/);
      await expect(direct.query("CREATE TABLE public.evil (id int)")).rejects.toThrow(/permission denied/);
      await expect(direct.query("CREATE ROLE evil")).rejects.toThrow(/permission denied/);
      // Alt plugin: schema lui aparține rolului lui, deci nici ea nu e accesibilă.
      await service.install(admin, (await service.stage(admin, { fileName: "demo.zip", data: testPluginZip({ manifest: testManifest({ capabilities: ["widgets", "db"] }), files: MIGRATION_1, sign }) })).id);
      await expect(direct.query("SELECT * FROM plugin_acme__demo.items")).rejects.toThrow(/permission denied/);
      expect((await direct.query("SELECT count(*)::int AS n FROM items")).rows[0]).toEqual({ n: 1 });
    } finally {
      await direct.end();
    }
  });

  test("actualizarea: versiune mai mare, migrațiile noi, setările păstrate și completate", async () => {
    await service.install(admin, (await service.stage(admin, { fileName: "v1.zip", data: testPluginZip({ manifest: dbManifest(), files: MIGRATION_1, sign }) })).id);
    await service.saveSettings(admin, "acme.db", { greeting: "Salutare", token: "secret-1" });

    const v2 = dbManifest({
      version: "1.1.0",
      settings: { tabs: [{ key: "general", label: "General", fields: [{ type: "text", key: "greeting", label: "Salut", default: "Bună" }, { type: "toggle", key: "loud", label: "Tare", default: true }, { type: "secret", key: "token", label: "Token" }] }] },
    });
    const staged = await service.stage(admin, { fileName: "v2.zip", data: testPluginZip({ manifest: v2, files: { ...MIGRATION_1, "migrations/002_note.sql": "ALTER TABLE items ADD COLUMN note text;" }, sign }) });
    expect(staged.report).toMatchObject({ ok: true, mode: "update", previous: { version: "1.0.0" } });
    expect(await service.install(admin, staged.id)).toEqual({ key: "acme.db", mode: "update" });
    const row = (await service.get("acme.db"))!;
    expect(row).toMatchObject({ version: "1.1.0", migrations: ["001_init.sql", "002_note.sql"], enabled: true });
    expect(row.settings).toEqual({ greeting: "Salutare", loud: true, token: "secret-1" });
    const creds = (await service.credentials("acme.db"))!;
    expect(await database.query("acme.db", creds, "INSERT INTO items (name, note) VALUES ('x', 'y')")).toMatchObject({ rowCount: 1 });

    // Aceeași versiune din nou: respinsă.
    const again = await service.stage(admin, { fileName: "v2.zip", data: testPluginZip({ manifest: v2, files: MIGRATION_1, sign }) });
    expect(again.report.checks).toContainEqual({ code: "version_not_newer", level: "error", params: { installed: "1.1.0", version: "1.1.0" } });
  });

  test("o migrație care eșuează nu lasă nimic în urmă", async () => {
    const files = { ...MIGRATION_1, "migrations/002_bad.sql": "CREATE TABLE items (id int);" };
    const { id } = await service.stage(admin, { fileName: "db.zip", data: testPluginZip({ manifest: dbManifest(), files, sign }) });
    expect(await errorOf(service.install(admin, id))).toMatchObject({ fields: { migration: "migration_failed" }, params: { name: "002_bad.sql" } });
    expect(await service.get("acme.db")).toBeNull();
  });

  test("setările: validare pe câmpuri, secretul gol păstrează valoarea, jurnalul ascunde secretele", async () => {
    await service.install(admin, (await service.stage(admin, { fileName: "db.zip", data: testPluginZip({ manifest: dbManifest(), files: MIGRATION_1, sign }) })).id);
    expect(await errorOf(service.saveSettings(admin, "acme.db", { greeting: 5, limit: 99 }))).toMatchObject({ fields: { greeting: "invalid_type", limit: "invalid_range" } });
    await service.saveSettings(admin, "acme.db", { limit: 0, token: "s3cret" });
    await service.saveSettings(admin, "acme.db", { token: "" });
    expect((await service.get("acme.db"))!.settings).toEqual({ greeting: "Bună", limit: 0, token: "s3cret" });
    const audit = await w.db.auditLog.findFirst({ where: { action: "plugin.settings" }, orderBy: { createdAt: "asc" } });
    expect(audit?.after).toEqual({ limit: 0, token: "[ascuns]" });
  });

  test("activare, dezactivare, joburile periodice și dezactivarea automată", async () => {
    const manifest = testManifest({ capabilities: ["widgets", "jobs"], jobs: [{ key: "cleanup", everyMinutes: 60 }, { key: "manual" }] });
    await service.install(admin, (await service.stage(admin, { fileName: "d.zip", data: testPluginZip({ manifest, sign }) })).id);
    expect([...schedulers]).toEqual([["plugin-acme.demo-cleanup", { everyMs: 3_600_000, data: { plugin: "acme.demo", job: "cleanup" } }]]);
    expect(PLUGIN_JOB).toBe("plugin.job");

    await service.setEnabled(admin, "acme.demo", false);
    expect(schedulers.size).toBe(0);
    expect(await service.get("acme.demo")).toMatchObject({ enabled: false, disabledReason: "admin" });
    await service.setEnabled(admin, "acme.demo", true);
    expect(schedulers.size).toBe(1);

    expect(await service.autoDisable("acme.demo", 5, "Error: boom")).toBe(true);
    expect(await service.autoDisable("acme.demo", 5, "Error: boom")).toBe(false);
    expect(await service.get("acme.demo")).toMatchObject({ enabled: false, disabledReason: "auto", consecutiveFailures: 5, lastError: "Error: boom" });
    expect(await w.db.auditLog.findFirst({ where: { action: "plugin.auto_disable" } })).toMatchObject({ actorId: null, targetId: "acme.demo" });
    expect((await service.logs("acme.demo"))[0]).toMatchObject({ level: "error" });
    expect(schedulers.size).toBe(0);

    await service.setEnabled(admin, "acme.demo", true);
    expect(await service.disableAll(admin)).toEqual(["acme.demo"]);
    expect(await service.get("acme.demo")).toMatchObject({ enabled: false, disabledReason: "admin" });
  });

  test("hook-urile: comutator și prioritate, doar pentru hook-urile pluginului", async () => {
    const manifest = testManifest({ capabilities: ["widgets", "events"], events: ["post.created"] });
    await service.install(admin, (await service.stage(admin, { fileName: "d.zip", data: testPluginZip({ manifest, sign }) })).id);
    await service.setHook(admin, "acme.demo", "post.created", { enabled: false, priority: 3 });
    expect(await service.hookSettings()).toEqual([{ pluginKey: "acme.demo", hook: "post.created", enabled: false, priority: 3 }]);
    expect(await errorOf(service.setHook(admin, "acme.demo", "user.registered", { enabled: true, priority: null }))).toMatchObject({ fields: { hook: "unknown" } });
    expect(await errorOf(service.setHook(admin, "acme.demo", "post.created", { enabled: true, priority: 500 }))).toMatchObject({ fields: { priority: "invalid_range" } });
  });

  test("dezinstalarea cu păstrarea datelor, reinstalarea, apoi ștergerea completă", async () => {
    await service.install(admin, (await service.stage(admin, { fileName: "db.zip", data: testPluginZip({ manifest: dbManifest(), files: MIGRATION_1, sign }) })).id);
    const creds = (await service.credentials("acme.db"))!;
    await database.query("acme.db", creds, "INSERT INTO items (name) VALUES ('păstrat')");
    await w.db.groupSetting.create({ data: { groupId: w.groups.member!, key: "plugin.acme.db.view", value: true } });

    await service.uninstall(admin, "acme.db", { keepData: true });
    expect(await service.get("acme.db")).toMatchObject({ status: "removed_kept_data", enabled: false, packageSha256: null });
    const re = await service.stage(admin, { fileName: "db.zip", data: testPluginZip({ manifest: dbManifest(), files: MIGRATION_1, sign }) });
    expect(re.report.mode).toBe("reinstall");
    await service.install(admin, re.id);
    const again = (await service.credentials("acme.db"))!;
    expect((await database.query("acme.db", again, "SELECT name FROM items")).rows).toEqual([{ name: "păstrat" }]);

    await service.uninstall(admin, "acme.db", { keepData: false });
    expect(await service.get("acme.db")).toBeNull();
    expect(await w.db.groupSetting.count({ where: { key: { startsWith: "plugin.acme.db." } } })).toBe(0);
    const schemas = await w.db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'plugin_acme__db'`;
    const roles = await w.db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${again.role}`;
    expect([schemas[0]!.n, roles[0]!.n]).toEqual([0, 0]);
  });
});
