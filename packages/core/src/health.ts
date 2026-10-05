/**
 * Verificarea de sănătate pentru `/api/health` (spec §17).
 *
 * Tipurile sunt structurale, ca `core` să nu depindă direct de Prisma sau ioredis:
 * `PrismaClient` și `Redis` (ioredis) le satisfac așa cum sunt.
 */
export interface GcsHealthDb {
  $queryRawUnsafe(query: string): Promise<unknown>;
}

export interface GcsHealthRedis {
  ping(): Promise<string>;
}

export type GcsHealthReport = {
  status: "ok" | "degraded";
  db: boolean;
  redis: boolean;
};

const DEFAULT_TIMEOUT_MS = 2000;

/** `true` dacă promisiunea se rezolvă înainte de timeout, `false` la eroare sau timeout. */
async function settlesInTime(task: () => Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([task().then(() => true as const), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(
  deps: { db: GcsHealthDb; redis: GcsHealthRedis },
  opts: { timeoutMs?: number } = {},
): Promise<GcsHealthReport> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [db, redis] = await Promise.all([
    settlesInTime(() => deps.db.$queryRawUnsafe("SELECT 1"), timeoutMs),
    settlesInTime(() => deps.redis.ping(), timeoutMs),
  ]);
  return { status: db && redis ? "ok" : "degraded", db, redis };
}
