import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testKv } from "../../test/kv";
import { GcsRateLimiter } from "./rateLimit";

const kv = testKv();
const limiter = new GcsRateLimiter(kv);

beforeEach(async () => {
  await kv.flushAll();
});

afterAll(() => {
  kv.disconnect();
});

describe("GcsRateLimiter", () => {
  test("5 încercări pe 15 minute: a 6-a e refuzată, cu retryAfter", async () => {
    const rule = { window: 900, max: 5 };
    for (let i = 0; i < 5; i++) {
      await expect(limiter.consume("1.2.3.4|/sign-in/email", rule)).resolves.toEqual({ allowed: true, retryAfter: null });
    }
    const blocked = await limiter.consume("1.2.3.4|/sign-in/email", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(890);
    expect(blocked.retryAfter).toBeLessThanOrEqual(900);
  });

  test("cheile sunt independente (alt IP)", async () => {
    const rule = { window: 60, max: 1 };
    await limiter.consume("a", rule);
    await expect(limiter.consume("b", rule)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume("a", rule)).resolves.toMatchObject({ allowed: false });
  });

  test("după fereastră, contorul se resetează", async () => {
    const rule = { window: 1, max: 1 };
    await limiter.consume("k", rule);
    await expect(limiter.consume("k", rule)).resolves.toMatchObject({ allowed: false });
    await new Promise((r) => setTimeout(r, 1100));
    await expect(limiter.consume("k", rule)).resolves.toMatchObject({ allowed: true });
  });
});
