import type { GcsKv } from "../infra/kv";

/** Hash-ul (`GcsKv`) cu ultima rulare a fiecărui job: câmpul = numele jobului, valoarea = `GcsJobRunStat` în JSON. */
export const JOB_STATS_KEY = "gcs:jobs:stats";

/** Ultima rulare a unui job (ACP › Sistem › Stare sistem): momentele în ms, durata, eroarea și contoarele. */
export type GcsJobRunStat = {
  lastStartAt: number;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  durationMs: number;
  runs: number;
  failures: number;
};

/** Ce primește înregistratorul după fiecare rulare (reușită sau nu). */
export type GcsJobRunRecorder = (name: string, run: { startedAt: number; durationMs: number; error?: unknown }) => Promise<void>;

function parse(raw: string | null | undefined): GcsJobRunStat | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as GcsJobRunStat;
    return typeof v.lastStartAt === "number" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Notează o rulare. Citire + scriere fără tranzacție: două rulări simultane ale aceluiași job pot pierde un contor,
 * ceea ce e acceptabil pentru o pagină de stare (momentele și eroarea rămân ale ultimei rulări terminate).
 */
export async function recordJobRun(kv: GcsKv, name: string, run: { startedAt: number; durationMs: number; error?: unknown }): Promise<void> {
  const [raw] = await kv.hmget(JOB_STATS_KEY, [name]);
  const prev = parse(raw);
  const failed = run.error !== undefined;
  const message = failed ? (run.error instanceof Error ? run.error.message : String(run.error)).slice(0, 500) : null;
  const next: GcsJobRunStat = {
    lastStartAt: run.startedAt,
    lastOkAt: failed ? (prev?.lastOkAt ?? null) : run.startedAt + run.durationMs,
    lastErrorAt: failed ? run.startedAt + run.durationMs : (prev?.lastErrorAt ?? null),
    lastError: failed ? message : (prev?.lastError ?? null),
    durationMs: run.durationMs,
    runs: (prev?.runs ?? 0) + 1,
    failures: (prev?.failures ?? 0) + (failed ? 1 : 0),
  };
  await kv.hset(JOB_STATS_KEY, { [name]: JSON.stringify(next) });
}

/** Toate rulările notate, pe numele jobului. */
export async function readJobStats(kv: GcsKv): Promise<Record<string, GcsJobRunStat>> {
  const all = await kv.hgetall(JOB_STATS_KEY);
  const out: Record<string, GcsJobRunStat> = {};
  for (const [name, raw] of Object.entries(all)) {
    const stat = parse(raw);
    if (stat) out[name] = stat;
  }
  return out;
}
