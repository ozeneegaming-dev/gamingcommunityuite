import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { resetServices, services } from "./services";
import { TWO_FACTOR_STEP_RULE, verifyTwoFactorStep } from "./two-factor-step";

// Serviciile se iau la fiecare test: alte teste le pot recrea.
const deps = () => {
  const { rateLimiter, redis } = services();
  return { rateLimiter, redis };
};
const VALID = "123456";
const verify = async (code: string) => code === VALID;

beforeEach(async () => {
  await services().redis.flushdb();
});

afterAll(async () => {
  await resetServices();
});

describe("codul 2FA cerut din nou în ACP", () => {
  test("codul corect trece, cel greșit nu", async () => {
    expect(await verifyTwoFactorStep(deps(), "u1", "000000", verify)).toBe("invalid");
    expect(await verifyTwoFactorStep(deps(), "u1", "123 456", verify)).toBe("ok");
  });

  test("un cod acceptat o dată nu mai poate fi refolosit (protecție la reluare); alt user nu e afectat", async () => {
    expect(await verifyTwoFactorStep(deps(), "u1", VALID, verify)).toBe("ok");
    expect(await verifyTwoFactorStep(deps(), "u1", VALID, verify)).toBe("invalid");
    expect(await verifyTwoFactorStep(deps(), "u2", VALID, verify)).toBe("ok");
  });

  test("după limita de încercări, nici codul corect nu mai e verificat", async () => {
    let calls = 0;
    const counting = async (code: string) => {
      calls++;
      return verify(code);
    };
    for (let i = 0; i < TWO_FACTOR_STEP_RULE.max; i++) expect(await verifyTwoFactorStep(deps(), "u1", "000000", counting)).toBe("invalid");
    expect(await verifyTwoFactorStep(deps(), "u1", VALID, counting)).toBe("rate_limited");
    expect(calls).toBe(TWO_FACTOR_STEP_RULE.max);
    expect(await verifyTwoFactorStep(deps(), "u2", VALID, counting)).toBe("ok");
  });
});
