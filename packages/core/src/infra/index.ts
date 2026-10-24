import type { PrismaClient } from "@gcs/db";
import Redis from "ioredis";
import { GcsBullJobQueue, type GcsJobQueue } from "../jobs/queue";
import { GcsSqlJobQueue } from "../jobs/queueSql";
import { GcsRedisRealtimeLog, GcsSqlRealtimeLog, type GcsRealtimeLog } from "../realtime/log";
import type { GcsKv } from "./kv";
import { GcsRedisKv } from "./kvRedis";
import { GcsSqlKv } from "./kvSql";
import { GcsLock } from "./lock";

export * from "./kv";
export * from "./kvRedis";
export * from "./kvSql";
export * from "./lock";
export * from "./txLock";

/**
 * Ediția: `vps` (Docker: Redis, worker, websocket) sau `lite` (shared hosting cu Node.js: un singur proces, totul în
 * baza de date, joburile prin cron). Funcțiile sunt aceleași; se schimbă doar infrastructura de sub ele.
 */
export type GcsEdition = "vps" | "lite";

export function gcsEdition(env: Record<string, string | undefined> = process.env): GcsEdition {
  return env.GCS_EDITION === "lite" ? "lite" : "vps";
}

export type GcsInfra = {
  edition: GcsEdition;
  kv: GcsKv;
  jobs: GcsJobQueue;
  realtimeLog: GcsRealtimeLog;
  lock: GcsLock;
  /** Conexiunea Redis (doar VPS): abonările pub/sub (pluginuri, `gcs-realtime`) își fac copii din ea. */
  redis: Redis | null;
  close(): Promise<void>;
};

/** Driverele de infrastructură ale ediției: Redis + BullMQ în VPS, tabele SQL în Lite. */
export function createGcsInfra(opts: { db: PrismaClient; edition?: GcsEdition; redisUrl?: string }): GcsInfra {
  const edition = opts.edition ?? gcsEdition();
  if (edition === "lite") {
    const kv = new GcsSqlKv(opts.db);
    const jobs = new GcsSqlJobQueue(opts.db);
    return { edition, kv, jobs, realtimeLog: new GcsSqlRealtimeLog(opts.db), lock: new GcsLock(kv), redis: null, close: () => jobs.close() };
  }
  const redisUrl = opts.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  // Erorile de conexiune sunt raportate de /api/health; nu trebuie să oprească procesul.
  redis.on("error", () => {});
  const kv = new GcsRedisKv(redis);
  const jobs = new GcsBullJobQueue({ redisUrl });
  return {
    edition,
    kv,
    jobs,
    realtimeLog: new GcsRedisRealtimeLog(redis),
    lock: new GcsLock(kv),
    redis,
    close: async () => {
      await jobs.close();
      redis.disconnect();
    },
  };
}
