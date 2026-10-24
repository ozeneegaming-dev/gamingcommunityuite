import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { testOnMysql } from "./url";
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
const ALL = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
/** Prima migrație a ediției Lite care schimbă tipuri (listele → JSON); înaintea ei, o bază ca pe serverele existente. */
const FIRST_PORTABLE = "20261120100000_lite_portable_lists";
const DB = `redline_portable_${process.env.VITEST_POOL_ID ?? "1"}`;
let url: string;
let tmp: string;

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject("pgBaseUrl") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function db<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Un folder cu migrațiile până la (fără) `stop`, ca baza să fie „înainte de actualizare”. */
function migrationsUntil(stop: string | null): string {
  const dir = mkdtempSync(path.join(tmp, "m-"));
  for (const name of ALL) {
    if (stop !== null && name >= stop) break;
    cpSync(path.join(migrationsDir, name), path.join(dir, name), { recursive: true });
  }
  return dir;
}

beforeAll(async () => {
  if (testOnMysql()) return;
  tmp = mkdtempSync(path.join(os.tmpdir(), "gcs-portable-"));
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${DB}"`);
  });
  url = withDatabase(inject("pgBaseUrl"), DB);
});

afterAll(async () => {
  if (testOnMysql()) return;
  await admin((c) => c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`));
  rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(testOnMysql())("migrațiile portabile (ediția Lite) pe o bază existentă", () => {
  test("listele scalare devin JSON cu datele păstrate; indexurile parțiale păstrează regulile", async () => {
    await migrateDatabase(url, migrationsUntil(FIRST_PORTABLE));
    const ids = await db(async (c) => {
      const group = (await c.query<{ id: number }>(`INSERT INTO groups (key, name) VALUES ('member', 'Membru') RETURNING id`)).rows[0]!.id;
      await c.query(`INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ('u1', 'Ana', 'ana', 'ana@mail.com', $1, now())`, [group]);
      await c.query(`INSERT INTO system_state (id, "seedMarks") VALUES (1, ARRAY['nav', 'nav:v2']) ON CONFLICT (id) DO UPDATE SET "seedMarks" = EXCLUDED."seedMarks"`);
      const nav = (await c.query<{ id: number }>(`INSERT INTO nav_items (position, label, groups) VALUES (0, '{"key":"x"}', ARRAY[$1::int, 7]) RETURNING id`, [group])).rows[0]!.id;
      const empty = (await c.query<{ id: number }>(`INSERT INTO nav_items (position, label, groups) VALUES (1, '{"key":"y"}', '{}') RETURNING id`)).rows[0]!.id;
      await c.query(
        `INSERT INTO notifications ("userId", type, "targetType", "targetId", "groupKey", "actorIds", data, "updatedAt") VALUES ('u1', 't', 'topic', '1', 'g1', ARRAY['a', 'b'], '{}', now())`,
      );
      return { group, nav, empty };
    });

    const { applied } = await migrateDatabase(url, migrationsUntil(null));
    expect(applied).toContain(FIRST_PORTABLE);

    await db(async (c) => {
      expect((await c.query(`SELECT "seedMarks" FROM system_state WHERE id = 1`)).rows[0].seedMarks).toEqual(["nav", "nav:v2"]);
      const nav = await c.query(`SELECT id, groups FROM nav_items ORDER BY position`);
      expect(nav.rows.map((r) => r.groups)).toEqual([[ids.group, 7], []]);
      expect((await c.query(`SELECT "actorIds" FROM notifications`)).rows[0].actorIds).toEqual(["a", "b"]);
      // Valoarea implicită a unei liste noi e lista goală.
      await c.query(`INSERT INTO nav_items (position, label) VALUES (2, '{"key":"z"}')`);
      expect((await c.query(`SELECT groups FROM nav_items WHERE position = 2`)).rows[0].groups).toEqual([]);

      // O singură notificare necitită pe grup; după citire, una nouă e permisă.
      await expect(
        c.query(`INSERT INTO notifications ("userId", type, "targetType", "targetId", "groupKey", data, "updatedAt") VALUES ('u1', 't', 'topic', '1', 'g1', '{}', now())`),
      ).rejects.toThrow(/notifications_unread_group/);
      await c.query(`UPDATE notifications SET "readAt" = now() WHERE "groupKey" = 'g1'`);
      await c.query(`INSERT INTO notifications ("userId", type, "targetType", "targetId", "groupKey", data, "updatedAt") VALUES ('u1', 't', 'topic', '1', 'g1', '{}', now())`);
      expect(Number((await c.query(`SELECT count(*) AS n FROM notifications WHERE "groupKey" = 'g1'`)).rows[0].n)).toBe(2);
    });
  });
});
