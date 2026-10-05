import "server-only";
import type { GcsHealthDb, GcsHealthRedis } from "@gcs/core";
import { services } from "./services";

/** Dependențele verificate de `/api/health`: clientul Prisma și Redis-ul aplicației. */
export function getHealthDeps(): { db: GcsHealthDb; redis: GcsHealthRedis } {
  const { db, redis } = services();
  return { db, redis };
}
