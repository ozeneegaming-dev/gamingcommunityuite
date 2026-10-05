import Redis from "ioredis";
import { inject } from "vitest";

let client: Redis | undefined;

/** Clientul Redis al worker-ului curent, pe baza `VITEST_POOL_ID` (izolare între workeri). */
export function testRedis(): Redis {
  client ??= new Redis(inject("redisUrl"), {
    db: Number(process.env.VITEST_POOL_ID ?? "1"),
    maxRetriesPerRequest: 1,
  });
  return client;
}
