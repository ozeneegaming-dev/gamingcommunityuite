import type { GcsServices } from "./services";

/** 5 încercări pe user la 15 minute, ca reautentificarea în ACP. */
export const TWO_FACTOR_STEP_RULE = { window: 15 * 60, max: 5 };
/** Un cod TOTP e valabil cel mult ~90 s (fereastra curentă ± una); cât îl ținem minte ca folosit. */
const USED_CODE_TTL = 120;

export type GcsTwoFactorStepResult = "ok" | "invalid" | "rate_limited";

/**
 * Codul 2FA cerut din nou la o confirmare sensibilă din ACP (ex. instalarea unui plugin nesemnat): limită de încercări
 * pe user (rate limiter-ul comun) și protecție la reluare — un cod acceptat o dată nu mai trece a doua oară.
 */
export async function verifyTwoFactorStep(
  deps: Pick<GcsServices, "rateLimiter" | "redis">,
  userId: string,
  code: string,
  verify: (code: string) => Promise<boolean>,
): Promise<GcsTwoFactorStepResult> {
  const limit = await deps.rateLimiter.consume(`acp-2fa-step:${userId}`, TWO_FACTOR_STEP_RULE);
  if (!limit.allowed) return "rate_limited";
  const clean = code.replace(/\s/g, "");
  if (!(await verify(clean))) return "invalid";
  // SET NX e atomic: din două cereri simultane cu același cod, doar una îl consumă.
  const fresh = await deps.redis.set(`gcs:2fa-used:${userId}:${clean}`, "1", "EX", USED_CODE_TTL, "NX");
  return fresh === "OK" ? "ok" : "invalid";
}
