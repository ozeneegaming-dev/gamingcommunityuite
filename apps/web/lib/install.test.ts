import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installDomain } from "@gcs/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { rememberLiteBaseUrl } from "./install";

const KEYS = ["GCS_EDITION", "GCS_BASE_URL", "GCS_CONFIG_DIR", "GCS_DOMAIN"] as const;
let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(path.join(os.tmpdir(), "gcs-install-url-"));
  // Ca pe o găzduire partajată proaspătă: ediția Lite, fără adresa site-ului în panou.
  process.env.GCS_EDITION = "lite";
  process.env.GCS_CONFIG_DIR = dir;
  delete process.env.GCS_BASE_URL;
  delete process.env.GCS_DOMAIN;
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

const runtime = () => readFileSync(path.join(dir, ".env.runtime"), "utf8");

describe("adresa site-ului în ediția Lite fără GCS_BASE_URL", () => {
  test("vine din originea browserului, rămâne în .env.runtime și dă domeniul licenței", async () => {
    expect(installDomain()).toBe("");
    await rememberLiteBaseUrl(new Headers({ origin: "https://Forum.Exemplu.ro", host: "forum.exemplu.ro" }));
    expect(process.env.GCS_BASE_URL).toBe("https://forum.exemplu.ro");
    expect(runtime()).toContain("GCS_BASE_URL=https://forum.exemplu.ro\n");
    expect(installDomain()).toBe("forum.exemplu.ro");
  });

  test("fără Origin: protocolul din x-forwarded-proto și host-ul (primul, dacă sunt mai mulți)", async () => {
    await rememberLiteBaseUrl(new Headers({ host: "127.0.0.1:3000", "x-forwarded-host": "forum.exemplu.ro, proxy.intern", "x-forwarded-proto": "https" }));
    expect(process.env.GCS_BASE_URL).toBe("https://forum.exemplu.ro");
  });

  test("nu schimbă adresa setată în panou și nu face nimic în ediția VPS", async () => {
    process.env.GCS_BASE_URL = "https://din-panou.ro";
    await rememberLiteBaseUrl(new Headers({ origin: "https://alt-domeniu.ro" }));
    expect(process.env.GCS_BASE_URL).toBe("https://din-panou.ro");

    delete process.env.GCS_BASE_URL;
    process.env.GCS_EDITION = "vps";
    await rememberLiteBaseUrl(new Headers({ origin: "https://forum.exemplu.ro" }));
    expect(process.env.GCS_BASE_URL).toBeUndefined();
    expect(() => runtime()).toThrow();
  });
});
