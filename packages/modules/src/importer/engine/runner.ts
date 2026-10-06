import { normalizeEmail, type GcsActor } from "@gcs/core";
import type { ImportJob, Prisma } from "@gcs/db";
import { convertContent, renderImported } from "../convert";
import type { GcsConvertContext } from "../convert/context";
import type { GcsImportFiles } from "../source/files";
import type { GcsSourceAdapter } from "../types";
import { errorMessage, GcsStepContext } from "./context";
import { GcsImportMap } from "./map";
import { importAttachments, importConversations, importPosts, importStatuses } from "./steps/content";
import { finalizeImport } from "./steps/finalize";
import { importForums, importPrefixes, importTopics } from "./steps/forums";
import { importGroups, importMembers, importProfileFields } from "./steps/members";
import { importFollows, importReactions, importWarnings } from "./steps/social";
import {
  GcsImportStop,
  type GcsImportConfig,
  type GcsImportDetected,
  type GcsImportEngineDeps,
  type GcsImportStepKey,
  type GcsImportStepState,
} from "./types";

/** Sursa deschisă pentru o rulare: adaptorul, fișierele (opțional) și închiderea conexiunii. */
export type GcsOpenedSource = { adapter: GcsSourceAdapter; files: GcsImportFiles | null; close: () => Promise<void> };

const STEP_FNS: Record<GcsImportStepKey, (s: GcsStepContext) => Promise<void>> = {
  groups: importGroups,
  members: importMembers,
  profile_fields: importProfileFields,
  forums: importForums,
  prefixes: importPrefixes,
  topics: importTopics,
  attachments: importAttachments,
  posts: importPosts,
  reactions: importReactions,
  conversations: importConversations,
  follows: importFollows,
  warnings: importWarnings,
  statuses: importStatuses,
  finalize: finalizeImport,
};

/** Câte rânduri de jurnal păstrează un import (erorile se numără oricum în raport). */
const MAX_LOGS = 5000;
/** Un worker care nu mai scrie progresul de atâta timp e considerat căzut: altul poate relua importul. */
export const IMPORT_STALE_MS = 3 * 60_000;

/** Un context permisiv pentru rularea de probă: orice referință „există”, deci se numără doar marcajele necunoscute. */
function permissiveContext(schema: GcsConvertContext["schema"], oldUrl: string | null): GcsConvertContext {
  return {
    schema,
    oldUrl,
    member: () => ({ id: "membru", name: "Membru" }),
    memberByName: (name) => ({ id: "membru", name }),
    post: () => ({ id: 1, topicId: 1 }),
    topic: () => ({ id: 1, slug: "topic" }),
    forum: () => ({ id: 1, slug: "forum" }),
    attachment: (id) => ({ id: `a${id}`.slice(0, 40), isImage: true, filename: "fisier.png", width: null, height: null }),
  };
}

/**
 * Rularea unui import în `gcs-worker`: pașii în ordine, de la checkpoint-ul salvat, cu pauză, anulare și jurnal.
 * Un singur worker rulează un import: starea trece atomic `QUEUED → RUNNING` (sau preia un import căzut).
 */
export class GcsImportRunner {
  constructor(
    private readonly deps: GcsImportEngineDeps,
    private readonly openSource: (job: ImportJob) => Promise<GcsOpenedSource>,
    private readonly onDone: (jobId: string) => Promise<void> = async () => {},
  ) {}

  async run(jobId: string): Promise<void> {
    const { db } = this.deps;
    const now = new Date();
    const claimed = await db.importJob.updateMany({
      where: { id: jobId, OR: [{ status: "QUEUED" }, { status: "RUNNING", heartbeatAt: { lt: new Date(now.getTime() - IMPORT_STALE_MS) } }] },
      data: { status: "RUNNING", heartbeatAt: now, error: null },
    });
    if (claimed.count === 0) return;
    const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
    if (!job.startedAt) await db.importJob.update({ where: { id: jobId }, data: { startedAt: now } });
    let source: GcsOpenedSource | null = null;
    const steps = (job.steps as unknown as GcsImportStepState[]) ?? [];
    let logs = await db.importLog.count({ where: { jobId } });
    const log = async (step: string, level: "info" | "warn" | "error", message: string, sourceId?: string) => {
      if (logs >= MAX_LOGS) return;
      logs++;
      await db.importLog.create({ data: { jobId, step, level, message: message.slice(0, 500), sourceId: sourceId ?? null } });
    };
    const save = async (currentStep: string | null) => {
      await db.importJob.update({ where: { id: jobId }, data: { steps: steps as unknown as Prisma.InputJsonValue, currentStep, heartbeatAt: new Date() } });
    };
    const checkpoint = async (currentStep: string | null) => {
      await save(currentStep);
      const { control } = await db.importJob.findUniqueOrThrow({ where: { id: jobId }, select: { control: true } });
      if (control === "pause" || control === "cancel") throw new GcsImportStop(control);
    };
    try {
      source = await this.openSource(job);
      if (job.dryRun) await this.dryRun(job, source, steps, checkpoint);
      else await this.runSteps(job, source, steps, log, checkpoint);
      await db.importJob.update({ where: { id: jobId }, data: { status: "DONE", control: null, currentStep: null, finishedAt: new Date(), steps: steps as unknown as Prisma.InputJsonValue } });
      await this.onDone(jobId);
    } catch (error) {
      if (error instanceof GcsImportStop) {
        await db.importJob.update({
          where: { id: jobId },
          data: { status: error.kind === "pause" ? "PAUSED" : "CANCELLED", control: null, steps: steps as unknown as Prisma.InputJsonValue, ...(error.kind === "cancel" ? { finishedAt: new Date() } : {}) },
        });
      } else {
        const message = errorMessage(error);
        for (const s of steps) if (s.status === "running") s.status = "failed";
        await log("run", "error", message);
        await db.importJob.update({ where: { id: jobId }, data: { status: "FAILED", control: null, error: message, steps: steps as unknown as Prisma.InputJsonValue, finishedAt: new Date() } });
      }
    } finally {
      await source?.close().catch(() => {});
    }
  }

  private async actorFor(job: ImportJob): Promise<GcsActor> {
    const { db, actors } = this.deps;
    let userId = job.createdById;
    if (!userId || !(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      userId = (await db.user.findFirst({ where: { primaryGroup: { key: "root_admin" } }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
    }
    if (!userId) throw new Error("no_admin");
    return actors.forUser(userId, "127.0.0.1");
  }

  private async runSteps(
    job: ImportJob,
    source: GcsOpenedSource,
    steps: GcsImportStepState[],
    log: (step: string, level: "info" | "warn" | "error", message: string, sourceId?: string) => Promise<void>,
    checkpoint: (currentStep: string | null) => Promise<void>,
  ): Promise<void> {
    const config = job.config as unknown as GcsImportConfig;
    const detected = job.detected as unknown as GcsImportDetected | null;
    const map = new GcsImportMap(this.deps.db, job.mapKey);
    const [actor, render] = await Promise.all([this.actorFor(job), this.deps.renderOptions()]);
    for (const state of steps) {
      if (state.status === "done" || state.status === "skipped") continue;
      if (state.status !== "running") {
        state.status = "running";
        state.startedAt ??= new Date().toISOString();
      }
      await checkpoint(state.key);
      const ctx = new GcsStepContext(
        this.deps,
        { id: job.id, config, postsPerPage: detected?.postsPerPage ?? 20 },
        source.adapter,
        source.files,
        map,
        state,
        actor,
        render,
        { log: (level, message, sourceId) => log(state.key, level, message, sourceId), checkpoint: () => checkpoint(state.key) },
      );
      await STEP_FNS[state.key](ctx);
      state.status = "done";
      state.cursor = null;
      state.finishedAt = new Date().toISOString();
      await checkpoint(null);
    }
  }

  /**
   * Rularea de probă („doar numără”): numerele pe tip, conturile care s-ar lega după email și o probă de conversie
   * pe primele 200 de postări. Nu scrie nimic în tabelele site-ului.
   */
  private async dryRun(job: ImportJob, source: GcsOpenedSource, steps: GcsImportStepState[], checkpoint: (currentStep: string | null) => Promise<void>): Promise<void> {
    const { db } = this.deps;
    const { adapter } = source;
    const counts = await adapter.counts();
    for (const s of steps) {
      if (s.key in counts) s.total = counts[s.key as keyof typeof counts];
      s.status = "done";
    }
    let linkedByEmail = 0;
    let cursor: string | null = null;
    do {
      const batch = await adapter.members(cursor, 1000);
      const emails = batch.rows.map((m) => normalizeEmail(m.email)).filter(Boolean);
      linkedByEmail += await db.user.count({ where: { email: { in: emails } } });
      cursor = batch.next;
      await checkpoint("members");
    } while (cursor !== null);

    const config = job.config as unknown as GcsImportConfig;
    const ctx = permissiveContext(adapter.schema, config.oldUrl || null);
    const render = await this.deps.renderOptions();
    const posts = await adapter.posts(null, 200);
    let unrecognized = 0;
    let fallbacks = 0;
    for (const p of posts.rows) {
      const result = convertContent(adapter.format, p.content, ctx);
      if (result.unrecognized > 0) unrecognized++;
      if (renderImported(result.doc, adapter.format, p.content, render).fallback) fallbacks++;
    }
    const detected = (job.detected ?? {}) as unknown as GcsImportDetected;
    await db.importJob.update({
      where: { id: job.id },
      data: { detected: { ...detected, counts, dryRun: { linkedByEmail, sampledPosts: posts.rows.length, unrecognized, fallbacks } } as unknown as Prisma.InputJsonValue },
    });
  }
}
