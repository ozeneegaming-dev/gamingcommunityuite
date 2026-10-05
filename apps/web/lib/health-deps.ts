import "server-only";
import Redis from "ioredis";
import { Pool } from "pg";
import type { GcsHealthDb, GcsHealthRedis } from "@gcs/core";

// Temporar pentru Task 2: un Pool `pg` minim. În Task 3 se înlocuiește cu clientul Prisma din @gcs/db.
type HealthDeps = { db: GcsHealthDb; redis: GcsHealthRedis };

const globalForHealth = globalThis as unknown as { gcsHealthDeps?: HealthDeps };

export function getHealthDeps(): HealthDeps {
  if (!globalForHealth.gcsHealthDeps) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 2000,
    });
    // Erorile conexiunilor inactive nu trebuie să oprească procesul.
    pool.on("error", () => {});
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    redis.on("error", () => {});
    globalForHealth.gcsHealthDeps = {
      db: { $queryRawUnsafe: (query) => pool.query(query) },
      redis,
    };
  }
  return globalForHealth.gcsHealthDeps;
}
