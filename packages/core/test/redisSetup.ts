import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    redisUrl: string;
  }
}

/**
 * Pornește un Redis de test.
 *
 * - Cu `TEST_REDIS_URL` (ex. în CI: `redis://localhost:6379`) folosește acel server.
 * - Fără, pornește un Redis local prin `redis-memory-server` (pe Windows: Memurai, compatibil Redis),
 *   descărcat automat la prima rulare. Fără Docker și fără instalare manuală.
 *
 * Fiecare worker Vitest folosește baza Redis `VITEST_POOL_ID` (vezi `test/redis.ts`).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let url = process.env.TEST_REDIS_URL;
  let stopServer: (() => Promise<unknown>) | undefined;

  if (!url) {
    // Pe Windows, pachetul dezarhivează Memurai în %TEMP% și apoi îl mută cu `rename`, care eșuează
    // (EXDEV) dacă proiectul e pe alt disc. Ținem binarul lângă %TEMP%, pe același disc.
    process.env.REDISMS_DOWNLOAD_DIR ??= path.join(os.tmpdir(), "redis-memory-server");
    const { RedisMemoryServer } = await import("redis-memory-server");
    const server = await RedisMemoryServer.create();
    url = `redis://${await server.getHost()}:${await server.getPort()}`;
    stopServer = () => server.stop();
  }

  project.provide("redisUrl", url);

  return async () => {
    await stopServer?.();
  };
}
