import "server-only";
import type { GcsHealthDb, GcsHealthKv } from "@gcs/core";
import { services } from "./services";

/** Dependențele verificate de `/api/health`: clientul Prisma și stocarea cheilor (Redis în VPS, baza de date în Lite). */
export function getHealthDeps(): { db: GcsHealthDb; kv: GcsHealthKv } {
  const { db, kv } = services();
  return { db, kv };
}
