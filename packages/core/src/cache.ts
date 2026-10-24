import { defineKvScript, type GcsKv } from "./infra/kv";

/** Cât ține minte un tag momentul ultimei invalidări (o citire mai lungă de atât nu se mai verifică). */
const INVALIDATED_TTL_MS = 60_000;

/**
 * Scrie valoarea și o adaugă în seturile tag-urilor. KEYS[1] = cheia, apoi `n` seturi de tag-uri, apoi `n` marcaje de
 * invalidare; ARGV = valoarea, TTL în ms, momentul citirii ratate (0 = necunoscut), `n`. Dacă un tag a fost invalidat
 * după citire, valoarea calculată e veche: nu se mai scrie (întoarce 0).
 */
const SET_SCRIPT = defineKvScript<number>({
  lua: `
local n = tonumber(ARGV[4])
local since = tonumber(ARGV[3])
if since > 0 then
  for i = 2 + n, 1 + 2 * n do
    local inv = tonumber(redis.call('GET', KEYS[i]) or '0')
    if inv > since then return 0 end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
for i = 2, 1 + n do
  redis.call('SADD', KEYS[i], KEYS[1])
  local t = redis.call('PTTL', KEYS[i])
  if t == -1 or tonumber(ARGV[2]) > t then redis.call('PEXPIRE', KEYS[i], ARGV[2]) end
end
return 1`,
  run: async (kv, keys, [value, ttl, sinceRaw, nRaw]) => {
    const n = Number(nRaw);
    const since = Number(sinceRaw);
    const [key] = keys;
    const tags = keys.slice(1, 1 + n);
    const marks = keys.slice(1 + n, 1 + 2 * n);
    if (since > 0) {
      for (const inv of await kv.mget(marks)) if (Number(inv ?? 0) > since) return 0;
    }
    await kv.set(key!, value!, { ttlMs: Number(ttl) });
    for (const tag of tags) {
      await kv.sadd(tag, [key!]);
      await kv.expireMax(tag, Number(ttl));
    }
    return 1;
  },
  fromRedis: Number,
});

/**
 * Șterge atomic toate cheile din seturile de tag-uri primite și seturile însele și notează momentul invalidării.
 * KEYS = `n` seturi, apoi `n` marcaje; ARGV = momentul (ms), TTL-ul marcajelor, `n`.
 * Atomicitatea contează: un `set` care ar intra între citirea setului și ștergerea lui
 * ar rămâne în cache fără să mai poată fi invalidat.
 */
const INVALIDATE_SCRIPT = defineKvScript<number>({
  lua: `
local n = tonumber(ARGV[3])
for t = 1, n do
  local tag = KEYS[t]
  local members = redis.call('SMEMBERS', tag)
  for i = 1, #members, 500 do
    redis.call('DEL', unpack(members, i, math.min(i + 499, #members)))
  end
  redis.call('DEL', tag)
  redis.call('SET', KEYS[n + t], ARGV[1], 'PX', ARGV[2])
end
return 1`,
  run: async (kv, keys, [at, ttl, nRaw]) => {
    const n = Number(nRaw);
    for (let t = 0; t < n; t++) {
      const tag = keys[t]!;
      const members = await kv.smembers(tag);
      for (let i = 0; i < members.length; i += 500) await kv.del(...members.slice(i, i + 500));
      await kv.del(tag);
      await kv.set(keys[n + t]!, at!, { ttlMs: Number(ttl) });
    }
    return 1;
  },
  fromRedis: Number,
});

const MISS_MEMO_MAX = 5_000;

/**
 * Cache cu invalidare pe tag-uri (spec §15), peste `GcsKv` (Redis în VPS, SQL în Lite). Fiecare tag are un set
 * `<prefix>:tag:<tag>` cu cheile asociate; `invalidateTags` șterge cheile din seturi.
 *
 * Cursa „citire veche scrisă după invalidare” (o pagină citește din bază, o editare invalidează, pagina scrie apoi
 * valoarea veche) e oprită: `get` ține minte când a ratat, iar `set` nu scrie dacă un tag a fost invalidat între timp.
 */
export class GcsCache {
  private readonly misses = new Map<string, number>();

  constructor(
    private readonly kv: GcsKv,
    private readonly prefix = "gcs",
    private readonly now: () => number = Date.now,
  ) {}

  private key(key: string): string {
    return `${this.prefix}:k:${key}`;
  }

  private tag(tag: string): string {
    return `${this.prefix}:tag:${tag}`;
  }

  private mark(tag: string): string {
    return `${this.prefix}:inv:${tag}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const at = this.now();
    const raw = await this.kv.get(this.key(key));
    if (raw === null) {
      if (this.misses.size >= MISS_MEMO_MAX) this.misses.clear();
      this.misses.set(key, at);
      return null;
    }
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, opts: { ttlSec: number; tags: string[] }): Promise<void> {
    const since = this.misses.get(key) ?? 0;
    this.misses.delete(key);
    const fresh = since > 0 && this.now() - since < INVALIDATED_TTL_MS ? since : 0;
    // Setul de tag trăiește cel puțin cât cea mai lungă cheie din el.
    await this.kv.script(
      SET_SCRIPT,
      [this.key(key), ...opts.tags.map((t) => this.tag(t)), ...opts.tags.map((t) => this.mark(t))],
      [JSON.stringify(value), opts.ttlSec * 1000, fresh, opts.tags.length],
    );
  }

  async invalidateTags(tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    await this.kv.script(INVALIDATE_SCRIPT, [...tags.map((t) => this.tag(t)), ...tags.map((t) => this.mark(t))], [this.now(), INVALIDATED_TTL_MS, tags.length]);
  }

  /** Golește tot cache-ul paginilor (cheile și seturile de tag-uri), fără cozi și limite (ex. după un import). */
  async clear(): Promise<void> {
    await this.kv.delPrefix(`${this.prefix}:k:`);
    await this.kv.delPrefix(`${this.prefix}:tag:`);
  }
}
