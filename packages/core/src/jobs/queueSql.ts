import type { PrismaClient } from "@gcs/db";
import { nextCronTime } from "./cron";
import { GcsJobRegistry, type GcsEnqueueOptions, type GcsJobData, type GcsJobQueue, type GcsJobStartOptions } from "./queue";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 2000;
/** Cât ține un job „în lucru” până e considerat abandonat (procesul oprit de gazdă) și reluat. */
const LEASE_MS = 10 * 60_000;
/** Câte joburi eșuate definitiv se păstrează (ca `removeOnFail: { count: 1000 }` din BullMQ). */
const KEEP_FAILED = 1000;
const DEFAULT_TICK_MS = 5_000;

export type GcsJobRunReport = { ran: number; failed: number; scheduled: number; pending: number; elapsedMs: number };

/**
 * Coada de joburi în baza de date (ediția Lite, fără Redis și fără proces permanent): `gcs_jobs` și
 * `gcs_job_schedules`. Joburile rulează când cineva cheamă `runDue` — cron-ul (`/api/cron`, `cron.mjs`), bucla din
 * proces (`start`, cât timp gazda ține procesul pornit) și rulările oportuniste de după cereri — fiecare cu o limită de
 * timp. Revendicarea e optimistă (`UPDATE … WHERE status = …`), deci mai multe procese pot rula `runDue` deodată.
 * Semantica e a cozii BullMQ: deduplicare pe `jobId`, 5 încercări cu backoff exponențial, joburi repetabile.
 */
export class GcsSqlJobQueue extends GcsJobRegistry implements GcsJobQueue {
  readonly driver = "sql" as const;
  private schedulesReady = false;
  private running: Promise<GcsJobRunReport> | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly opts: { now?: () => number; tickMs?: number } = {},
  ) {
    super();
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  async enqueue(name: string, data: GcsJobData = {}, opts: GcsEnqueueOptions = {}): Promise<void> {
    const now = this.now();
    await this.db.gcsJob.createMany({
      data: [{ name, data: JSON.stringify(data), jobKey: opts.jobId ?? null, runAt: BigInt(now + (opts.delayMs ?? 0)), createdAt: BigInt(now), maxAttempts: MAX_ATTEMPTS }],
      // Același `jobId` cât timp jobul există (așteaptă, rulează sau a eșuat definitiv) = un singur job.
      skipDuplicates: true,
    });
  }

  async upsertScheduler(id: string, everyMs: number, job: { name: string; data: GcsJobData }): Promise<void> {
    const data = JSON.stringify(job.data);
    await this.db.gcsJobSchedule.upsert({
      where: { id },
      create: { id, name: job.name, data, everyMs, pattern: null, nextRunAt: BigInt(this.now()) },
      update: { name: job.name, data, everyMs, pattern: null },
    });
  }

  async removeScheduler(id: string): Promise<void> {
    await this.db.gcsJobSchedule.deleteMany({ where: { id } });
  }

  async schedulerIds(prefix: string): Promise<string[]> {
    const rows = await this.db.gcsJobSchedule.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Programările joburilor repetabile înregistrate (o dată pe proces). */
  private async ensureSchedules(): Promise<void> {
    if (this.schedulesReady) return;
    for (const def of this.defs.values()) {
      if (def.everyMs) await this.upsertScheduler(def.name, def.everyMs, { name: def.name, data: {} });
      else if (def.pattern) {
        nextCronTime(def.pattern, this.now());
        await this.db.gcsJobSchedule.upsert({
          where: { id: def.name },
          create: { id: def.name, name: def.name, data: "{}", everyMs: null, pattern: def.pattern, nextRunAt: BigInt(nextCronTime(def.pattern, this.now())) },
          update: { name: def.name, everyMs: null, pattern: def.pattern },
        });
      }
    }
    this.schedulesReady = true;
  }

  /** Programările scadente devin joburi (o singură dată, chiar dacă mai multe procese rulează deodată). */
  private async materializeSchedules(now: number): Promise<number> {
    const due = await this.db.gcsJobSchedule.findMany({ where: { nextRunAt: { lte: BigInt(now) } } });
    let added = 0;
    for (const s of due) {
      // Următoarea rulare sare peste ferestrele pierdute (gazda a ținut procesul oprit): nu se adună restanțe.
      const every = Math.max(1000, s.everyMs ?? 60_000);
      const next = s.pattern ? nextCronTime(s.pattern, now) : Number(s.nextRunAt) + every * Math.max(1, Math.ceil((now - Number(s.nextRunAt) + 1) / every));
      const claimed = await this.db.gcsJobSchedule.updateMany({ where: { id: s.id, nextRunAt: s.nextRunAt }, data: { nextRunAt: BigInt(next) } });
      if (claimed.count !== 1) continue;
      await this.enqueue(s.name, JSON.parse(s.data) as GcsJobData, { jobId: `sched-${s.id}-${s.nextRunAt}` });
      added++;
    }
    return added;
  }

  /** Revendică următorul job scadent (sau unul abandonat de un proces oprit); `null` = nimic de făcut. */
  private async claim(now: number) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const job = await this.db.gcsJob.findFirst({
        where: {
          OR: [
            { status: "waiting", runAt: { lte: BigInt(now) } },
            { status: "running", lockedUntil: { lt: BigInt(now) } },
          ],
        },
        orderBy: [{ runAt: "asc" }, { id: "asc" }],
      });
      if (!job) return null;
      // Jobul pornit își eliberează cheia (`jobKey`): un `enqueue` cu aceeași cheie în timpul rulării (ex. evaluarea
      // „debounced” a unui membru care tocmai a mai postat) e un job nou, rulat după, nu unul pierdut.
      const taken = await this.db.gcsJob.updateMany({
        where: { id: job.id, status: job.status, attempts: job.attempts },
        data: { status: "running", attempts: job.attempts + 1, lockedUntil: BigInt(now + LEASE_MS), jobKey: null },
      });
      if (taken.count === 1) return { ...job, attempts: job.attempts + 1 };
    }
    return null;
  }

  private async runOne(job: { id: bigint; name: string; data: string; attempts: number; maxAttempts: number }, onError?: GcsJobStartOptions["onError"]): Promise<boolean> {
    const def = this.defs.get(job.name);
    try {
      if (!def) throw new Error(`Job necunoscut: ${job.name}`);
      await def.handler(JSON.parse(job.data) as GcsJobData);
      await this.db.gcsJob.deleteMany({ where: { id: job.id } });
      return true;
    } catch (error) {
      onError?.(job.name, error);
      const message = error instanceof Error ? error.message : String(error);
      if (job.attempts >= job.maxAttempts) {
        await this.db.gcsJob.updateMany({ where: { id: job.id }, data: { status: "failed", lockedUntil: null, lastError: message.slice(0, 2000) } });
        await this.pruneFailed();
      } else {
        const delay = BACKOFF_MS * 2 ** (job.attempts - 1);
        await this.db.gcsJob.updateMany({ where: { id: job.id }, data: { status: "waiting", lockedUntil: null, runAt: BigInt(this.now() + delay), lastError: message.slice(0, 2000) } });
      }
      return false;
    }
  }

  private async pruneFailed(): Promise<void> {
    const keep = await this.db.gcsJob.findMany({ where: { status: "failed" }, orderBy: { id: "desc" }, skip: KEEP_FAILED - 1, take: 1, select: { id: true } });
    if (keep[0]) await this.db.gcsJob.deleteMany({ where: { status: "failed", id: { lt: keep[0].id } } });
  }

  /**
   * Rulează joburile scadente până se termină sau până trece `budgetMs` (un job început se termină). Un singur
   * `runDue` pe proces deodată: un al doilea apel primește rezultatul celui în curs.
   */
  runDue(opts: { budgetMs?: number; concurrency?: number; onError?: GcsJobStartOptions["onError"] } = {}): Promise<GcsJobRunReport> {
    this.running ??= this.drain(opts).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(opts: { budgetMs?: number; concurrency?: number; onError?: GcsJobStartOptions["onError"] }): Promise<GcsJobRunReport> {
    const started = this.now();
    const budget = opts.budgetMs ?? 25_000;
    await this.ensureSchedules();
    const scheduled = await this.materializeSchedules(started);
    let ran = 0;
    let failed = 0;
    const lane = async () => {
      while (this.now() - started < budget) {
        const job = await this.claim(this.now());
        if (!job) return;
        if (await this.runOne(job, opts.onError)) ran++;
        else failed++;
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, lane));
    const pending = await this.db.gcsJob.count({ where: { status: "waiting", runAt: { lte: BigInt(this.now()) } } });
    return { ran, failed, scheduled, pending, elapsedMs: this.now() - started };
  }

  /** Bucla din proces (modul „un singur proces”): `runDue` la fiecare `tickMs`, cât timp procesul trăiește. */
  async start(opts: GcsJobStartOptions = {}): Promise<() => Promise<void>> {
    await this.ensureSchedules();
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const tick = async () => {
      if (stopped) return;
      await this.runDue({ budgetMs: 20_000, concurrency: opts.concurrency ?? 2, ...(opts.onError ? { onError: opts.onError } : {}) }).catch((error: unknown) => opts.onError?.("runDue", error));
      if (!stopped) {
        timer = setTimeout(() => void tick(), this.opts.tickMs ?? DEFAULT_TICK_MS);
        timer.unref?.();
      }
    };
    timer = setTimeout(() => void tick(), 0);
    timer.unref?.();
    return async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await this.running?.catch(() => {});
    };
  }

  /** Starea cozii (ACP → Sistem, pasul Cron al installer-ului). */
  async stats(): Promise<{ waiting: number; running: number; failed: number; schedules: number }> {
    const [waiting, running, failed, schedules] = await Promise.all([
      this.db.gcsJob.count({ where: { status: "waiting" } }),
      this.db.gcsJob.count({ where: { status: "running" } }),
      this.db.gcsJob.count({ where: { status: "failed" } }),
      this.db.gcsJobSchedule.count(),
    ]);
    return { waiting, running, failed, schedules };
  }

  async close(): Promise<void> {
    await this.running?.catch(() => {});
  }
}
