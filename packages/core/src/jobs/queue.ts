import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";

export type GcsJobData = Record<string, unknown>;
export type GcsJobHandler = (data: GcsJobData) => Promise<void>;

/**
 * Un job declarat de un modul. `everyMs` / `pattern` (cron) îl fac repetabil: worker-ul îl programează la pornire.
 * Handler-ul trebuie să fie idempotent: un job poate rula de mai multe ori (reîncercări, rulări paralele).
 */
export type GcsJobDef = { name: string; handler: GcsJobHandler; everyMs?: number; pattern?: string };

export type GcsEnqueueOptions = {
  /** Același `jobId` cât timp jobul încă așteaptă = un singur job (deduplicare). BullMQ nu acceptă `:` în id. */
  jobId?: string;
  delayMs?: number;
};

const DEFAULT_QUEUE = "gcs";

/**
 * Coada de joburi (spec §2.1, BullMQ peste Redis). `web` doar adaugă joburi; `gcs-worker` le rulează (`start`).
 * Logica joburilor stă în serviciile modulelor; aici se face doar programarea.
 */
export class GcsJobQueue {
  private readonly defs = new Map<string, GcsJobDef>();
  private queue: Queue | undefined;
  private connection: Redis | undefined;

  constructor(private readonly opts: { redisUrl: string; name?: string; prefix?: string }) {}

  private get queueName(): string {
    return this.opts.name ?? DEFAULT_QUEUE;
  }

  private connect(): Redis {
    // BullMQ cere `maxRetriesPerRequest: null` (comenzile blocante ale worker-ului nu au voie să expire).
    this.connection ??= new Redis(this.opts.redisUrl, { maxRetriesPerRequest: null });
    return this.connection;
  }

  private getQueue(): Queue {
    this.queue ??= new Queue(this.queueName, {
      connection: this.connect(),
      prefix: this.opts.prefix ?? "gcs",
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: { count: 1000 },
      },
    });
    return this.queue;
  }

  register(def: GcsJobDef): void {
    if (this.defs.has(def.name)) throw new Error(`Jobul „${def.name}” e deja înregistrat`);
    this.defs.set(def.name, def);
  }

  registered(): GcsJobDef[] {
    return [...this.defs.values()];
  }

  async enqueue(name: string, data: GcsJobData = {}, opts: GcsEnqueueOptions = {}): Promise<void> {
    await this.getQueue().add(name, data, {
      ...(opts.jobId ? { jobId: opts.jobId } : {}),
      ...(opts.delayMs ? { delay: opts.delayMs } : {}),
    });
  }

  /**
   * Programează (sau reprogramează) un job repetabil adăugat la rulare (ex. jobul periodic al unui plugin): `id` e
   * cheia programării, `name` jobul înregistrat care rulează, cu `data`. Idempotent.
   */
  async upsertScheduler(id: string, everyMs: number, job: { name: string; data: GcsJobData }): Promise<void> {
    await this.getQueue().upsertJobScheduler(id, { every: everyMs }, { name: job.name, data: job.data });
  }

  /** Șterge o programare adăugată cu `upsertScheduler` (lipsa ei nu e o eroare). */
  async removeScheduler(id: string): Promise<void> {
    await this.getQueue().removeJobScheduler(id);
  }

  /** Programările existente al căror id începe cu `prefix`. */
  async schedulerIds(prefix: string): Promise<string[]> {
    const list = await this.getQueue().getJobSchedulers(0, 999);
    return list.map((s) => s.key).filter((key): key is string => typeof key === "string" && key.startsWith(prefix));
  }

  /**
   * Pornește procesarea (doar în `gcs-worker`): programează joburile repetabile și rulează handler-ele.
   * Întoarce funcția de oprire.
   */
  async start(opts: { concurrency?: number; onError?: (name: string, error: unknown) => void } = {}): Promise<() => Promise<void>> {
    const queue = this.getQueue();
    for (const def of this.defs.values()) {
      if (def.everyMs || def.pattern) {
        await queue.upsertJobScheduler(def.name, def.everyMs ? { every: def.everyMs } : { pattern: def.pattern! }, { name: def.name, data: {} });
      }
    }
    const worker = new Worker(
      this.queueName,
      async (job: Job) => {
        const def = this.defs.get(job.name);
        if (!def) throw new Error(`Job necunoscut: ${job.name}`);
        await def.handler((job.data ?? {}) as GcsJobData);
      },
      { connection: this.connect().duplicate(), prefix: this.opts.prefix ?? "gcs", concurrency: opts.concurrency ?? 4 },
    );
    worker.on("failed", (job, error) => opts.onError?.(job?.name ?? "?", error));
    worker.on("error", (error) => opts.onError?.("worker", error));
    await worker.waitUntilReady();
    return async () => {
      await worker.close();
    };
  }

  async close(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
    this.queue = undefined;
    this.connection = undefined;
  }
}

/**
 * Cheie de deduplicare pe ferestre de timp: toate evenimentele unui user din aceeași fereastră produc un singur job,
 * programat după sfârșitul ferestrei (cu `delayMs = windowMs`), deci vede toate scrierile din fereastră.
 */
export function debouncedJobId(base: string, windowMs: number, now = Date.now()): string {
  return `${base}-${Math.floor(now / windowMs)}`;
}
