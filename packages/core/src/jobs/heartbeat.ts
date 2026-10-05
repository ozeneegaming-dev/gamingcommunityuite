/** Cheia în care `gcs-worker` își scrie heartbeat-ul (timestamp în ms). */
export const WORKER_HEARTBEAT_KEY = "gcs:worker:heartbeat";
/** Fără heartbeat de 10 minute, worker-ul e considerat oprit (spec etapa 3 §5). */
export const WORKER_STALE_MS = 10 * 60_000;

/** Structural, ca `core` să nu depindă de tipurile ioredis (ioredis le satisface așa cum e). */
export interface GcsHeartbeatRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
}

export type GcsServiceName = "worker" | "realtime";
export type GcsServiceStatus = { up: boolean; lastBeatAt: Date | null };
/** Numele din etapa 3. */
export type GcsWorkerStatus = GcsServiceStatus;

/** `gcs-realtime` bate la 30 s, deci e considerat oprit mai repede decât worker-ul. */
const STALE_MS: Record<GcsServiceName, number> = { worker: WORKER_STALE_MS, realtime: 2 * 60_000 };

export function serviceHeartbeatKey(name: GcsServiceName): string {
  return name === "worker" ? WORKER_HEARTBEAT_KEY : `gcs:${name}:heartbeat`;
}

export async function writeServiceHeartbeat(redis: GcsHeartbeatRedis, name: GcsServiceName, now = Date.now()): Promise<void> {
  await redis.set(serviceHeartbeatKey(name), String(now), "EX", 24 * 3600);
}

export async function serviceStatus(redis: GcsHeartbeatRedis, name: GcsServiceName, now = Date.now()): Promise<GcsServiceStatus> {
  const raw = await redis.get(serviceHeartbeatKey(name));
  const at = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(at)) return { up: false, lastBeatAt: null };
  return { up: now - at <= STALE_MS[name], lastBeatAt: new Date(at) };
}

export function writeWorkerHeartbeat(redis: GcsHeartbeatRedis, now = Date.now()): Promise<void> {
  return writeServiceHeartbeat(redis, "worker", now);
}

export function workerStatus(redis: GcsHeartbeatRedis, now = Date.now()): Promise<GcsServiceStatus> {
  return serviceStatus(redis, "worker", now);
}
