import type { GcsKv } from "../infra/kv";

/** Cheia în care `gcs-worker` își scrie heartbeat-ul (timestamp în ms). */
export const WORKER_HEARTBEAT_KEY = "gcs:worker:heartbeat";
/** Fără heartbeat de 10 minute, worker-ul e considerat oprit (spec etapa 3 §5). */
export const WORKER_STALE_MS = 10 * 60_000;

/** Unde se scrie heartbeat-ul: `GcsKv` (Redis în VPS, baza de date în Lite). */
export type GcsHeartbeatRedis = Pick<GcsKv, "get" | "set">;

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
  await redis.set(serviceHeartbeatKey(name), String(now), { ttlMs: 24 * 3600_000 });
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

/**
 * Starea serviciului live: în VPS, heartbeat-ul lui `gcs-realtime`; în Lite nu există un serviciu separat (SSE și
 * polling rulează în procesul web), deci e pornit cât timp site-ul răspunde.
 */
export async function realtimeStatus(redis: GcsHeartbeatRedis, edition: "vps" | "lite", now = Date.now()): Promise<GcsServiceStatus> {
  if (edition === "lite") return { up: true, lastBeatAt: new Date(now) };
  return serviceStatus(redis, "realtime", now);
}
