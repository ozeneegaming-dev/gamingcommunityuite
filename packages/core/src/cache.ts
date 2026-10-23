import { defineKvScript, type GcsKv } from "./infra/kv";

/** Scrie valoarea și o adaugă în seturile tag-urilor (KEYS[1] = cheia, KEYS[2..] = seturile; ARGV = valoarea, TTL în ms). */
const SET_SCRIPT = defineKvScript<number>({
  lua: `
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
for i = 2, #KEYS do
  redis.call('SADD', KEYS[i], KEYS[1])
  local t = redis.call('PTTL', KEYS[i])
  if t == -1 or tonumber(ARGV[2]) > t then redis.call('PEXPIRE', KEYS[i], ARGV[2]) end
end
return 1`,
  run: async (kv, keys, [value, ttl]) => {
    const [key, ...tags] = keys;
    await kv.set(key!, value!, { ttlMs: Number(ttl) });
    for (const tag of tags) {
      await kv.sadd(tag, [key!]);
      await kv.expireMax(tag, Number(ttl));
    }
    return 1;
  },
});

/**
 * Șterge atomic toate cheile din seturile de tag-uri primite și seturile însele.
 * Atomicitatea contează: un `set` care ar intra între citirea setului și ștergerea lui
 * ar rămâne în cache fără să mai poată fi invalidat.
 */
const INVALIDATE_SCRIPT = defineKvScript<number>({
  lua: `
for _, tag in ipairs(KEYS) do
  local members = redis.call('SMEMBERS', tag)
  for i = 1, #members, 500 do
    redis.call('DEL', unpack(members, i, math.min(i + 499, #members)))
  end
  redis.call('DEL', tag)
end
return 1`,
  run: async (kv, tags) => {
    for (const tag of tags) {
      const members = await kv.smembers(tag);
      for (let i = 0; i < members.length; i += 500) await kv.del(...members.slice(i, i + 500));
      await kv.del(tag);
    }
    return 1;
  },
});

/**
 * Cache cu invalidare pe tag-uri (spec §15), peste `GcsKv` (Redis în VPS, SQL în Lite). Fiecare tag are un set
 * `<prefix>:tag:<tag>` cu cheile asociate; `invalidateTags` șterge cheile din seturi.
 */
export class GcsCache {
  constructor(
    private readonly kv: GcsKv,
    private readonly prefix = "gcs",
  ) {}

  private key(key: string): string {
    return `${this.prefix}:k:${key}`;
  }

  private tag(tag: string): string {
    return `${this.prefix}:tag:${tag}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.kv.get(this.key(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, opts: { ttlSec: number; tags: string[] }): Promise<void> {
    // Setul de tag trăiește cel puțin cât cea mai lungă cheie din el.
    await this.kv.script(SET_SCRIPT, [this.key(key), ...opts.tags.map((t) => this.tag(t))], [JSON.stringify(value), opts.ttlSec * 1000]);
  }

  async invalidateTags(tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    await this.kv.script(INVALIDATE_SCRIPT, tags.map((t) => this.tag(t)), []);
  }

  /** Golește tot cache-ul paginilor (cheile și seturile de tag-uri), fără cozi și limite (ex. după un import). */
  async clear(): Promise<void> {
    await this.kv.delPrefix(`${this.prefix}:k:`);
    await this.kv.delPrefix(`${this.prefix}:tag:`);
  }
}
