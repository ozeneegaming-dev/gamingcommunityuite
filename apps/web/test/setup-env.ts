import { testDbUrl } from "@gcs/db/test/helpers";
import { inject } from "vitest";

// Serviciile web (`lib/services.ts`) citesc conexiunile din variabilele de mediu, ca în producție.
process.env.DATABASE_URL = testDbUrl();
const redisUrl = new URL(inject("redisUrl"));
redisUrl.pathname = `/${process.env.VITEST_POOL_ID ?? "1"}`;
process.env.REDIS_URL = redisUrl.toString();
process.env.GCS_BASE_URL = "http://localhost:3000";

declare module "vitest" {
  export interface ProvidedContext {
    redisUrl: string;
  }
}
