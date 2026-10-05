import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { migrateDatabase } from "../src/migrate";
import { withDatabase } from "./url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../prisma/migrations");
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

describe("migrateDatabase", () => {
  test("pe o bază goală aplică toate migrațiile; a doua rulare nu mai aplică nimic", async () => {
    const first = await migrateDatabase(url, migrationsDir);
    expect(first.applied).toEqual(["20261005000000_core", "20261005010000_two_factor"]);
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
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    });
    expect(output).toContain("Database schema is up to date");
  });

  test("două rulări simultane nu aplică migrațiile de două ori (lock)", async () => {
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${DB}"`);
    });
    const [a, b] = await Promise.all([migrateDatabase(url, migrationsDir), migrateDatabase(url, migrationsDir)]);
    expect([...a.applied, ...b.applied].sort()).toEqual(["20261005000000_core", "20261005010000_two_factor"]);
  });
});
