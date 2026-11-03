import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workerStatus } from "@gcs/core";
import { testDbUrl } from "@gcs/db/test/helpers";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { HEARTBEAT_JOB } from "./jobs";
import { RETENTION_JOB } from "./security/retention";
import { INDEXNOW_JOB } from "./seo/indexnow";
import { ORPHANS_JOB } from "./uploads/orphans";
import { ACHIEVEMENTS_JOB, MEMBERS_DAILY_JOB } from "./profile/achievements";
import { VIP_SWEEP_JOB } from "./vip/vip";
import { closeGcsServices, createGcsServices, PRESENCE_RECORD_SETTING, type GcsServices } from "./services";

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
    expect(services.jobs.registered().map((j) => j.name)).toEqual(expect.arrayContaining([HEARTBEAT_JOB, ACHIEVEMENTS_JOB, MEMBERS_DAILY_JOB, VIP_SWEEP_JOB, RETENTION_JOB, INDEXNOW_JOB, ORPHANS_JOB]));
  });

  test("jobul de heartbeat marchează worker-ul ca pornit", async () => {
    await services.kv.flushAll();
    const job = services.jobs.registered().find((j) => j.name === HEARTBEAT_JOB)!;
    await job.handler({});
    expect(await workerStatus(services.kv)).toMatchObject({ up: true });
  });

  test("recordul de prezență se salvează în baza de date și nu coboară", async () => {
    await services.kv.flushAll();
    await services.db.setting.deleteMany({ where: { key: PRESENCE_RECORD_SETTING } });
    const now = Date.now();
    await services.presence.touch({ userId: "rec-u1" }, now);
    await services.presence.touch({ userId: "rec-u2" }, now + 1);
    const read = async () => (await services.db.setting.findUnique({ where: { key: PRESENCE_RECORD_SETTING } }))?.value;
    expect(await read()).toMatchObject({ count: 2 });

    // Redis-ul pierdut: recordul din Redis o ia de la 1, dar cel salvat rămâne 2.
    await services.kv.flushAll();
    await services.presence.touch({ userId: "rec-u3" }, now + 2);
    expect(await read()).toMatchObject({ count: 2 });
  });
});
