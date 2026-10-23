import type { GcsKv } from "../infra/kv";

export type GcsRateLimitRule = { window: number; max: number };
export type GcsRateLimitResult = { allowed: boolean; retryAfter: number | null };

/**
 * Rate limiting cu fereastră fixă (spec §15), atomic între instanțe, peste `GcsKv` (Redis în VPS, SQL în Lite).
 * Are forma `consume` cerută de Better Auth (`rateLimit.customStorage`) și se refolosește
 * pentru postare, mesaje private, căutare etc.
 */
export class GcsRateLimiter {
  constructor(
    private readonly kv: GcsKv,
    private readonly prefix = "gcs:rl:",
  ) {}

  async consume(key: string, rule: GcsRateLimitRule): Promise<GcsRateLimitResult> {
    const { count, ttlSec } = await this.kv.incrWindow(this.prefix + key, rule.window);
    if (count <= rule.max) return { allowed: true, retryAfter: null };
    return { allowed: false, retryAfter: ttlSec };
  }

  /** Uită contorul unei chei (ex. rutele de test ale E2E). */
  async reset(key: string): Promise<void> {
    await this.kv.del(this.prefix + key);
  }
}

/** Numele de dinainte de ediția Lite (limitatorul era doar pe Redis); păstrat pentru codul care încă îl folosește. */
export const GcsRedisRateLimiter = GcsRateLimiter;
export type GcsRedisRateLimiter = GcsRateLimiter;

/**
 * Limitator în memoria procesului, pentru momentul în care nu există încă o stocare comună: instalarea ediției Lite
 * (baza de date se alege abia în wizard). Un singur proces, deci ajunge.
 */
export class GcsMemoryRateLimiter {
  private readonly hits = new Map<string, { count: number; until: number }>();

  async consume(key: string, rule: GcsRateLimitRule, now = Date.now()): Promise<GcsRateLimitResult> {
    const hit = this.hits.get(key);
    const current = hit && hit.until > now ? hit : { count: 0, until: now + rule.window * 1000 };
    current.count++;
    this.hits.set(key, current);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.until <= now) this.hits.delete(k);
    if (current.count <= rule.max) return { allowed: true, retryAfter: null };
    return { allowed: false, retryAfter: Math.ceil((current.until - now) / 1000) };
  }
}
