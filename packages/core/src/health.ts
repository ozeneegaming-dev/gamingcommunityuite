/**
 * Verificarea de sănătate pentru `/api/health` (spec §17).
 *
 * Tipurile sunt structurale, ca `core` să nu depindă direct de Prisma:
 * `PrismaClient` și `GcsKv` (Redis în VPS, baza de date în Lite) le satisfac așa cum sunt.
 */
export interface GcsHealthDb {
  $queryRawUnsafe(query: string): Promise<unknown>;
}

export interface GcsHealthKv {
  ping(): Promise<unknown>;
}

export type GcsHealthReport = {
  status: "ok" | "degraded";
  db: boolean;
  /** Stocarea cheilor (Redis în VPS, baza de date în Lite); numele `redis` rămâne pentru CLI și ACP. */
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
  deps: { db: GcsHealthDb; kv: GcsHealthKv },
  opts: { timeoutMs?: number } = {},
): Promise<GcsHealthReport> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [db, redis] = await Promise.all([
    settlesInTime(() => deps.db.$queryRawUnsafe("SELECT 1"), timeoutMs),
    settlesInTime(async () => {
      if ((await deps.kv.ping()) === false) throw new Error("ping");
    }, timeoutMs),
  ]);
  return { status: db && redis ? "ok" : "degraded", db, redis };
}
