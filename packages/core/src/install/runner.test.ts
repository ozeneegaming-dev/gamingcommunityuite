import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@gcs/db";
import { withDatabase } from "@gcs/db/test/url";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, inject, test } from "vitest";
import { testRegistry } from "../../test/fixtures";
import { testRedis } from "../../test/redis";
import { hashPassword } from "../auth/passwords";
import { GcsCache } from "../cache";
import { GcsEventBus } from "../events";
import { runInstall, testDatabase, type GcsInstallInput } from "./runner";
import { GcsInstallState } from "./state";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../db/prisma/migrations");
const DB = `redline_install_${process.env.VITEST_POOL_ID ?? "1"}`;
const redis = testRedis();
const cache = new GcsCache(redis);
const bus = new GcsEventBus({ cache });
let dir: string;
let url: string;
let passwordHash: string;

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject("pgBaseUrl") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const pgTarget = () => {
  const u = new URL(inject("pgBaseUrl"));
  return { host: u.hostname, port: Number(u.port), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
};

/** Registry-ul de test plus setările scrise de instalare (în producție vin din modulul core). */
function registry() {
  const r = testRegistry();
  const setting = (key: string, type: "string" | "number" | "secret", def: unknown, section: string) => ({ key, type, default: def, section, labelKey: key });
  r.register({
    key: "install-settings",
    permissions: [],
    acpMenu: [],
    eventListeners: [],
    settings: [
      setting("site.name", "string", "RED-LINE", "general"),
      setting("site.url", "string", "", "general"),
      setting("site.locale", "string", "ro", "general"),
      setting("site.timezone", "string", "Europe/Bucharest", "general"),
      setting("email.smtp_host", "string", "", "email"),
      setting("email.smtp_port", "number", 587, "email"),
      setting("email.smtp_user", "string", "", "email"),
      setting("email.smtp_pass", "secret", "", "email"),
      setting("email.from", "string", "", "email"),
    ],
  });
  return r;
}

function input(overrides: Partial<GcsInstallInput> = {}): GcsInstallInput {
  return {
    site: { name: "Comunitatea Test", url: "https://forum.example.com", locale: "ro", timezone: "Europe/Bucharest" },
    admin: { name: "Fondator", email: "Fondator@Example.com", passwordHash },
    data: "demo",
    ...overrides,
  };
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "gcs-run-"));
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${DB}"`);
  });
  url = withDatabase(inject("pgBaseUrl"), DB);
  passwordHash ??= await hashPassword("parola-sigura-123");
  await redis.flushdb();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await admin((c) => c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`));
  redis.disconnect();
});

async function inspect() {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const groups = await db.group.count();
    const admins = await db.user.findMany({ where: { email: "fondator@example.com" }, include: { primaryGroup: true, accounts: true } });
    const siteName = await db.setting.findUnique({ where: { key: "site.name" } });
    return { groups, admins, siteName: siteName?.value };
  } finally {
    await db.$disconnect();
  }
}

describe("runInstall", () => {
  test("pe o bază goală: 12 grupuri, adminul în root_admin, setările scrise, instalarea marcată", async () => {
    const state = new GcsInstallState(dir);
    const events: { stepKey: string; pct: number }[] = [];
    await runInstall(input(), (e) => events.push(e), { databaseUrl: url, migrationsDir, registry: registry(), cache, bus, state });

    const result = await inspect();
    expect(result.groups).toBe(12);
    expect(result.admins).toHaveLength(1);
    expect(result.admins[0]?.primaryGroup.key).toBe("root_admin");
    expect(result.admins[0]?.accounts[0]).toMatchObject({ providerId: "credential", password: passwordHash });
    expect(result.siteName).toBe("Comunitatea Test");
    await expect(state.isInstalled()).resolves.toBe(true);
    expect(events.map((e) => e.stepKey)).toEqual(["migrate", "seed", "settings", "admin", "demo", "name_styles", "search_indexes", "lock"]);
    expect(events.at(-1)?.pct).toBe(100);
  });

  test("pasul „demo” apelează `seedDemo` al modulelor cu varianta aleasă și emailul adminului", async () => {
    const state = new GcsInstallState(dir);
    const calls: { variant: string; adminEmail: string; admins: number }[] = [];
    const r = registry();
    r.register({
      key: "demo-test",
      settings: [],
      permissions: [],
      acpMenu: [],
      eventListeners: [],
      seedDemo: async (ctx) => {
        calls.push({ variant: ctx.variant, adminEmail: ctx.adminEmail, admins: await ctx.db.user.count() });
      },
    });
    await runInstall(input(), () => {}, { databaseUrl: url, migrationsDir, registry: r, cache, bus, state });
    // „import” (etapa 6) pornește deocamdată ca un site gol.
    await runInstall(input({ data: "import" }), () => {}, { databaseUrl: url, migrationsDir, registry: r, cache, bus, state });
    expect(calls).toEqual([
      { variant: "demo", adminEmail: "fondator@example.com", admins: 1 },
      { variant: "empty", adminEmail: "fondator@example.com", admins: 1 },
    ]);
  });

  test("un runner care eșuează la name_styles, rulat din nou → reușește, fără un al doilea admin", async () => {
    const state = new GcsInstallState(dir);
    const deps = { databaseUrl: url, migrationsDir, registry: registry(), cache, bus, state };
    await expect(
      runInstall(input(), () => {}, {
        ...deps,
        beforeStep: (step) => {
          if (step === "name_styles") throw new Error("eșec simulat");
        },
      }),
    ).rejects.toThrow("eșec simulat");
    await expect(state.isInstalled()).resolves.toBe(false);

    await runInstall(input(), () => {}, deps);
    const result = await inspect();
    expect(result.admins).toHaveLength(1);
    expect(result.groups).toBe(12);
    await expect(state.isInstalled()).resolves.toBe(true);
  });
});

// Creează o bază nouă (CREATE DATABASE copiază șablonul); sub încărcarea `pnpm test` depășește 30 s.
describe("testDatabase", { timeout: 120_000 }, () => {
  test("baza existentă → ok fără creare; o bază nouă e creată și primește extensiile", async () => {
    await expect(testDatabase({ ...pgTarget(), database: DB })).resolves.toEqual({ ok: true, created: false });
    const fresh = `${DB}_nou`;
    await admin((c) => c.query(`DROP DATABASE IF EXISTS "${fresh}" WITH (FORCE)`));
    await expect(testDatabase({ ...pgTarget(), database: fresh })).resolves.toEqual({ ok: true, created: true });
    await admin((c) => c.query(`DROP DATABASE IF EXISTS "${fresh}" WITH (FORCE)`));
  });

  test("un user fără CREATEDB, pe o bază inexistentă → db_no_create_privilege", async () => {
    await admin(async (c) => {
      await c.query(`DROP ROLE IF EXISTS gcs_limited`);
      await c.query(`CREATE ROLE gcs_limited LOGIN PASSWORD 'limitat' NOCREATEDB`);
    });
    const result = await testDatabase({ ...pgTarget(), user: "gcs_limited", password: "limitat", database: `${DB}_interzis` });
    expect(result).toEqual({ ok: false, errorKey: "db_no_create_privilege" });
  });

  test("parolă greșită → db_auth; port închis → db_unreachable", async () => {
    await expect(testDatabase({ ...pgTarget(), password: "gresita", database: DB })).resolves.toEqual({ ok: false, errorKey: "db_auth" });
    await expect(testDatabase({ ...pgTarget(), port: 1, database: DB })).resolves.toEqual({ ok: false, errorKey: "db_unreachable" });
  });
});
