import { mkdtempSync, rmSync } from "node:fs";
import { testOnMysql } from "@gcs/db/test/url";
import os from "node:os";
import path from "node:path";
import { inject } from "vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { testDbUrl } from "@gcs/db/test/helpers";
import { runChecks } from "./checks";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "gcs-checks-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const byId = (results: Awaited<ReturnType<typeof runChecks>>) => Object.fromEntries(results.map((r) => [r.id, r]));

// Sub încărcarea `pnpm test` (toate pachetele în paralel), conexiunile pot depăși limita de 3 s din producție.
describe.skipIf(testOnMysql())("runChecks", () => {
  test("cu PostgreSQL și Redis pornite → postgres, redis, disc și config ok", async () => {
    const results = byId(await runChecks({ databaseUrl: testDbUrl(), redisUrl: inject("redisUrl"), configDir: dir, timeoutMs: 30_000 }));
    expect(results.postgres).toMatchObject({ ok: true });
    expect(results.redis).toMatchObject({ ok: true });
    expect(results.config_writable).toMatchObject({ ok: true });
    expect(results.disk?.ok).toBe(true);
    expect(Object.keys(results).sort()).toEqual(["config_writable", "disk", "extensions", "minio", "postgres", "redis"]);
  });

  test("cu Redis oprit → intrarea redis are ok:false și fixKey:'install.fix.redis'", async () => {
    const results = byId(await runChecks({ databaseUrl: testDbUrl(), redisUrl: "redis://127.0.0.1:1", configDir: dir }));
    expect(results.redis).toMatchObject({ ok: false, fixKey: "install.fix.redis" });
  });

  test("fără S3 configurat → minio ok:false; un folder inexistent → config_writable ok:false", async () => {
    const results = byId(
      await runChecks({ databaseUrl: testDbUrl(), redisUrl: inject("redisUrl"), configDir: path.join(dir, "nu", "exista\0") }),
    );
    expect(results.minio).toMatchObject({ ok: false, fixKey: "install.fix.minio" });
    expect(results.config_writable).toMatchObject({ ok: false, fixKey: "install.fix.config_writable" });
  });

  test("o bază de date inaccesibilă → postgres și extensions ok:false", async () => {
    const results = byId(await runChecks({ databaseUrl: "postgresql://x:y@127.0.0.1:1/z", redisUrl: inject("redisUrl"), configDir: dir }));
    expect(results.postgres).toMatchObject({ ok: false, fixKey: "install.fix.postgres" });
    expect(results.extensions?.ok).toBe(false);
  });
});

// Ediția Lite (găzduire partajată): fără Redis / MinIO; baza se alege la pasul următor, deci fără DATABASE_URL nu se verifică.
describe("runChecks (ediția Lite)", () => {
  test("fără bază: Node.js, disc și config, cu textele de remediere ale găzduirii partajate", async () => {
    const results = byId(await runChecks({ configDir: dir, edition: "lite" }));
    expect(Object.keys(results).sort()).toEqual(["config_writable", "disk", "node"]);
    expect(results.node).toMatchObject({ ok: true, detail: `Node.js ${process.versions.node}` });
    const failing = await runChecks({ configDir: path.join(dir, "\u0000invalid"), edition: "lite" });
    expect(failing.find((r) => r.id === "config_writable")).toMatchObject({ ok: false, fixKey: "install.fixLite.config_writable" });
  });

  test.skipIf(testOnMysql())("cu DATABASE_URL (PostgreSQL): verificarea bazei", async () => {
    const results = byId(await runChecks({ databaseUrl: testDbUrl(), configDir: dir, edition: "lite", timeoutMs: 30_000 }));
    expect(results.database).toMatchObject({ ok: true });
  });

  test.skipIf(!testOnMysql())("cu DATABASE_URL (MySQL): versiunea serverului", async () => {
    const results = byId(await runChecks({ databaseUrl: testDbUrl(), configDir: dir, edition: "lite", timeoutMs: 30_000 }));
    expect(results.database).toMatchObject({ ok: true });
    expect(results.database!.detail).toMatch(/^MySQL 8\./);
  });
});
