/** Cheia în care `gcs-worker` își scrie heartbeat-ul (timestamp în ms). */
export const WORKER_HEARTBEAT_KEY = "gcs:worker:heartbeat";
/** Fără heartbeat de 10 minute, worker-ul e considerat oprit (spec etapa 3 §5). */
export const WORKER_STALE_MS = 10 * 60_000;

/** Structural, ca `core` să nu depindă de tipurile ioredis (ioredis le satisface așa cum e). */
export interface GcsHeartbeatRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
}

export type GcsWorkerStatus = { up: boolean; lastBeatAt: Date | null };

export async function writeWorkerHeartbeat(redis: GcsHeartbeatRedis, now = Date.now()): Promise<void> {
  await redis.set(WORKER_HEARTBEAT_KEY, String(now), "EX", 24 * 3600);
}

export async function workerStatus(redis: GcsHeartbeatRedis, now = Date.now()): Promise<GcsWorkerStatus> {
  const raw = await redis.get(WORKER_HEARTBEAT_KEY);
  const at = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(at)) return { up: false, lastBeatAt: null };
  return { up: now - at <= WORKER_STALE_MS, lastBeatAt: new Date(at) };
}
