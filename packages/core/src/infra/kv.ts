/**
 * Cheile și valorile scurte ale aplicației (cache, contoare, prezență, lacăte…), în spatele unui driver: Redis în
 * ediția VPS (`GcsRedisKv`), tabele SQL în ediția Lite (`GcsSqlKv`). API-ul e subsetul Redis folosit de aplicație,
 * cu aceeași semantică (expirarea, `NX`, ordinea în sorted sets), ca serviciile să nu știe ce driver au sub ele.
 */
export interface GcsKv {
  get(key: string): Promise<string | null>;
  mget(keys: string[]): Promise<(string | null)[]>;
  /** Scrie valoarea (cu expirare opțională, în ms). Cu `nx`, doar dacă cheia nu există. Întoarce dacă a scris. */
  set(key: string, value: string, opts?: { ttlMs?: number; nx?: boolean }): Promise<boolean>;
  /** Șterge cheile (de orice tip); întoarce câte existau. */
  del(...keys: string[]): Promise<number>;
  /** Incrementează un contor (lipsa = 0); expirarea existentă rămâne. */
  incr(key: string, by?: number): Promise<number>;
  /** Contor pe fereastră fixă: fereastra (secunde) începe la primul increment. Întoarce contorul și secundele rămase. */
  incrWindow(key: string, windowSec: number): Promise<{ count: number; ttlSec: number }>;
  /** Pune expirarea (ms) unei chei existente. */
  expire(key: string, ttlMs: number): Promise<void>;
  /** Prelungește expirarea doar dacă cheia n-are una sau dacă noua e mai lungă (ca `EXPIRE NX` + `EXPIRE GT`). */
  expireMax(key: string, ttlMs: number): Promise<void>;
  /** Ms rămase: -2 = cheia lipsește, -1 = fără expirare. */
  pttl(key: string): Promise<number>;
  /** Șterge cheia doar dacă are valoarea dată (eliberarea unui lacăt de către cel care l-a luat). */
  delIfEquals(key: string, value: string): Promise<boolean>;

  hset(key: string, fields: Record<string, string>): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  hmget(key: string, fields: string[]): Promise<(string | null)[]>;
  hincrby(key: string, field: string, by: number): Promise<number>;
  hdel(key: string, fields: string[]): Promise<void>;
  /** Pune câmpul doar dacă valoarea nouă e mai mare decât cea existentă (lipsa = 0). Întoarce dacă a scris. */
  hsetMax(key: string, field: string, value: number): Promise<boolean>;

  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, members: string[]): Promise<void>;
  /** Membrii cu scorul în [min, max] (sau [min, max) cu `maxExclusive`), crescător sau descrescător (`rev`). */
  zrangeByScore(key: string, min: number, max: number, opts?: { rev?: boolean; maxExclusive?: boolean }): Promise<string[]>;
  zcount(key: string, min: number, max: number): Promise<number>;
  zremRangeByScore(key: string, min: number, max: number, opts?: { maxExclusive?: boolean }): Promise<number>;
  zcard(key: string): Promise<number>;

  sadd(key: string, members: string[]): Promise<void>;
  smembers(key: string): Promise<string[]>;

  /** Adaugă la începutul unei liste și o taie la `maxLen` elemente. */
  listPush(key: string, value: string, maxLen: number): Promise<void>;
  /** Primele `count` elemente (cele mai noi întâi). */
  listRange(key: string, count: number): Promise<string[]>;

  /** Șterge toate cheile care încep cu prefixul dat. */
  delPrefix(prefix: string): Promise<number>;
  /** Cheile care încep cu prefixul dat (diagnostic și teste). */
  keys(prefix: string): Promise<string[]>;
  /** Golește tot (doar teste). */
  flushAll(): Promise<void>;
  ping(): Promise<boolean>;
  /** Închide conexiunea (Redis); în SQL nu face nimic (clientul Prisma e al aplicației). */
  disconnect(): void;

  /** Rulează atomic o operație compusă (Lua în Redis, o tranzacție cu cheile blocate în SQL). */
  script<R>(script: GcsKvScript<R>, keys: string[], args: (string | number)[]): Promise<R>;

  /** Ce driver e (`/api/health`, ACP). */
  readonly driver: "redis" | "sql";
}

/**
 * O operație compusă atomic: același comportament scris de două ori, în Lua (Redis) și în TypeScript peste `GcsKv`
 * (SQL: rulează într-o tranzacție care ține blocate cheile din `keys`). Testele rulează ambele variante.
 * Argumentele ajung la `run` ca text, la fel ca în Lua.
 */
export type GcsKvScript<R> = {
  lua: string;
  run: (kv: GcsKv, keys: string[], args: string[]) => Promise<R>;
  /** Transformă rezultatul Lua (ex. numere ca text, `nil`) în forma lui `run`. */
  fromRedis?: (raw: unknown) => R;
};

export function defineKvScript<R>(script: GcsKvScript<R>): GcsKvScript<R> {
  return script;
}
