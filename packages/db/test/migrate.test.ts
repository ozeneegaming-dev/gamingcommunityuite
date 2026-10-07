import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { migrateDatabase } from "../src/migrate";
import { withDatabase } from "./url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../prisma/migrations");
/** Toate migrațiile din folder, în ordine (numele încep cu data). */
const ALL_MIGRATIONS = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const schemaPath = path.resolve(here, "../prisma/schema.prisma");
const prismaCli = path.resolve(here, "../node_modules/prisma/build/index.js");
const DB = `redline_migrate_${process.env.VITEST_POOL_ID ?? "1"}`;
let url: string;

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject("pgBaseUrl") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${DB}"`);
  });
  url = withDatabase(inject("pgBaseUrl"), DB);
});

afterAll(async () => {
  await admin((c) => c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`));
});

// Fiecare test aplică toate migrațiile; sub încărcarea `pnpm test` (toate pachetele în paralel) durează peste 30 s.
describe("migrateDatabase", { timeout: 120_000 }, () => {
  test("pe o bază goală aplică toate migrațiile; a doua rulare nu mai aplică nimic", async () => {
    const first = await migrateDatabase(url, migrationsDir);
    expect(first.applied).toEqual(ALL_MIGRATIONS);
    const second = await migrateDatabase(url, migrationsDir);
    expect(second.applied).toEqual([]);

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const tables = await client.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    await client.end();
    expect(tables.rows.map((r) => r.tablename)).toEqual(expect.arrayContaining(["users", "groups", "two_factors", "_prisma_migrations"]));
  });

  test("rezultatul e compatibil cu Prisma: `prisma migrate status` vede schema la zi", () => {
    const output = execFileSync(process.execPath, [prismaCli, "migrate", "status", "--schema", schemaPath], {
      // Sub încărcarea `pnpm test` (toate pachetele în paralel), conexiunea poate întârzia peste cele 5 s implicite.
      env: { ...process.env, DATABASE_URL: `${url}${url.includes("?") ? "&" : "?"}connect_timeout=60` },
      encoding: "utf8",
    });
    expect(output).toContain("Database schema is up to date");
  });

  test("actualizarea unui site din etapa 1 (cu indexul trigram creat de installer) aplică migrațiile forumului", async () => {
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${DB}"`);
    });
    // Doar migrațiile etapei 1, apoi ce face pasul „search_indexes” al installer-ului din etapa 1.
    const stage1 = mkdtempSync(path.join(os.tmpdir(), "gcs-stage1-"));
    for (const name of ALL_MIGRATIONS.filter((m) => m < "20261006")) cpSync(path.join(migrationsDir, name), path.join(stage1, name), { recursive: true });
    await migrateDatabase(url, stage1);
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await client.query(`CREATE INDEX IF NOT EXISTS "users_nameNormalized_trgm_idx" ON "users" USING gin ("nameNormalized" gin_trgm_ops)`);
    await client.end();
    rmSync(stage1, { recursive: true, force: true });

    const update = await migrateDatabase(url, migrationsDir);
    expect(update.applied).toEqual(ALL_MIGRATIONS.filter((m) => m >= "20261006"));
  });

  test("actualizarea unui site din etapa 2 (cu useri) aplică migrația etapei 3 și completează valorile implicite", async () => {
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${DB}"`);
    });
    const stage2 = mkdtempSync(path.join(os.tmpdir(), "gcs-stage2-"));
    for (const name of ALL_MIGRATIONS.filter((m) => m < "20261007")) cpSync(path.join(migrationsDir, name), path.join(stage2, name), { recursive: true });
    await migrateDatabase(url, stage2);
    rmSync(stage2, { recursive: true, force: true });
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(`INSERT INTO groups (key, name) VALUES ('member', 'Membru')`);
      await client.query(
        `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ('u1', 'Mara', 'mara', 'mara@example.com', 1, now())`,
      );

      const update = await migrateDatabase(url, migrationsDir);
      expect(update.applied).toEqual(ALL_MIGRATIONS.filter((m) => m >= "20261007"));
      const { rows } = await client.query(`SELECT bio, points, privacy FROM users WHERE id = 'u1'`);
      expect(rows[0]).toEqual({ bio: "", points: 0, privacy: {} });
    } finally {
      await client.end();
    }
  });

  test("actualizarea unui site din etapa 3 aplică migrația etapei 4", async () => {
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${DB}"`);
    });
    const stage3 = mkdtempSync(path.join(os.tmpdir(), "gcs-stage3-"));
    for (const name of ALL_MIGRATIONS.filter((m) => m < "20261008")) cpSync(path.join(migrationsDir, name), path.join(stage3, name), { recursive: true });
    await migrateDatabase(url, stage3);
    rmSync(stage3, { recursive: true, force: true });
    const update = await migrateDatabase(url, migrationsDir);
    expect(update.applied).toEqual(ALL_MIGRATIONS.filter((m) => m >= "20261008"));
  });

  test("actualizarea unui site din etapa 4 aplică migrația etapei 5", async () => {
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${DB}"`);
    });
    const stage4 = mkdtempSync(path.join(os.tmpdir(), "gcs-stage4-"));
    for (const name of ALL_MIGRATIONS.filter((m) => m < "20261009")) cpSync(path.join(migrationsDir, name), path.join(stage4, name), { recursive: true });
    await migrateDatabase(url, stage4);
    rmSync(stage4, { recursive: true, force: true });
    const update = await migrateDatabase(url, migrationsDir);
    expect(update.applied).toEqual(ALL_MIGRATIONS.filter((m) => m >= "20261009"));
  });

  test("actualizarea dă badge-urilor implicite insignele; badge-urile și culorile schimbate de admin rămân", async () => {
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${DB}"`);
    });
    const before = mkdtempSync(path.join(os.tmpdir(), "gcs-badges-"));
    for (const name of ALL_MIGRATIONS.filter((m) => m < "20261022000000")) cpSync(path.join(migrationsDir, name), path.join(before, name), { recursive: true });
    await migrateDatabase(url, before);
    rmSync(before, { recursive: true, force: true });
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO badges (key, name, symbol, color) VALUES
          ('first_post', 'Primul post', '✎', '#5EA2FF'),
          ('posts_100', '100 postări', 'C', '#F4B740'),
          ('member_1y', '1 an membru', '1Y', '#123456'),
          ('mvp', 'MVP', '★', '#FF0000')`,
      );
      const update = await migrateDatabase(url, migrationsDir);
      expect(update.applied).toEqual(ALL_MIGRATIONS.filter((m) => m >= "20261022000000"));
      const { rows } = await client.query(`SELECT key, color, "artShape", "artTier", "artIcon" FROM badges ORDER BY id`);
      expect(rows).toEqual([
        { key: "first_post", color: "#5EA2FF", artShape: "medal", artTier: "bronze", artIcon: "fa-solid fa-pen-nib" },
        { key: "posts_100", color: "#5EA2FF", artShape: "medal", artTier: "silver", artIcon: "fa-solid fa-comments" },
        { key: "member_1y", color: "#123456", artShape: "shield", artTier: "silver", artIcon: "fa-solid fa-cake-candles" },
        { key: "mvp", color: "#FF0000", artShape: null, artTier: null, artIcon: null },
      ]);
    } finally {
      await client.end();
    }
  });

  test("două rulări simultane nu aplică migrațiile de două ori (lock)", async () => {
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${DB}"`);
    });
    const [a, b] = await Promise.all([migrateDatabase(url, migrationsDir), migrateDatabase(url, migrationsDir)]);
    expect([...a.applied, ...b.applied].sort()).toEqual(ALL_MIGRATIONS);
  });
});
