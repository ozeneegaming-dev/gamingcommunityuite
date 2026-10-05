import type Redis from "ioredis";

/**
 * Șterge atomic toate cheile din seturile de tag-uri primite și seturile însele.
 * Atomicitatea contează: un `set` care ar intra între citirea setului și ștergerea lui
 * ar rămâne în cache fără să mai poată fi invalidat.
 */
const INVALIDATE_SCRIPT = `
for _, tag in ipairs(KEYS) do
  local members = redis.call('SMEMBERS', tag)
  for i = 1, #members, 500 do
    redis.call('DEL', unpack(members, i, math.min(i + 499, #members)))
  end
  redis.call('DEL', tag)
end
return 1`;

/**
 * Cache Redis cu invalidare pe tag-uri (spec §15). Fiecare tag are un set `<prefix>:tag:<tag>`
 * cu cheile asociate; `invalidateTags` șterge cheile din seturi.
 */
export class GcsCache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "gcs",
  ) {}

  private key(key: string): string {
    return `${this.prefix}:k:${key}`;
  }

  private tag(tag: string): string {
    return `${this.prefix}:tag:${tag}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.key(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, opts: { ttlSec: number; tags: string[] }): Promise<void> {
    const fullKey = this.key(key);
    const multi = this.redis.multi().set(fullKey, JSON.stringify(value), "EX", opts.ttlSec);
    for (const tag of opts.tags) {
      const tagKey = this.tag(tag);
      // Setul de tag trăiește cel puțin cât cea mai lungă cheie din el (NX: primul TTL, GT: doar prelungiri).
      multi.sadd(tagKey, fullKey).expire(tagKey, opts.ttlSec, "NX").expire(tagKey, opts.ttlSec, "GT");
    }
    await multi.exec();
  }

  async invalidateTags(tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    await this.redis.eval(INVALIDATE_SCRIPT, tags.length, ...tags.map((t) => this.tag(t)));
  }
}
