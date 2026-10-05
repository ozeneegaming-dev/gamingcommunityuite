import type Redis from "ioredis";

export type GcsRateLimitRule = { window: number; max: number };
export type GcsRateLimitResult = { allowed: boolean; retryAfter: number | null };

/** Incrementează contorul și setează TTL-ul ferestrei la prima cerere; întoarce [contor, ttl]. */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}`;

/**
 * Rate limiting pe Redis cu fereastră fixă (spec §15), atomic între instanțe.
 * Are forma `consume` cerută de Better Auth (`rateLimit.customStorage`) și se refolosește
 * pentru postare, mesaje private, căutare etc.
 */
export class GcsRedisRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "gcs:rl:",
  ) {}

  async consume(key: string, rule: GcsRateLimitRule): Promise<GcsRateLimitResult> {
    const [count, ttl] = (await this.redis.eval(CONSUME_SCRIPT, 1, this.prefix + key, rule.window)) as [number, number];
    if (count <= rule.max) return { allowed: true, retryAfter: null };
    return { allowed: false, retryAfter: ttl };
  }
}
