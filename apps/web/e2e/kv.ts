import pg from "pg";

/**
 * Cheile aplicației pentru specuri (cache-ul paginilor, statusul serverelor…): Redis în ediția VPS, tabelul `gcs_kv` în
 * ediția Lite (`GCS_EDITION=lite`, setat de `e2e/run.mts`). Doar operațiile de care au nevoie specurile; tiparele
 * `keys` acceptă doar `*` la final. Fără `@gcs/core` (Playwright încarcă specurile ca CommonJS).
 */
export type GcsE2eKv = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: "EX", seconds?: number): Promise<unknown>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  disconnect(): void;
};

export async function e2eKv(redisUrl = process.env.REDIS_URL, databaseUrl = process.env.DATABASE_URL): Promise<GcsE2eKv> {
  if (process.env.GCS_EDITION !== "lite") {
    const { default: Redis } = await import("ioredis");
    return new Redis(redisUrl ?? "redis://localhost:6379") as unknown as GcsE2eKv;
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const live = `("expiresAt" IS NULL OR "expiresAt" > $NOW)`;
  const now = () => Date.now();
  return {
    async get(key) {
      const r = await client.query<{ value: string | null }>(`SELECT value FROM gcs_kv WHERE key = $1 AND type = 'string' AND ${live.replace("$NOW", "$2")}`, [key, now()]);
      return r.rows[0]?.value ?? null;
    },
    async set(key, value, _mode, seconds) {
      await client.query(`DELETE FROM gcs_kv WHERE key = $1`, [key]);
      await client.query(`INSERT INTO gcs_kv (key, type, value, "expiresAt") VALUES ($1, 'string', $2, $3)`, [key, value, seconds ? now() + seconds * 1000 : null]);
      return "OK";
    },
    async hset(key, field, value) {
      await client.query(`INSERT INTO gcs_kv (key, type, value, "expiresAt") VALUES ($1, 'hash', NULL, NULL) ON CONFLICT (key) DO NOTHING`, [key]);
      await client.query(`INSERT INTO gcs_kv_items (key, field, value) VALUES ($1, $2, $3) ON CONFLICT (key, field) DO UPDATE SET value = EXCLUDED.value`, [key, field, value]);
      return 1;
    },
    async del(...keys) {
      if (keys.length === 0) return 0;
      return (await client.query(`DELETE FROM gcs_kv WHERE key = ANY($1::text[])`, [keys])).rowCount;
    },
    async keys(pattern) {
      const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
      const like = prefix.replace(/[\\%_]/g, "\\$&") + (pattern.endsWith("*") ? "%" : "");
      const r = await client.query<{ key: string }>(`SELECT key FROM gcs_kv WHERE key LIKE $1 AND ${live.replace("$NOW", "$2")}`, [like, now()]);
      return r.rows.map((row) => row.key);
    },
    disconnect() {
      void client.end().catch(() => {});
    },
  };
}
