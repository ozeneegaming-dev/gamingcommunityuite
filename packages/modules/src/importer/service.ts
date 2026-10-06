import {
  checkFetchUrl,
  GcsConflict,
  GcsNotFound,
  GcsValidationError,
  openSecret,
  sealSecret,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsCache,
  type GcsJobQueue,
  type GcsSettingsService,
} from "@gcs/core";
import { Prisma, type ImportJob, type ImportStatus } from "@gcs/db";
import { isAbsolute } from "node:path";
import { GcsImportRunner, IMPORT_STALE_MS, type GcsOpenedSource } from "./engine/runner";
import {
  GCS_IMPORT_OPTIONS,
  GCS_IMPORT_STEPS,
  type GcsImportConfig,
  type GcsImportDetected,
  type GcsImportEngineDeps,
  type GcsImportOption,
  type GcsImportStepKey,
  type GcsImportStepState,
} from "./engine/types";
import { coreSchemaFixture, prefixedSchemaFixture, type GcsImportFixture } from "./fixtures";
import { GcsLegacyRedirects, legacyTopicPath, type GcsRedirectConfig } from "./redirects";
import { createAdapter, detectSchema, isSupportedVersion } from "./source/detect";
import { folderFiles, memoryFiles, urlFiles, type GcsImportFiles } from "./source/files";
import { createMemoryReader, createMysqlReader, type GcsSourceReader } from "./source/reader";
import type { GcsImportEntity, GcsImportSchema } from "./types";

/** Secțiunea ACP a importului (ACP → Sistem → Conversii → Import din altă platformă). */
export const IMPORT_ACP_SECTION = "system.import";
/** Jobul din `gcs-worker` care rulează un import. */
export const IMPORT_JOB = "import.run";
/** Fișierele mai mari decât atât nu se copiază (ca limita maximă de upload). */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type GcsImportConfigInput = Omit<GcsImportConfig, "options" | "redirects"> & { password?: string };

export type GcsImportView = {
  id: string;
  status: ImportStatus;
  dryRun: boolean;
  config: GcsImportConfig;
  hasPassword: boolean;
  detected: GcsImportDetected | null;
  steps: GcsImportStepState[];
  currentStep: string | null;
  control: string | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
  /** Worker-ul nu mai scrie progresul (oprit sau căzut). */
  stale: boolean;
};

export type GcsImportLogView = { id: number; step: string; level: string; message: string; sourceId: string | null; createdAt: Date };

/** Câte înregistrări are fiecare pas, după numerele sursei. */
const STEP_ENTITY: Partial<Record<GcsImportStepKey, GcsImportEntity>> = {
  groups: "groups",
  members: "members",
  profile_fields: "profile_fields",
  forums: "forums",
  prefixes: "prefixes",
  topics: "topics",
  attachments: "attachments",
  posts: "posts",
  reactions: "reactions",
  conversations: "conversations",
  follows: "follows",
  warnings: "warnings",
  statuses: "statuses",
};

/** Pașii activi pentru opțiunile bifate (grupurile, membrii și finalizarea rulează mereu). */
export function enabledSteps(config: GcsImportConfig): Set<GcsImportStepKey> {
  const o = new Set(config.options);
  const on = new Set<GcsImportStepKey>(["groups", "members", "finalize"]);
  if (o.has("profile_fields")) on.add("profile_fields");
  if (o.has("forums")) for (const k of ["forums", "prefixes", "topics", "posts"] as const) on.add(k);
  if (o.has("attachments") && config.filesMode !== "none") on.add("attachments");
  if (o.has("reactions") && o.has("forums")) on.add("reactions");
  if (o.has("conversations")) on.add("conversations");
  if (o.has("follows")) on.add("follows");
  if (o.has("warnings")) on.add("warnings");
  if (o.has("statuses")) on.add("statuses");
  return on;
}

function initialSteps(config: GcsImportConfig, detected: GcsImportDetected | null): GcsImportStepState[] {
  const on = enabledSteps(config);
  return GCS_IMPORT_STEPS.map((key) => {
    const entity = STEP_ENTITY[key];
    return {
      key,
      status: on.has(key) ? "pending" : "skipped",
      total: entity && detected ? (detected.counts[entity] ?? 0) : 0,
      done: 0,
      imported: 0,
      skipped: 0,
      errors: 0,
      unrecognized: 0,
      cursor: null,
      startedAt: null,
      finishedAt: null,
    };
  });
}

/** Cheia hărții de id-uri: schema + host-ul adresei vechi (sau baza), comună rulărilor de pe aceeași comunitate. */
export function mapKeyFor(schema: string, config: Pick<GcsImportConfig, "oldUrl" | "database" | "host">): string {
  const host = config.oldUrl && URL.canParse(config.oldUrl) ? new URL(config.oldUrl).host.toLowerCase() : `${config.host}/${config.database}`.toLowerCase();
  return `${schema}@${host}`;
}

const HOST = /^[A-Za-z0-9.-]{1,253}$|^\[[0-9a-fA-F:]{2,45}\]$|^[0-9a-fA-F:]{2,45}$/;
const DB_NAME = /^[A-Za-z0-9_$.-]{1,64}$/;
const PREFIX = /^[A-Za-z0-9_]{0,20}$/;

/** Validează configurarea din formular; erorile sunt chei de traducere pe câmp. */
function validateConfig(input: GcsImportConfigInput): GcsImportConfig & { password?: string } {
  const errors: Record<string, string> = {};
  const host = input.host.trim();
  if (!HOST.test(host)) errors.host = "invalid_host";
  if (host === "fixture" && process.env.GCS_TEST_ROUTES !== "1") errors.host = "invalid_host";
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = "invalid_port";
  const database = input.database.trim();
  if (!DB_NAME.test(database)) errors.database = "invalid_name";
  const user = input.user.trim();
  if (host !== "fixture" && !DB_NAME.test(user)) errors.user = "invalid_name";
  const prefix = input.prefix.trim();
  if (!PREFIX.test(prefix)) errors.prefix = "invalid_prefix";
  const filesMode = (["none", "folder", "url"] as const).includes(input.filesMode) ? input.filesMode : "none";
  const filesPath = input.filesPath.trim();
  if (filesMode === "folder" && (!isAbsolute(filesPath) || filesPath.length > 500 || /[\u0000-\u001f]/.test(filesPath))) errors.filesPath = "invalid_path";
  if (filesMode === "url") {
    try {
      checkFetchUrl(filesPath);
    } catch {
      errors.filesPath = "invalid_url";
    }
  }
  const oldUrl = input.oldUrl.trim().replace(/\/+$/, "");
  if (oldUrl && !(URL.canParse(oldUrl) && ["http:", "https:"].includes(new URL(oldUrl).protocol))) errors.oldUrl = "invalid_url";
  if (input.password !== undefined && input.password.length > 200) errors.password = "too_long";
  if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
  return {
    host,
    port,
    database,
    user,
    prefix,
    filesMode,
    filesPath: filesMode === "none" ? "" : filesPath,
    oldUrl,
    options: [...GCS_IMPORT_OPTIONS],
    redirects: true,
    ...(input.password ? { password: input.password } : {}),
  };
}

/**
 * Importul din altă platformă (specul importului): configurarea și testul conexiunii din ACP, pornirea, pauza,
 * reluarea și anularea jobului din `gcs-worker`, raportul, jurnalul și redirecturile 301.
 * Parola bazei vechi se păstrează criptată și nu ajunge niciodată la client sau în jurnale.
 */
export class GcsImportService {
  readonly redirects: GcsLegacyRedirects;
  private readonly runner: GcsImportRunner;

  constructor(
    private readonly deps: GcsImportEngineDeps & {
      cache: GcsCache;
      jobs: GcsJobQueue;
      acp: GcsAcpRoleService;
      settings: GcsSettingsService;
      /** Sursele de test (`host = fixture`, doar cu `GCS_TEST_ROUTES=1`); testele le pot înlocui. */
      fixtures?: Record<GcsImportSchema, () => GcsImportFixture>;
    },
  ) {
    this.redirects = new GcsLegacyRedirects({ db: deps.db, cache: deps.cache, bus: deps.bus, settings: deps.settings });
    this.runner = new GcsImportRunner(deps, (job) => this.openSource(job), (jobId) => this.enableRedirectsAfterImport(jobId));
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({ name: IMPORT_JOB, handler: async (data) => this.runner.run(String(data.jobId ?? "")) });
  }

  /** Rulează un import (handler-ul jobului; și testele). */
  run(jobId: string): Promise<void> {
    return this.runner.run(jobId);
  }

  private view(job: ImportJob): GcsImportView {
    return {
      id: job.id,
      status: job.status,
      dryRun: job.dryRun,
      config: job.config as unknown as GcsImportConfig,
      hasPassword: job.secret !== null,
      detected: job.detected as unknown as GcsImportDetected | null,
      steps: job.steps as unknown as GcsImportStepState[],
      currentStep: job.currentStep,
      control: job.control,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      updatedAt: job.updatedAt,
      stale: job.status === "RUNNING" && (!job.heartbeatAt || Date.now() - job.heartbeatAt.getTime() > IMPORT_STALE_MS),
    };
  }

  async latest(actor: GcsActor): Promise<GcsImportView | null> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "view");
    const job = await this.deps.db.importJob.findFirst({ orderBy: { createdAt: "desc" } });
    return job ? this.view(job) : null;
  }

  async get(actor: GcsActor, id: string): Promise<GcsImportView> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "view");
    const job = await this.deps.db.importJob.findUnique({ where: { id } });
    if (!job) throw new GcsNotFound();
    return this.view(job);
  }

  private async load(id: string): Promise<ImportJob> {
    const job = await this.deps.db.importJob.findUnique({ where: { id } });
    if (!job) throw new GcsNotFound();
    return job;
  }

  /** Salvează configurarea (un import nou sau cel existent, dacă nu rulează). Parola goală = cea salvată rămâne. */
  async saveConfig(actor: GcsActor, input: GcsImportConfigInput, id?: string): Promise<GcsImportView> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "edit");
    const { password, ...config } = validateConfig(input);
    const { db } = this.deps;
    const running = await db.importJob.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
    if (running && running.id !== id) throw new GcsConflict({ reason: "import_running" });
    const existing = id ? await this.load(id) : null;
    if (existing && (existing.status === "QUEUED" || existing.status === "RUNNING")) throw new GcsConflict({ reason: "import_running" });
    const previous = existing ? (existing.config as unknown as GcsImportConfig) : null;
    const merged: GcsImportConfig = { ...config, options: previous?.options ?? config.options, redirects: previous?.redirects ?? config.redirects };
    const data = {
      config: merged as unknown as Prisma.InputJsonValue,
      status: "DRAFT" as const,
      detected: Prisma.DbNull,
      ...(password ? { secret: sealSecret(password) } : {}),
    };
    const job = existing
      ? await db.importJob.update({ where: { id: existing.id }, data: { ...data, error: null } })
      : await db.importJob.create({ data: { ...data, createdById: actor.userId } });
    return this.view(job);
  }

  /** Deschide sursa: baza veche (doar citire) sau, în E2E, sursa de test înregistrată. */
  private async openSource(job: ImportJob): Promise<GcsOpenedSource> {
    const config = job.config as unknown as GcsImportConfig;
    let reader: GcsSourceReader;
    let files: GcsImportFiles | null = null;
    if (config.host === "fixture" && process.env.GCS_TEST_ROUTES === "1") {
      const fixtures = this.deps.fixtures ?? { "core-schema": coreSchemaFixture, "prefixed-schema": prefixedSchemaFixture };
      const fixture = config.database === "prefixed-schema" ? fixtures["prefixed-schema"]() : fixtures["core-schema"]();
      reader = createMemoryReader(fixture.tables);
      files = config.filesMode === "none" ? null : memoryFiles(fixture.files);
    } else {
      const password = job.secret ? openSecret(job.secret) : "";
      if (password === null) throw new Error("secret_unreadable");
      reader = await createMysqlReader({ host: config.host, port: config.port, database: config.database, user: config.user, password });
      files = config.filesMode === "folder" ? folderFiles(config.filesPath, MAX_FILE_BYTES) : config.filesMode === "url" ? urlFiles(config.filesPath, MAX_FILE_BYTES) : null;
    }
    try {
      const detected = await detectSchema(reader, config.prefix);
      if (!detected) throw new Error("schema_not_detected");
      return { adapter: createAdapter(reader, detected), files, close: () => reader.close() };
    } catch (error) {
      await reader.close();
      throw error;
    }
  }

  /** „Testează conexiunea”: schema și versiunea detectate și numărul de înregistrări pe tip. */
  async testConnection(actor: GcsActor, id: string): Promise<GcsImportView> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "edit");
    const { db } = this.deps;
    const job = await this.load(id);
    if (job.status === "QUEUED" || job.status === "RUNNING") throw new GcsConflict({ reason: "import_running" });
    const config = job.config as unknown as GcsImportConfig;
    let source: GcsOpenedSource | null = null;
    try {
      source = await this.openSource(job);
      const { adapter } = source;
      const [version, counts, postsPerPage] = await Promise.all([adapter.version(), adapter.counts(), adapter.postsPerPage()]);
      const supported = isSupportedVersion(adapter.schema, version);
      const detected: GcsImportDetected = { schema: adapter.schema, prefix: "", version, supported, postsPerPage, counts };
      const updated = await db.importJob.update({
        where: { id },
        data: {
          status: supported ? "READY" : "DRAFT",
          source: adapter.schema,
          mapKey: mapKeyFor(adapter.schema, config),
          detected: detected as unknown as Prisma.InputJsonValue,
          error: supported ? null : "version_unsupported",
        },
      });
      await writeAudit(db, { actorId: actor.userId, action: "import.test", targetType: "import", targetId: id, after: { schema: adapter.schema, version, supported }, ip: actor.ip });
      return this.view(updated);
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 100) : "connect_failed";
      const updated = await db.importJob.update({ where: { id }, data: { status: "DRAFT", error: code } });
      return this.view(updated);
    } finally {
      await source?.close().catch(() => {});
    }
  }

  /**
   * Pornește importul (sau rularea de probă). O rulare nouă pe un import terminat = sincronizare: harta rămâne, deci
   * se aduce doar ce lipsește.
   */
  async start(actor: GcsActor, id: string, opts: { dryRun: boolean; options: string[]; redirects: boolean }): Promise<GcsImportView> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "edit");
    const { db, jobs } = this.deps;
    const job = await this.load(id);
    if (!["READY", "DONE", "CANCELLED", "FAILED", "PAUSED"].includes(job.status) || !job.detected) throw new GcsConflict({ reason: "import_not_ready" });
    const detected = job.detected as unknown as GcsImportDetected;
    if (!detected.supported) throw new GcsConflict({ reason: "version_unsupported" });
    const running = await db.importJob.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] }, id: { not: id } }, select: { id: true } });
    if (running) throw new GcsConflict({ reason: "import_running" });
    const options = GCS_IMPORT_OPTIONS.filter((o) => opts.options.includes(o)) as GcsImportOption[];
    const config: GcsImportConfig = { ...(job.config as unknown as GcsImportConfig), options, redirects: opts.redirects };
    const updated = await db.importJob.update({
      where: { id },
      data: {
        status: "QUEUED",
        dryRun: opts.dryRun,
        control: null,
        error: null,
        config: config as unknown as Prisma.InputJsonValue,
        steps: initialSteps(config, detected) as unknown as Prisma.InputJsonValue,
        currentStep: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    if (!opts.dryRun) await db.importLog.deleteMany({ where: { jobId: id } });
    await writeAudit(db, { actorId: actor.userId, action: "import.start", targetType: "import", targetId: id, after: { dryRun: opts.dryRun, options, redirects: opts.redirects, source: job.source }, ip: actor.ip });
    await jobs.enqueue(IMPORT_JOB, { jobId: id }, { jobId: `import-${id}-${Date.now()}` });
    return this.view(updated);
  }

  async pause(actor: GcsActor, id: string): Promise<GcsImportView> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "edit");
    const { db } = this.deps;
    const job = await this.load(id);
    if (job.status === "RUNNING") await db.importJob.update({ where: { id }, data: { control: "pause" } });
    else if (job.status === "QUEUED") await db.importJob.update({ where: { id }, data: { status: "PAUSED" } });
    else throw new GcsConflict({ reason: "import_not_running" });
    await writeAudit(db, { actorId: actor.userId, action: "import.pause", targetType: "import", targetId: id, ip: actor.ip });
    return this.view(await this.load(id));
  }

  async resume(actor: GcsActor, id: string): Promise<GcsImportView> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "edit");
    const { db, jobs } = this.deps;
    const job = await this.load(id);
    const stale = job.status === "RUNNING" && (!job.heartbeatAt || Date.now() - job.heartbeatAt.getTime() > IMPORT_STALE_MS);
    if (job.status !== "PAUSED" && job.status !== "FAILED" && !stale) throw new GcsConflict({ reason: "import_not_paused" });
    const running = await db.importJob.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] }, id: { not: id } }, select: { id: true } });
    if (running) throw new GcsConflict({ reason: "import_running" });
    // Pașii eșuați se reiau de la cursorul lor.
    const steps = (job.steps as unknown as GcsImportStepState[]).map((s) => (s.status === "failed" ? { ...s, status: "running" as const } : s));
    const updated = await db.importJob.update({ where: { id }, data: { status: "QUEUED", control: null, error: null, finishedAt: null, steps: steps as unknown as Prisma.InputJsonValue } });
    await writeAudit(db, { actorId: actor.userId, action: "import.resume", targetType: "import", targetId: id, ip: actor.ip });
    await jobs.enqueue(IMPORT_JOB, { jobId: id }, { jobId: `import-${id}-${Date.now()}` });
    return this.view(updated);
  }

  async cancel(actor: GcsActor, id: string): Promise<GcsImportView> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "edit");
    const { db } = this.deps;
    const job = await this.load(id);
    if (job.status === "RUNNING") await db.importJob.update({ where: { id }, data: { control: "cancel" } });
    else if (job.status === "QUEUED" || job.status === "PAUSED") await db.importJob.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
    else throw new GcsConflict({ reason: "import_not_running" });
    await writeAudit(db, { actorId: actor.userId, action: "import.cancel", targetType: "import", targetId: id, ip: actor.ip });
    return this.view(await this.load(id));
  }

  /** Șterge parola bazei vechi (după import). */
  async deleteCredentials(actor: GcsActor, id: string): Promise<GcsImportView> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "edit");
    const { db } = this.deps;
    const job = await this.load(id);
    if (job.status === "QUEUED" || job.status === "RUNNING") throw new GcsConflict({ reason: "import_running" });
    const updated = await db.importJob.update({ where: { id }, data: { secret: null } });
    await writeAudit(db, { actorId: actor.userId, action: "import.credentials_deleted", targetType: "import", targetId: id, ip: actor.ip });
    return this.view(updated);
  }

  /** Șterge importul (configurarea, jurnalul). Datele importate și harta id-urilor (redirecturile) rămân. */
  async delete(actor: GcsActor, id: string): Promise<void> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "delete");
    const { db } = this.deps;
    const job = await this.load(id);
    if (job.status === "QUEUED" || job.status === "RUNNING") throw new GcsConflict({ reason: "import_running" });
    await db.importJob.delete({ where: { id } });
    await writeAudit(db, { actorId: actor.userId, action: "import.delete", targetType: "import", targetId: id, before: { source: job.source, status: job.status }, ip: actor.ip });
  }

  async logs(actor: GcsActor, id: string, opts: { level?: "error"; limit?: number } = {}): Promise<GcsImportLogView[]> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "view");
    return this.deps.db.importLog.findMany({
      where: { jobId: id, ...(opts.level ? { level: opts.level } : {}) },
      orderBy: { id: "desc" },
      take: Math.min(opts.limit ?? 50, 500),
      select: { id: true, step: true, level: true, message: true, sourceId: true, createdAt: true },
    });
  }

  /** Raportul final ca CSV: pe fiecare pas, importate / sărite / erori / nerecunoscute. */
  async reportCsv(actor: GcsActor, id: string): Promise<string> {
    const job = await this.get(actor, id);
    const head = ["step", "status", "total", "imported", "skipped", "errors", "unrecognized"];
    const lines = job.steps.map((s) => [s.key, s.status, s.total, s.imported, s.skipped, s.errors, s.unrecognized].join(","));
    return [head.join(","), ...lines].join("\n") + "\n";
  }

  // ─── Redirecturile 301 ───────────────────────────────────────────────────

  async redirectConfig(actor: GcsActor): Promise<GcsRedirectConfig> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "view");
    return this.redirects.config();
  }

  /** Pornește (cu regula importului dat) sau oprește redirecturile. `prefix` = calea veche a forumului (ex. `/forum`). */
  async setRedirects(actor: GcsActor, id: string, enabled: boolean, prefix?: string): Promise<GcsRedirectConfig> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "edit");
    const job = await this.load(id);
    const detected = job.detected as unknown as GcsImportDetected | null;
    const config = await this.redirects.config();
    let rules = config.rules;
    if (job.mapKey && detected) {
      const oldUrl = (job.config as unknown as GcsImportConfig).oldUrl;
      const path = prefix ?? (oldUrl && URL.canParse(oldUrl) ? new URL(oldUrl).pathname : "");
      if (prefix !== undefined && !/^[A-Za-z0-9/_.~-]{0,100}$/.test(prefix)) throw new GcsValidationError({ prefix: "invalid_prefix" });
      rules = [...rules.filter((r) => r.mapKey !== job.mapKey), { mapKey: job.mapKey, schema: detected.schema, prefix: path, postsPerPage: detected.postsPerPage }];
    }
    const next = { enabled, rules };
    await this.redirects.save(next);
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "import.redirects", targetType: "import", targetId: id, after: { enabled, rules: rules.length }, ip: actor.ip });
    return this.redirects.config();
  }

  /** „Verifică redirecturile”: ținta unei adrese vechi și un eșantion de topicuri importate. */
  async checkRedirect(actor: GcsActor, url: string): Promise<{ from: string; to: string | null }> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "view");
    const parsed = URL.canParse(url) ? new URL(url) : URL.canParse(url, "http://x") ? new URL(url, "http://x") : null;
    if (!parsed) throw new GcsValidationError({ url: "invalid_url" });
    const from = `${parsed.pathname}${parsed.search}`;
    return { from, to: await this.redirects.resolve(parsed.pathname, parsed.search) };
  }

  async redirectSamples(actor: GcsActor, id: string, limit = 8): Promise<{ from: string; to: string | null }[]> {
    await this.deps.acp.assert(actor, IMPORT_ACP_SECTION, "view");
    const { db } = this.deps;
    const job = await this.load(id);
    const rule = (await this.redirects.config()).rules.find((r) => r.mapKey === job.mapKey);
    if (!rule) return [];
    const rows = await db.importMap.findMany({ where: { source: job.mapKey, type: "topic" }, orderBy: { sourceId: "asc" }, take: limit });
    const topics = await db.topic.findMany({ where: { id: { in: rows.map((r) => Number(r.targetId)) } }, select: { id: true, title: true } });
    const titleOf = new Map(topics.map((t) => [String(t.id), t.title]));
    const out: { from: string; to: string | null }[] = [];
    for (const r of rows) {
      const from = legacyTopicPath(rule, r.sourceId, titleOf.get(r.targetId) ?? "topic");
      out.push({ from, to: await this.redirects.resolve(from, "") });
    }
    return out;
  }

  /** Pentru `proxy.ts`: adresa nouă a unei adrese vechi, sau `null`. Fără nicio interogare când sunt oprite. */
  resolveLegacy(pathname: string, search: string): Promise<string | null> {
    return this.redirects.resolve(pathname, search);
  }

  /** La finalul unui import cu „pornește redirecturile”: regula importului se adaugă și redirecturile pornesc. */
  async enableRedirectsAfterImport(jobId: string): Promise<void> {
    const job = await this.load(jobId);
    const config = job.config as unknown as GcsImportConfig;
    const detected = job.detected as unknown as GcsImportDetected | null;
    if (!config.redirects || !detected || job.dryRun) return;
    const current = await this.redirects.config();
    const prefix = config.oldUrl && URL.canParse(config.oldUrl) ? new URL(config.oldUrl).pathname : "";
    await this.redirects.save({
      enabled: true,
      rules: [...current.rules.filter((r) => r.mapKey !== job.mapKey), { mapKey: job.mapKey, schema: detected.schema, prefix, postsPerPage: detected.postsPerPage }],
    });
  }
}
