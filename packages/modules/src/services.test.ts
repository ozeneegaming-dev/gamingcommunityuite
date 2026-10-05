import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workerStatus } from "@gcs/core";
import { testDbUrl } from "@gcs/db/test/helpers";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { HEARTBEAT_JOB } from "./jobs";
import { closeGcsServices, createGcsServices, type GcsServices } from "./services";

let services: GcsServices;
let configDir: string;

beforeAll(async () => {
  configDir = await mkdtemp(path.join(os.tmpdir(), "gcs-services-"));
  process.env.DATABASE_URL = testDbUrl();
  const redis = new URL(inject("redisUrl"));
  redis.pathname = `/${process.env.VITEST_POOL_ID ?? "1"}`;
  process.env.REDIS_URL = redis.toString();
  services = createGcsServices({ configDir });
});

afterAll(async () => {
  await closeGcsServices(services);
  await rm(configDir, { recursive: true, force: true });
});

describe("createGcsServices", () => {
  test("înregistrează modulele aplicației și joburile", () => {
    expect(services.registry.all().map((m) => m.key)).toEqual(expect.arrayContaining(["core", "forums"]));
    expect(services.jobs.registered().map((j) => j.name)).toContain(HEARTBEAT_JOB);
  });

  test("jobul de heartbeat marchează worker-ul ca pornit", async () => {
    await services.redis.flushdb();
    const job = services.jobs.registered().find((j) => j.name === HEARTBEAT_JOB)!;
    await job.handler({});
    expect(await workerStatus(services.redis)).toMatchObject({ up: true });
  });
});
