import { testDb } from "@gcs/db/test/helpers";
import type { GcsKv } from "../src/infra/kv";
import { GcsRedisKv } from "../src/infra/kvRedis";
import { GcsSqlKv } from "../src/infra/kvSql";
import { testRedis } from "./redis";

let kv: GcsKv | undefined;

/**
 * Driverul cheilor ales pentru rularea testelor: Redis (implicit, ca ediția VPS) sau SQL (`GCS_EDITION=lite`, ca
 * ediția Lite; atunci și serviciile complete din teste — `createGcsServices` — pornesc cu driverele SQL).
 */
export function testKvDriver(): "redis" | "sql" {
  return process.env.GCS_EDITION === "lite" ? "sql" : "redis";
}

/** `GcsKv`-ul worker-ului curent de test, pe driverul ales (`testKvDriver`). */
export function testKv(): GcsKv {
  kv ??= testKvDriver() === "sql" ? new GcsSqlKv(testDb()) : new GcsRedisKv(testRedis());
  return kv;
}

/** Ambele drivere, pentru testele de contract (același comportament în VPS și în Lite). */
export function bothKvs(): { name: "redis" | "sql"; kv: () => GcsKv }[] {
  let sql: GcsKv | undefined;
  let redis: GcsKv | undefined;
  return [
    { name: "redis", kv: () => (redis ??= new GcsRedisKv(testRedis())) },
    { name: "sql", kv: () => (sql ??= new GcsSqlKv(testDb())) },
  ];
}
