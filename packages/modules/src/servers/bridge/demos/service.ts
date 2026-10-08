import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { GcsNotFound, GcsRateLimited, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsAppService, type GcsFileStore, type GcsJobQueue, type GcsPermissionService, type GcsRedisRateLimiter, type GcsSettingsService } from "@gcs/core";
import type { GameDemoStatus, GameMatchStatus, Prisma, PrismaClient } from "@gcs/db";
import { SERVERS_APP } from "../../poller";
import { SERVERS_ACP_SECTION } from "../../service";
import { BRIDGE_PERMISSION, BRIDGE_SETTING } from "../config";
import type { GcsBridgeTv } from "../tv";
import { GcsBridgeError, type GcsBridgeServer } from "../types";
import { GcsDemoError } from "./guard";
import { demoDownloadName, isSafeDemoName, pickDemoFiles } from "./names";
import { demoHeaderOk, keepCompressed, planDemoExpiry } from "./retention";
import { demoErrorCode, removeQuietly } from "./sources";

/**
 * Demo-urile meciurilor mix (specul 2026-10-08-servere-hltv §4, §6, §7): rândurile create la finalul meciului, aducerea
 * din sursa serverului (jobul `servers.demos.fetch`, cu reîncercări), încărcarea în bucăți a pluginului CS2 și lipirea ei
 * (`servers.demos.ingest`), stocarea privată (comprimată doar dacă merită), descărcarea cu drepturile verificate,
 * retenția și cota (`servers.demos.cleanup`) și acțiunile staff-ului din ACP.
 */

export const DEMO_JOBS = { fetch: "servers.demos.fetch", ingest: "servers.demos.ingest", cleanup: "servers.demos.cleanup", rcon: "servers.tv.rcon" } as const;

/** Bucățile încărcării pluginului: mărimea cerută și limita corpului unei cereri. */
export const DEMO_CHUNK_SIZE = 512 * 1024;
export const DEMO_CHUNK_MAX = 1024 * 1024;
/** Ritmul încărcării recomandat pluginului (octeți / s). */
export const DEMO_UPLOAD_RATE = 1024 * 1024;
/** Reîncercările aducerii (minute), apoi `NOT_FOUND` / `FAILED`. */
export const DEMO_RETRY_MINUTES = [2, 5, 10, 20, 40, 60, 120, 240];
/** Rezerva după final: întârzierea transmisiei + 30 s (HLTV-ul scrie finalul cu întârziere). */
const GRACE_MS = 30_000;
const FETCH_BATCH = 5;
const STALE_FETCH_MS = 30 * 60_000;
const ABANDONED_UPLOAD_MS = 24 * 3_600_000;
const DOWNLOAD_LIMIT = { window: 600, max: 30 };
/** Erorile după care nu mai are rost să se reîncerce. */
const DEFINITIVE = new Set(["too_large", "invalid_demo", "over_quota", "not_configured", "invalid_name"]);
const OPEN: GameMatchStatus[] = ["WARMUP", "LIVE", "HALFTIME"];

/** Un demo disponibil, pe pagina meciului (cine îl poate descărca). */
export type GcsDemoFile = { id: number; part: number; fileName: string; size: number; availableAt: string; downloads: number; url: string };
/** Starea unui demo pentru staff (pagina meciului, ACP). */
export type GcsDemoStaffRow = {
  id: number;
  matchId: number | null;
  part: number;
  status: Lowercase<GameDemoStatus>;
  source: string;
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  size: number | null;
  storedSize: number | null;
  downloads: number;
  availableAt: string | null;
  createdAt: string;
  match?: { id: number; map: string; teams: { A: string; B: string }; score: { A: number; B: number }; endedAt: string | null } | null;
};
export type GcsMatchDemos = {
  files: GcsDemoFile[];
  /** Viewer-ul are dreptul de descărcare. */
  canDownload: boolean;
  /** Există demo-uri disponibile (chiar dacă viewer-ul nu le poate descărca). */
  available: boolean;
  /** Stările, doar pentru staff (ACP → Gaming → Servere, `view`). */
  staff: GcsDemoStaffRow[] | null;
};
export type GcsOpenedDemo = { body: ReadableStream<Uint8Array>; size: number; fileName: string };
/** O schimbare de stare a unui meci, întoarsă de `applyState`. */
export type GcsMatchChange = { matchId: number; status: GameMatchStatus; previous: GameMatchStatus | null };

type DemoRow = Prisma.GameMatchDemoGetPayload<object>;
type Tx = Prisma.TransactionClient;

const lower = (s: GameDemoStatus) => s.toLowerCase() as Lowercase<GameDemoStatus>;
const chunkKey = (demoId: number, offset: number) => `servers/demo-uploads/${demoId}/${String(offset).padStart(12, "0")}`;

export class GcsBridgeDemos {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      settings: GcsSettingsService;
      permissions: GcsPermissionService;
      acp: GcsAcpRoleService;
      apps: GcsAppService;
      rateLimiter: GcsRedisRateLimiter;
      files: GcsFileStore;
      tv: GcsBridgeTv;
      canViewServer: (actor: GcsActor, id: number) => Promise<boolean>;
      jobs?: Pick<GcsJobQueue, "enqueue">;
      tmpDir?: () => string;
      now?: () => number;
    },
  ) {}

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  private tmpDir(): string {
    return this.deps.tmpDir?.() ?? path.join(os.tmpdir(), "gcs-demos");
  }

  private async enqueue(name: string, data: Record<string, unknown>, opts: { jobId: string; delayMs?: number }): Promise<void> {
    await this.deps.jobs?.enqueue(name, data, opts).catch((error: unknown) => console.error(`[gcs] jobul ${name} nu s-a putut programa`, error));
  }

  private async limits(): Promise<{ maxBytes: number; quotaBytes: number; retentionDays: number }> {
    const [maxMb, quotaGb, retentionDays] = await Promise.all([
      this.deps.settings.get<number>(BRIDGE_SETTING.demoMaxMb),
      this.deps.settings.get<number>(BRIDGE_SETTING.demoQuotaGb),
      this.deps.settings.get<number>(BRIDGE_SETTING.demoRetentionDays),
    ]);
    return { maxBytes: maxMb * 1024 * 1024, quotaBytes: quotaGb * 1024 * 1024 * 1024, retentionDays };
  }

  // ─── Finalul meciului ─────────────────────────────────────────────────────

  /**
   * O schimbare de stare a meciului, în tranzacția evenimentului: la `ended` (server cu sursă) rândul `WAITING` al
   * demo-ului; rcon-ul HLTV (varianta B) la `live` / final. Întoarce efectele de după commit (joburile).
   */
  async onMatchState(tx: Tx, server: Pick<GcsBridgeServer, "id" | "game">, change: GcsMatchChange): Promise<(() => Promise<void>)[]> {
    const effects: (() => Promise<void>)[] = [];
    if (change.previous === change.status) return effects;
    const tv = await tx.gameServerTv.findUnique({ where: { serverId: server.id }, select: { source: true, record: true, address: true, rconPassword: true, delay: true } });
    if (!tv) return effects;
    const delayMs = Math.max(0, tv.delay ?? 0) * 1000;
    const { matchId } = change;
    const rcon = server.game === "cs16" && tv.record && tv.address !== null && tv.rconPassword !== null;
    if (rcon && change.status === "LIVE" && (change.previous === null || change.previous === "WARMUP")) {
      effects.push(() => this.enqueue(DEMO_JOBS.rcon, { serverId: server.id, matchId, action: "record" }, { jobId: `tv-rcon-${matchId}-record` }));
    }
    const closed = change.status === "ENDED" || change.status === "ABORTED";
    if (rcon && closed && change.previous !== null && OPEN.includes(change.previous)) {
      effects.push(() => this.enqueue(DEMO_JOBS.rcon, { serverId: server.id, matchId, action: "stop" }, { jobId: `tv-rcon-${matchId}-stop`, delayMs: delayMs + 5000 }));
    }
    if (change.status === "ENDED" && tv.source !== "none") {
      const due = new Date(this.now().getTime() + delayMs + GRACE_MS);
      const exists = await tx.gameMatchDemo.findUnique({ where: { matchId_part: { matchId, part: 1 } }, select: { id: true } });
      if (!exists) await tx.gameMatchDemo.create({ data: { matchId, serverId: server.id, part: 1, status: "WAITING", source: tv.source, fileName: `m${matchId}.dem`, nextAttemptAt: due } });
      if (tv.source !== "plugin") effects.push(() => this.enqueue(DEMO_JOBS.fetch, { matchId }, { jobId: `demos-fetch-${matchId}`, delayMs: delayMs + GRACE_MS }));
    }
    return effects;
  }

  // ─── Aducerea din sursă ───────────────────────────────────────────────────

  /**
   * Jobul `servers.demos.fetch`: rândurile `WAITING` scadente (partea 1 a fiecărui meci, max 5 pe rundă, fără cele ale
   * pluginului), fiecare luat o singură dată (`FETCHING`), apoi listarea, potrivirea, descărcarea și stocarea.
   */
  async fetchDue(opts: { matchId?: number } = {}): Promise<{ fetched: number; failed: number }> {
    const { db } = this.deps;
    const now = this.now();
    const due = await db.gameMatchDemo.findMany({
      where: { status: "WAITING", part: 1, source: { not: "plugin" }, matchId: opts.matchId ?? { not: null }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      take: FETCH_BATCH,
    });
    let fetched = 0;
    let failed = 0;
    for (const row of due) {
      const claimed = await db.gameMatchDemo.updateMany({ where: { id: row.id, status: "WAITING" }, data: { status: "FETCHING" } });
      if (claimed.count === 0) continue;
      if (await this.fetchMatch(row)) fetched++;
      else failed++;
    }
    return { fetched, failed };
  }

  /** O reîncercare (cu pauza din tabel) sau starea finală (`NOT_FOUND` / `FAILED`). */
  private async retry(rows: DemoRow[], code: string): Promise<void> {
    const now = this.now();
    for (const row of rows) {
      const attempts = row.attempts + 1;
      const final = DEFINITIVE.has(code) || attempts >= DEMO_RETRY_MINUTES.length;
      await this.deps.db.gameMatchDemo.update({
        where: { id: row.id },
        data: {
          attempts,
          error: code.slice(0, 64),
          status: final ? (code === "not_found" ? "NOT_FOUND" : "FAILED") : "WAITING",
          nextAttemptAt: final ? null : new Date(now.getTime() + DEMO_RETRY_MINUTES[attempts - 1]! * 60_000),
        },
      });
    }
  }

  private async fetchMatch(row: DemoRow): Promise<boolean> {
    const { db, tv } = this.deps;
    const match = row.matchId === null ? null : await db.gameMatch.findUnique({ where: { id: row.matchId }, include: { server: { select: { id: true, game: true } } } });
    if (!match || match.status !== "ENDED" || !match.endedAt) {
      await this.retry([row], "not_configured");
      return false;
    }
    const cfg = await tv.config(match.serverId);
    if (!cfg?.sourceConfig) {
      await this.retry([row], "not_configured");
      return false;
    }
    const others = await db.gameMatchDemo.findMany({ where: { matchId: match.id, part: { gt: 1 } }, orderBy: { part: "asc" } });
    let conn;
    try {
      conn = await tv.connect(cfg.sourceConfig, { guard: tv.guard() });
    } catch (error) {
      const code = demoErrorCode(error);
      await tv.noteFetch(match.serverId, false, code, { matchId: match.id });
      await this.retry([row], code);
      return false;
    }
    try {
      await tv.pinHostKey(match.serverId, conn.hostKey);
      const files = await conn.list();
      const picked = pickDemoFiles(files, { id: match.id, externalId: match.externalId, map: match.map, startedAt: match.startedAt, liveAt: match.liveAt, endedAt: match.endedAt }, { timeZone: cfg.timeZone, prefix: cfg.namePrefix, delaySec: cfg.delay ?? 0 });
      if (picked.length === 0) {
        await tv.noteFetch(match.serverId, false, "not_found", { matchId: match.id, files: files.length, matched: 0 });
        await this.retry([row], "not_found");
        return false;
      }
      const { maxBytes } = await this.limits();
      for (const [i, file] of picked.entries()) {
        const part = i + 1;
        const target =
          part === 1
            ? row
            : (others.find((o) => o.part === part) ??
              (await db.gameMatchDemo.create({ data: { matchId: match.id, serverId: match.serverId, part, status: "FETCHING", source: cfg.source, fileName: `m${match.id}-p${part}.dem` } })));
        if (part > 1) await db.gameMatchDemo.update({ where: { id: target.id }, data: { status: "FETCHING" } });
        if (file.size !== null && file.size > maxBytes) throw new GcsDemoError("too_large");
        await mkdir(this.tmpDir(), { recursive: true });
        const tmp = path.join(this.tmpDir(), `${randomUUID()}.dem`);
        try {
          await conn.download(file.name, tmp, maxBytes);
          await this.storeFile(target, tmp, match.server.game, { remoteName: file.name, source: cfg.source, fileName: demoDownloadName(match, part, picked.length) });
        } finally {
          await removeQuietly(tmp);
        }
      }
      // Părțile rămase dintr-o aducere veche (acum sunt mai puține) dispar.
      const stale = others.filter((o) => o.part > picked.length);
      if (stale.length > 0) await this.dropRows(stale);
      await tv.noteFetch(match.serverId, true, null, { matchId: match.id, files: files.length, matched: picked.length });
      return true;
    } catch (error) {
      const code = demoErrorCode(error);
      await tv.noteFetch(match.serverId, false, code, { matchId: match.id });
      const fresh = await db.gameMatchDemo.findMany({ where: { matchId: match.id, status: "FETCHING" } });
      await this.retry(fresh.length > 0 ? fresh : [row], code);
      return false;
    } finally {
      await conn.close().catch(() => {});
    }
  }

  // ─── Stocarea ─────────────────────────────────────────────────────────────

  /**
   * Un fișier adus / lipit → store-ul platformei: antetul jocului, sha256 (și mărimea / sha256 așteptate, la încărcarea
   * pluginului), gzip în flux păstrat doar dacă economisește 10 %, cota; apoi `AVAILABLE` și cota aplicată celorlalte.
   */
  private async storeFile(row: DemoRow, tmp: string, game: string, meta: { remoteName: string; source: string; fileName: string; expect?: { size: number; sha256: string } }): Promise<void> {
    const { db, files } = this.deps;
    const head = Buffer.alloc(8);
    const fh = await open(tmp, "r");
    try {
      await fh.read(head, 0, 8, 0);
    } finally {
      await fh.close();
    }
    if (!demoHeaderOk(game, head)) throw new GcsDemoError("invalid_demo");
    const gz = `${tmp}.gz`;
    try {
      const hash = createHash("sha256");
      let size = 0;
      const tap = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          size += chunk.length;
          cb(null, chunk);
        },
      });
      await pipeline(createReadStream(tmp), tap, createGzip({ level: 6 }), createWriteStream(gz));
      const sha256 = hash.digest("hex");
      if (meta.expect && (meta.expect.size !== size || meta.expect.sha256 !== sha256)) throw new GcsDemoError("checksum_mismatch");
      const gzSize = (await stat(gz)).size;
      const gzip = keepCompressed(size, gzSize);
      const storedSize = gzip ? gzSize : size;
      const { quotaBytes, retentionDays } = await this.limits();
      if (storedSize > quotaBytes) throw new GcsDemoError("over_quota");
      const now = this.now();
      const key = `servers/demos/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.dem${gzip ? ".gz" : ""}`;
      await files.putFile(key, gzip ? gz : tmp, gzip ? "application/gzip" : "application/octet-stream");
      const previous = row.storageKey;
      await db.gameMatchDemo.update({
        where: { id: row.id },
        data: {
          status: "AVAILABLE",
          storageKey: key,
          encoding: gzip ? "gzip" : "identity",
          size,
          storedSize,
          sha256,
          remoteName: meta.remoteName.slice(0, 200),
          source: meta.source,
          fileName: meta.fileName,
          error: null,
          nextAttemptAt: null,
          availableAt: now,
          expiresAt: new Date(now.getTime() + retentionDays * 86_400_000),
        },
      });
      if (previous && previous !== key) await files.delete(previous).catch(() => {});
      await this.applyRetention([row.id]);
    } finally {
      await removeQuietly(gz);
    }
  }

  /** Șterge fișierele și rândurile (părțile în plus, rândurile fără meci). */
  private async dropRows(rows: DemoRow[]): Promise<void> {
    for (const r of rows) if (r.storageKey) await this.deps.files.delete(r.storageKey).catch(() => {});
    await this.deps.db.gameMatchDemo.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  }

  /** Retenția și cota (ultimele aduse, din `keep`, nu ies la cotă). */
  private async applyRetention(keep: number[] = []): Promise<number> {
    const { db, files } = this.deps;
    const { quotaBytes, retentionDays } = await this.limits();
    const rows = await db.gameMatchDemo.findMany({ where: { status: "AVAILABLE" }, select: { id: true, storedSize: true, availableAt: true, storageKey: true } });
    const plan = planDemoExpiry(
      rows.map((r) => ({ id: r.id, storedSize: r.storedSize ?? 0, availableAt: r.availableAt ?? new Date(0) })),
      { now: this.now(), retentionDays, quotaBytes, keep },
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const [ids, reason] of [
      [plan.expired, "retention"],
      [plan.evicted, "quota"],
    ] as const) {
      for (const id of ids) {
        const key = byId.get(id)?.storageKey;
        if (key) await files.delete(key).catch(() => {});
        await db.gameMatchDemo.update({ where: { id }, data: { status: "EXPIRED", storageKey: null, error: reason } });
      }
    }
    return plan.expired.length + plan.evicted.length;
  }

  /**
   * Jobul `servers.demos.cleanup` (la oră): retenția și cota; rândurile fără meci (cu fișierele lor); încărcările
   * abandonate (24 h, bucățile șterse); demo-urile pluginului niciodată încărcate (24 h → `NOT_FOUND`); transferurile
   * blocate (30 min → din nou `WAITING`).
   */
  async cleanup(): Promise<{ expired: number; orphans: number; abandoned: number; stale: number }> {
    const { db } = this.deps;
    const now = this.now().getTime();
    const expired = await this.applyRetention();
    const orphans = await db.gameMatchDemo.findMany({ where: { matchId: null } });
    if (orphans.length > 0) await this.dropRows(orphans);
    const abandoned = await db.gameMatchDemo.findMany({ where: { source: "plugin", status: { in: ["FETCHING", "WAITING"] }, updatedAt: { lt: new Date(now - ABANDONED_UPLOAD_MS) } } });
    for (const r of abandoned) {
      await this.dropChunks(r);
      await db.gameMatchDemo.update({ where: { id: r.id }, data: { status: r.status === "WAITING" ? "NOT_FOUND" : "FAILED", error: r.status === "WAITING" ? "upload_missing" : "upload_abandoned", received: 0 } });
    }
    const stale = await db.gameMatchDemo.updateMany({ where: { source: { not: "plugin" }, status: "FETCHING", updatedAt: { lt: new Date(now - STALE_FETCH_MS) } }, data: { status: "WAITING", nextAttemptAt: new Date(now) } });
    return { expired, orphans: orphans.length, abandoned: abandoned.length, stale: stale.count };
  }

  // ─── Încărcarea pluginului CS2 (§4.3) ─────────────────────────────────────

  private async pluginServer(server: GcsBridgeServer): Promise<void> {
    if (server.game !== "cs2") throw new GcsBridgeError("demos_disabled", 403);
    const tv = await this.deps.db.gameServerTv.findUnique({ where: { serverId: server.id }, select: { source: true, record: true } });
    if (tv?.source !== "plugin" || !tv.record) throw new GcsBridgeError("demos_disabled", 403);
  }

  private async dropChunks(row: Pick<DemoRow, "id" | "size" | "chunkSize" | "received">): Promise<void> {
    if (!row.chunkSize || !row.size) return;
    // Și bucata de după `received` (scrisă, dar neconfirmată în baza de date).
    const end = Math.min(row.size, row.received + row.chunkSize);
    for (let offset = 0; offset < end; offset += row.chunkSize) await this.deps.files.delete(chunkKey(row.id, offset)).catch(() => {});
  }

  /**
   * `POST /demos/upload` `{ match, file, size, sha256 }`: începe sau reia încărcarea demo-ului unui meci încheiat
   * (aceeași mărime și același sha256 = reluare de la `received`). `done` = e deja pe site; `processing` = se verifică.
   */
  async uploadStart(server: GcsBridgeServer, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { db } = this.deps;
    await this.pluginServer(server);
    const externalId = typeof body.match === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(body.match) ? body.match : null;
    const file = typeof body.file === "string" && isSafeDemoName(body.file) ? body.file : null;
    const size = Number.isInteger(body.size) && (body.size as number) > 0 ? (body.size as number) : null;
    const sha256 = typeof body.sha256 === "string" && /^[0-9a-f]{64}$/.test(body.sha256) ? body.sha256 : null;
    if (!externalId) throw new GcsBridgeError("invalid_match", 400);
    if (!file) throw new GcsBridgeError("invalid_file", 400);
    if (!size) throw new GcsBridgeError("invalid_size", 400);
    if (!sha256) throw new GcsBridgeError("invalid_sha256", 400);
    const match = await db.gameMatch.findUnique({ where: { serverId_externalId: { serverId: server.id, externalId } } });
    if (!match) throw new GcsBridgeError("unknown_match", 404);
    if (match.status === "ABORTED") throw new GcsBridgeError("not_wanted", 410);
    if (match.status !== "ENDED") throw new GcsBridgeError("match_open", 409);
    const { maxBytes, quotaBytes } = await this.limits();
    let row = await db.gameMatchDemo.findUnique({ where: { matchId_part: { matchId: match.id, part: 1 } } });
    if (row?.status === "AVAILABLE") return { done: true };
    const fileName = demoDownloadName(match, 1, 1);
    if (!row) row = await db.gameMatchDemo.create({ data: { matchId: match.id, serverId: server.id, part: 1, status: "WAITING", source: "plugin", fileName } });
    if (size > maxBytes) {
      await db.gameMatchDemo.update({ where: { id: row.id }, data: { status: "FAILED", error: "too_large", size } });
      throw new GcsBridgeError("too_large", 413, { max: maxBytes });
    }
    if (size > quotaBytes) {
      await db.gameMatchDemo.update({ where: { id: row.id }, data: { status: "FAILED", error: "over_quota", size } });
      throw new GcsBridgeError("over_quota", 507);
    }
    if (row.status === "FETCHING" && row.source === "plugin" && row.size === size && row.sha256 === sha256 && row.chunkSize) {
      if (row.received >= size) return { processing: true };
      return { upload: row.id, chunkSize: row.chunkSize, received: row.received };
    }
    // Încărcare nouă (sau alt fișier): bucățile vechi dispar.
    await this.dropChunks(row);
    await db.gameMatchDemo.update({
      where: { id: row.id },
      data: { status: "FETCHING", source: "plugin", remoteName: file, fileName, size, sha256, chunkSize: DEMO_CHUNK_SIZE, received: 0, error: null, attempts: { increment: 1 }, nextAttemptAt: null },
    });
    return { upload: row.id, chunkSize: DEMO_CHUNK_SIZE, received: 0 };
  }

  /**
   * `POST /demos/chunk?upload=<id>&offset=<n>` (corp binar): exact `chunkSize` octeți (ultima bucată, restul), la
   * `offset = received`; o bucată repetată (răspuns pierdut) se confirmă fără să se scrie din nou. Ultima bucată
   * programează lipirea (`servers.demos.ingest`).
   */
  async uploadChunk(server: GcsBridgeServer, query: string, bytes: Buffer): Promise<Record<string, unknown>> {
    const { db, files } = this.deps;
    await this.pluginServer(server);
    const params = new URLSearchParams(query);
    const id = /^\d{1,10}$/.test(params.get("upload") ?? "") ? Number(params.get("upload")) : null;
    const offset = /^\d{1,12}$/.test(params.get("offset") ?? "") ? Number(params.get("offset")) : null;
    if (id === null || offset === null) throw new GcsBridgeError("invalid_chunk", 400);
    const row = await db.gameMatchDemo.findFirst({ where: { id, serverId: server.id, source: "plugin", status: "FETCHING" } });
    if (!row || !row.size || !row.chunkSize) throw new GcsBridgeError("unknown_upload", 404);
    if (offset % row.chunkSize !== 0 || offset >= row.size) throw new GcsBridgeError("invalid_chunk", 400);
    const expected = Math.min(row.chunkSize, row.size - offset);
    if (bytes.length !== expected) throw new GcsBridgeError("invalid_chunk", 400, { expected });
    if (offset + expected <= row.received) return { received: row.received, ...(row.received >= row.size ? { complete: true } : {}) };
    if (offset !== row.received) throw new GcsBridgeError("offset_mismatch", 409, { received: row.received });
    await files.put(chunkKey(row.id, offset), bytes, "application/octet-stream");
    const updated = await db.gameMatchDemo.updateMany({ where: { id: row.id, received: offset, status: "FETCHING" }, data: { received: offset + expected } });
    if (updated.count === 0) {
      const now = await db.gameMatchDemo.findUnique({ where: { id: row.id }, select: { received: true } });
      throw new GcsBridgeError("offset_mismatch", 409, { received: now?.received ?? 0 });
    }
    const received = offset + expected;
    if (received < row.size) return { received };
    await this.enqueue(DEMO_JOBS.ingest, { demoId: row.id }, { jobId: `demos-ingest-${row.id}` });
    return { received, complete: true };
  }

  /** Jobul `servers.demos.ingest`: lipește bucățile, verifică mărimea / sha256 / antetul și stochează demo-ul. */
  async ingest(demoId: number): Promise<boolean> {
    const { db, files } = this.deps;
    const row = await db.gameMatchDemo.findUnique({ where: { id: demoId }, include: { match: true, server: { select: { game: true } } } });
    if (!row || row.status !== "FETCHING" || row.source !== "plugin" || !row.size || !row.chunkSize || !row.sha256 || row.received < row.size || !row.match || !row.server) return false;
    await mkdir(this.tmpDir(), { recursive: true });
    const tmp = path.join(this.tmpDir(), `${randomUUID()}.dem`);
    try {
      const out = createWriteStream(tmp);
      try {
        for (let offset = 0; offset < row.size; offset += row.chunkSize) {
          const chunk = await files.get(chunkKey(row.id, offset));
          if (!chunk) throw new GcsDemoError("chunk_missing");
          for await (const part of Readable.fromWeb(chunk.body as import("node:stream/web").ReadableStream) as AsyncIterable<Buffer>) {
            if (!out.write(part)) await once(out, "drain");
          }
        }
      } finally {
        await new Promise<void>((resolve) => out.end(() => resolve()));
      }
      await this.storeFile(row, tmp, row.server.game, { remoteName: row.remoteName ?? "demo.dem", source: "plugin", fileName: demoDownloadName(row.match, 1, 1), expect: { size: row.size, sha256: row.sha256 } });
      await this.dropChunks(row);
      return true;
    } catch (error) {
      const code = demoErrorCode(error);
      await this.dropChunks(row);
      await db.gameMatchDemo.update({ where: { id: row.id }, data: { status: "FAILED", error: code, received: 0 } });
      return false;
    } finally {
      await removeQuietly(tmp);
    }
  }

  // ─── Citirile și acțiunile ────────────────────────────────────────────────

  private staffRow(r: DemoRow, match?: GcsDemoStaffRow["match"]): GcsDemoStaffRow {
    return {
      id: r.id,
      matchId: r.matchId,
      part: r.part,
      status: lower(r.status),
      source: r.source,
      error: r.error,
      attempts: r.attempts,
      nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
      size: r.size,
      storedSize: r.storedSize,
      downloads: r.downloads,
      availableAt: r.availableAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      ...(match !== undefined ? { match } : {}),
    };
  }

  /** Viewer-ul poate descărca demo-urile serverului: aplicația, statisticile, `servers.demos_download`, serverul vizibil. */
  async canDownload(actor: GcsActor, serverId: number): Promise<boolean> {
    const { apps, permissions } = this.deps;
    if (actor.isBanned || !(await apps.enabled(SERVERS_APP))) return false;
    if (!(await permissions.can(actor, BRIDGE_PERMISSION.statsView)) || !(await permissions.can(actor, BRIDGE_PERMISSION.demosDownload))) return false;
    return this.deps.canViewServer(actor, serverId);
  }

  /** Demo-urile unui meci (pagina meciului): fișierele pentru cine le poate descărca, stările pentru staff. */
  async forMatch(actor: GcsActor, matchId: number): Promise<GcsMatchDemos> {
    const { db, acp } = this.deps;
    const match = await db.gameMatch.findUnique({ where: { id: matchId }, select: { serverId: true } });
    if (!match) return { files: [], canDownload: false, available: false, staff: null };
    const [rows, canDownload, staff] = await Promise.all([
      db.gameMatchDemo.findMany({ where: { matchId }, orderBy: { part: "asc" } }),
      this.canDownload(actor, match.serverId),
      actor.userId ? acp.can(actor, SERVERS_ACP_SECTION, "view") : Promise.resolve(false),
    ]);
    const available = rows.filter((r) => r.status === "AVAILABLE" && r.storageKey && r.size !== null);
    return {
      files: canDownload ? available.map((r) => ({ id: r.id, part: r.part, fileName: r.fileName, size: r.size!, availableAt: (r.availableAt ?? r.updatedAt).toISOString(), downloads: r.downloads, url: `/api/servers/demos/${r.id}` })) : [],
      canDownload,
      available: available.length > 0,
      staff: staff ? rows.map((r) => this.staffRow(r)) : null,
    };
  }

  /**
   * Deschide un demo pentru descărcare (ruta `/api/servers/demos/<id>`): drepturile verificate la fiecare cerere, o
   * limită pe viewer, contorul descărcărilor; un demo comprimat se decomprimă în flux (fișierul primit e `.dem`).
   * Orice lipsă de acces arată ca „nu există”.
   */
  async open(actor: GcsActor, demoId: number, viewerKey: string): Promise<GcsOpenedDemo> {
    const { db, files, rateLimiter } = this.deps;
    const row = await db.gameMatchDemo.findUnique({ where: { id: demoId }, include: { match: { select: { serverId: true } } } });
    if (!row || row.status !== "AVAILABLE" || !row.storageKey || row.size === null || !row.match) throw new GcsNotFound();
    if (!(await this.canDownload(actor, row.match.serverId))) throw new GcsNotFound();
    const limit = await rateLimiter.consume(`servers-demo:${viewerKey}`, DOWNLOAD_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter ?? 600) });
    const file = await files.get(row.storageKey);
    if (!file) throw new GcsNotFound();
    await db.gameMatchDemo.update({ where: { id: row.id }, data: { downloads: { increment: 1 } } });
    const body = row.encoding === "gzip" ? (Readable.toWeb(Readable.fromWeb(file.body as import("node:stream/web").ReadableStream).pipe(createGunzip())) as ReadableStream<Uint8Array>) : file.body;
    return { body, size: row.size, fileName: row.fileName };
  }

  /** Ultimele demo-uri ale unui server (ACP → pagina punții), cu meciul lor. */
  async recent(actor: GcsActor, serverId: number, limit = 10): Promise<GcsDemoStaffRow[]> {
    await this.deps.acp.assert(actor, SERVERS_ACP_SECTION, "view");
    const rows = await this.deps.db.gameMatchDemo.findMany({
      where: { serverId },
      orderBy: [{ createdAt: "desc" }, { part: "asc" }],
      take: limit,
      include: { match: { select: { id: true, map: true, teamAName: true, teamBName: true, scoreA: true, scoreB: true, endedAt: true } } },
    });
    return rows.map((r) =>
      this.staffRow(r, r.match ? { id: r.match.id, map: r.match.map, teams: { A: r.match.teamAName, B: r.match.teamBName }, score: { A: r.match.scoreA, B: r.match.scoreB }, endedAt: r.match.endedAt?.toISOString() ?? null } : null),
    );
  }

  /** „Caută din nou” (ACP `edit`): rândurile meciului din nou `WAITING`, aducerea programată acum. */
  async refetch(actor: GcsActor, matchId: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const match = await db.gameMatch.findUnique({ where: { id: matchId }, select: { id: true, serverId: true, status: true } });
    if (!match || match.status !== "ENDED") throw new GcsNotFound();
    const tv = await db.gameServerTv.findUnique({ where: { serverId: match.serverId }, select: { source: true } });
    if (!tv || tv.source === "none") throw new GcsBridgeError("not_configured", 409);
    const now = this.now();
    const rows = await db.gameMatchDemo.findMany({ where: { matchId } });
    if (rows.length === 0) await db.gameMatchDemo.create({ data: { matchId, serverId: match.serverId, part: 1, status: "WAITING", source: tv.source, fileName: `m${matchId}.dem`, nextAttemptAt: now } });
    else await db.gameMatchDemo.updateMany({ where: { matchId, status: { not: "FETCHING" } }, data: { status: "WAITING", attempts: 0, error: null, nextAttemptAt: now, source: tv.source } });
    await writeAudit(db, { actorId: actor.userId, action: "servers.demo.refetch", targetType: "game_match", targetId: String(matchId), ip: actor.ip });
    if (tv.source !== "plugin") await this.enqueue(DEMO_JOBS.fetch, { matchId }, { jobId: `demos-refetch-${matchId}-${now.getTime()}` });
  }

  /** „Șterge” (ACP `delete`): fișierul șters, rândul rămâne `EXPIRED` (istoric). */
  async remove(actor: GcsActor, demoId: number): Promise<void> {
    const { db, acp, files } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "delete");
    const row = await db.gameMatchDemo.findUnique({ where: { id: demoId } });
    if (!row) throw new GcsNotFound();
    if (row.storageKey) await files.delete(row.storageKey).catch(() => {});
    await this.dropChunks(row);
    await db.gameMatchDemo.update({ where: { id: demoId }, data: { status: "EXPIRED", storageKey: null, error: "deleted", nextAttemptAt: null } });
    await writeAudit(db, { actorId: actor.userId, action: "servers.demo.delete", targetType: "game_match_demo", targetId: String(demoId), before: { matchId: row.matchId, part: row.part, status: row.status, size: row.size }, ip: actor.ip });
  }
}
