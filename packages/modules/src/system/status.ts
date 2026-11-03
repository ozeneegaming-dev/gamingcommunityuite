import { statfs } from "node:fs/promises";
import { CRON_LAST_KEY, CRON_STALE_MS, GcsSqlKv, GcsValidationError, readJobStats, realtimeStatus, serviceStatus, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsEdition, type GcsJobQueue, type GcsJobRunStat, type GcsKv, type GcsNotificationService, type GcsSettingsService, type GcsServiceStatus } from "@gcs/core";
import { isMysql, type PrismaClient } from "@gcs/db";

/** Secțiunea ACP (ACP › Sistem › Stare sistem): `view` = pagina, `edit` = „Rulează acum” și alertele. */
export const STATUS_ACP_SECTION = "system.status";
/** Alertele de stare trimise administratorilor (clopoțel + email), editate din pagina Stare sistem. */
export const STATUS_ALERTS_SETTING = "system.status_alerts";
/** Jobul care verifică discul și joburile picate și anunță administratorii (la 10 minute). */
export const STATUS_CHECK_JOB = "system.status_check";
export const STATUS_CHECK_EVERY_MS = 10 * 60_000;
/** Tipul notificării de alertă (și ținta ei: id-ul = problema, ex. `disk` sau `job:<nume>`). */
export const STATUS_ALERT_TYPE = "core.system_alert";

export type GcsStatusAlerts = {
  /** Comutatorul general. */
  enabled: boolean;
  /** Alertă când spațiul liber pe disc scade sub `diskMinFreePct` %. */
  disk: boolean;
  diskMinFreePct: number;
  /** Alertă când ultima rulare a unui job programat a picat. */
  jobs: boolean;
  /** Aceeași problemă se anunță din nou după atâtea ore, cât timp durează. */
  repeatHours: number;
};

export const DEFAULT_STATUS_ALERTS: GcsStatusAlerts = { enabled: true, disk: true, diskMinFreePct: 10, jobs: true, repeatHours: 6 };

const isInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Validarea setării (`GcsSettingDef.validate`). */
export function statusAlertsError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const a = v as Partial<GcsStatusAlerts>;
  if (typeof a.enabled !== "boolean" || typeof a.disk !== "boolean" || typeof a.jobs !== "boolean") return "invalid";
  if (!isInt(a.diskMinFreePct, 1, 50) || !isInt(a.repeatHours, 1, 168)) return "invalid_range";
  return null;
}

export type GcsDiskUsage = { free: number; total: number };

/** Spațiul pe disc al volumului aplicației (octeți), sau `null` dacă sistemul nu îl raportează. */
export async function diskUsageOf(path = process.cwd()): Promise<GcsDiskUsage | null> {
  try {
    const s = await statfs(path);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    return total > 0 ? { free, total } : null;
  } catch {
    return null;
  }
}

export type GcsStatusProbe = { ok: boolean; latencyMs: number | null };

export type GcsSystemStatus = {
  checkedAt: number;
  edition: GcsEdition;
  db: GcsStatusProbe & { engine: "postgresql" | "mysql"; version: string | null };
  kv: GcsStatusProbe & { driver: "redis" | "sql" };
  worker: GcsServiceStatus;
  realtime: GcsServiceStatus;
  /** Doar ediția Lite: ultima rulare a cron-ului gazdei. */
  cron: { lastRunAt: number | null; stale: boolean } | null;
  email: { configured: boolean };
  storage: { driver: "s3" | "local" };
  translate: { provider: string };
  server: { node: string; platform: string; arch: string; uptimeSec: number; rss: number; heapUsed: number; timezone: string; disk: GcsDiskUsage | null };
  jobs: { name: string; everyMs: number | null; pattern: string | null; stat: GcsJobRunStat | null; failing: boolean }[];
};

/** Problemele găsite de verificarea periodică (cheia = id-ul notificării). */
export type GcsStatusIssue = { key: string; kind: "disk" | "job"; freePct?: number; job?: string; error?: string | null };

const PROBE_TIMEOUT_MS = 2000;

async function probe(task: () => Promise<unknown>): Promise<GcsStatusProbe> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ok = await Promise.race([task().then(() => true), new Promise<false>((r) => (timer = setTimeout(() => r(false), PROBE_TIMEOUT_MS)))]);
    return { ok, latencyMs: ok ? Date.now() - started : null };
  } catch {
    return { ok: false, latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Ultima rulare a picat (după ultima reușită). */
const failing = (s: GcsJobRunStat | null | undefined) => Boolean(s && s.lastErrorAt !== null && s.lastErrorAt >= (s.lastOkAt ?? 0));

/**
 * Starea sistemului (ACP › Sistem › Stare sistem): serviciile (baza de date, stocarea cheilor, worker-ul, timpul real,
 * cron-ul Lite), configurările de bază, serverul și joburile programate cu ultima lor rulare; „Rulează acum” pune un
 * job repetabil în coadă. Jobul `system.status_check` anunță administratorii (clopoțel + email) când discul se umple
 * sau un job pică, cel mult o dată la `repeatHours` pentru aceeași problemă.
 */
export class GcsSystemStatusService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      kv: GcsKv;
      jobs: GcsJobQueue;
      settings: Pick<GcsSettingsService, "get">;
      acp: Pick<GcsAcpRoleService, "assert" | "usersWith">;
      notifications: Pick<GcsNotificationService, "notify">;
      edition: GcsEdition;
      disk?: () => Promise<GcsDiskUsage | null>;
    },
  ) {}

  private disk(): Promise<GcsDiskUsage | null> {
    return (this.deps.disk ?? (() => diskUsageOf()))();
  }

  async alerts(): Promise<GcsStatusAlerts> {
    const v = await this.deps.settings.get<GcsStatusAlerts | null>(STATUS_ALERTS_SETTING).catch(() => null);
    return v && statusAlertsError(v) === null ? v : DEFAULT_STATUS_ALERTS;
  }

  private async dbVersion(): Promise<string | null> {
    try {
      const rows = (await this.deps.db.$queryRawUnsafe("SELECT version() AS v")) as { v?: unknown }[];
      const raw = typeof rows[0]?.v === "string" ? rows[0].v : null;
      // PostgreSQL: „PostgreSQL 16.4 on x86_64…” → „16.4”; MySQL / MariaDB: „8.0.39” / „10.11.6-MariaDB…”.
      return raw ? (/PostgreSQL ([\d.]+)/.exec(raw)?.[1] ?? raw.split(/[\s-]/)[0] ?? raw) : null;
    } catch {
      return null;
    }
  }

  async snapshot(now = Date.now()): Promise<GcsSystemStatus> {
    const { db, kv, jobs, settings, edition } = this.deps;
    const [dbProbe, kvProbe, version, worker, realtime, cronRaw, smtpHost, provider, stats, disk] = await Promise.all([
      probe(() => db.$queryRawUnsafe("SELECT 1")),
      probe(async () => {
        if ((await kv.ping()) === false) throw new Error("ping");
      }),
      this.dbVersion(),
      serviceStatus(kv, "worker", now).catch(() => ({ up: false, lastBeatAt: null })),
      realtimeStatus(kv, edition, now).catch(() => ({ up: false, lastBeatAt: null })),
      edition === "lite" ? kv.get(CRON_LAST_KEY).catch(() => null) : Promise.resolve(null),
      settings.get<string>("email.smtp_host").catch(() => ""),
      settings.get<string>("i18n.translate_provider").catch(() => "off"),
      readJobStats(kv).catch(() => ({}) as Record<string, GcsJobRunStat>),
      this.disk(),
    ]);
    const cronAt = cronRaw === null ? Number.NaN : Number(cronRaw);
    const mem = process.memoryUsage();
    return {
      checkedAt: now,
      edition,
      db: { ...dbProbe, engine: isMysql() ? "mysql" : "postgresql", version },
      kv: { ...kvProbe, driver: kv instanceof GcsSqlKv ? "sql" : "redis" },
      worker,
      realtime,
      cron: edition === "lite" ? { lastRunAt: Number.isFinite(cronAt) ? cronAt : null, stale: !Number.isFinite(cronAt) || now - cronAt > CRON_STALE_MS } : null,
      email: { configured: typeof smtpHost === "string" && smtpHost.trim() !== "" },
      storage: { driver: process.env.S3_ENDPOINT ? "s3" : "local" },
      translate: { provider: typeof provider === "string" ? provider : "off" },
      server: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        uptimeSec: Math.round(process.uptime()),
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        disk,
      },
      jobs: jobs
        .registered()
        .map((d) => ({ name: d.name, everyMs: d.everyMs ?? null, pattern: d.pattern ?? null, stat: stats[d.name] ?? null, failing: failing(stats[d.name]) }))
        .sort((a, b) => Number(b.failing) - Number(a.failing) || a.name.localeCompare(b.name)),
    };
  }

  /** „Rulează acum”: doar joburile repetabile (cele cu date proprii, ex. bun venitul unui membru, nu). */
  async runNow(actor: GcsActor, name: string): Promise<void> {
    await this.deps.acp.assert(actor, STATUS_ACP_SECTION, "edit");
    const def = this.deps.jobs.registered().find((d) => d.name === name);
    if (!def || (!def.everyMs && !def.pattern)) throw new GcsValidationError({ job: "unknown_job" });
    await this.deps.jobs.enqueue(name, {});
    await writeAudit(this.deps.db, { actorId: actor.userId ?? null, action: "system.job_run", targetType: "job", targetId: name, ip: actor.ip });
  }

  /** Problemele de acum, după setări (fără să trimită nimic). */
  async issues(): Promise<GcsStatusIssue[]> {
    const alerts = await this.alerts();
    if (!alerts.enabled) return [];
    const out: GcsStatusIssue[] = [];
    if (alerts.disk) {
      const disk = await this.disk();
      if (disk) {
        const freePct = Math.round((disk.free / disk.total) * 1000) / 10;
        if (freePct < alerts.diskMinFreePct) out.push({ key: "disk", kind: "disk", freePct });
      }
    }
    if (alerts.jobs) {
      const stats = await readJobStats(this.deps.kv).catch(() => ({}) as Record<string, GcsJobRunStat>);
      for (const d of this.deps.jobs.registered()) {
        const s = stats[d.name];
        // Jobul de verificare nu se anunță pe sine (ar rula oricum din nou peste 10 minute).
        if (d.name !== STATUS_CHECK_JOB && failing(s)) out.push({ key: `job:${d.name}`, kind: "job", job: d.name, error: s?.lastError ?? null });
      }
    }
    return out;
  }

  /** Jobul periodic: anunță fiecare problemă nouă (sau încă prezentă după `repeatHours`). Întoarce câte a anunțat. */
  async check(): Promise<number> {
    const issues = await this.issues();
    if (issues.length === 0) return 0;
    const { repeatHours } = await this.alerts();
    const admins = await this.deps.acp.usersWith(STATUS_ACP_SECTION, "view");
    if (admins.length === 0) return 0;
    let sent = 0;
    for (const issue of issues) {
      const fresh = await this.deps.kv.set(`gcs:status:alert:${issue.key}`, "1", { ttlMs: repeatHours * 3_600_000, nx: true });
      if (!fresh) continue;
      await this.deps.notifications.notify({
        userIds: admins,
        type: STATUS_ALERT_TYPE,
        targetType: STATUS_ALERT_TYPE,
        targetId: issue.key,
        actorId: null,
        data: { kind: issue.kind, ...(issue.freePct !== undefined ? { freePct: issue.freePct } : {}), ...(issue.job ? { job: issue.job } : {}), ...(issue.error ? { error: issue.error } : {}) },
      });
      sent++;
    }
    return sent;
  }
}
