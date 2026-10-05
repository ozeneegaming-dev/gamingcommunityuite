import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GcsInstallState } from "@gcs/core";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST } from "./route";

let dir: string;
const previous = process.env.GCS_CONFIG_DIR;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "gcs-run-route-"));
  process.env.GCS_CONFIG_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.GCS_CONFIG_DIR;
  else process.env.GCS_CONFIG_DIR = previous;
});

const request = (cookie?: string) =>
  new NextRequest("http://localhost/install/run", { method: "POST", headers: cookie ? { cookie: `gcs-install=${cookie}` } : {} });

describe("POST /install/run", () => {
  test("Review Focus #3: un POST în timp ce lock-ul e ocupat → 409", async () => {
    const state = new GcsInstallState(dir);
    const token = await state.createInstallSession();
    await expect(state.acquireRunLock()).resolves.toBe(true);

    const res = await POST(request(token));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "busy" });
  });

  test("după finalizare → 409, iar lock-ul nu e luat", async () => {
    const state = new GcsInstallState(dir);
    const token = await state.createInstallSession();
    await state.markInstalled();
    expect((await POST(request(token))).status).toBe(409);
    await expect(state.acquireRunLock()).resolves.toBe(true);
  });

  test("fără sesiunea de instalare (codul neintrodus) → 403", async () => {
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request("token-fals"))).status).toBe(403);
  });

  test("cu pașii incompleți → 400, iar lock-ul e eliberat", async () => {
    const state = new GcsInstallState(dir);
    const token = await state.createInstallSession();
    expect((await POST(request(token))).status).toBe(400);
    await expect(state.acquireRunLock()).resolves.toBe(true);
  });
});
