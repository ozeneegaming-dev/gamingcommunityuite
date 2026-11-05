import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, realpath, rm, stat } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { Readable } from "node:stream";
import {
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  type GcsActor,
  type GcsEventBus,
  type GcsFileStore,
  type GcsJobQueue,
  type GcsPermissionService,
  type GcsRateLimiter,
  type GcsSettingsService,
} from "@gcs/core";
import type { DownloadAsset, PrismaClient } from "@gcs/db";
import type { GcsDownloadAccess } from "./access";
import { cleanFileName, contentMatches, extensionAllowed, extensionOf, mimeOf, sniffKind, SNIFF_BYTES, type GcsFileKind } from "./filetype";
import { effectiveMaxBytes, isBlockedHost, readDownloadOptions, type GcsDownloadOptions } from "./options";
import { NO_SCANNER, parseScannerAddress, type GcsScanVerdict, type GcsVirusScanner } from "./scanner";
import { DOWNLOAD_CHUNK_BYTES } from "./text";

export const DOWNLOAD_JOBS = {
  process: "downloads.process",
  maintain: "downloads.maintain",
  rescan: "downloads.rescan",
} as const;

const START_LIMIT = { window: 3600, max: 120 };
const RESCAN_BATCH = 20;

/** Starea unui fișier încărcat, pentru formular (sondajul de după ultima bucată). */
export type GcsAssetStatus = {
  id: string;
  name: string;
  size: number;
  source: "upload" | "link" | "path";
  state: "uploading" | "received" | "ready" | "failed";
  scan: "pending" | "clean" | "infected" | "error" | "skipped";
  kind: string;
  error: string | null;
  received: number;
};

export function assetStatus(a: Pick<DownloadAsset, "id" | "name" | "size" | "source" | "state" | "scanStatus" | "kind" | "error" | "received">): GcsAssetStatus {
  return {
    id: a.id,
    name: a.name,
    size: Number(a.size),
    source: a.source.toLowerCase() as GcsAssetStatus["source"],
    state: a.state.toLowerCase() as GcsAssetStatus["state"],
    scan: a.scanStatus.toLowerCase() as GcsAssetStatus["scan"],
    kind: a.kind,
    error: a.error,
    received: Number(a.received),
  };
}

const chunkKey = (assetId: string, offset: number) => `downloads/chunks/${assetId}/${offset}`;

/**
 * Fișierele unei trimiteri: încărcarea pe bucăți (reluabilă, sub limita cererilor), linkurile externe (cu domeniile
 * blocate) și importul de pe server (staff), apoi jobul `downloads.process`: lipirea, tipul real după conținut,
 * extensiile categoriei, antivirusul și mutarea în stocare (sau în carantină). Plus rescanările periodice și curățenia.
 */
export class GcsDownloadUploads {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      files: GcsFileStore;
      jobs: GcsJobQueue;
      bus: GcsEventBus;
      settings: GcsSettingsService;
      permissions: GcsPermissionService;
      access: GcsDownloadAccess;
      rateLimiter: GcsRateLimiter;
      /** Scannerul pentru o adresă `gazda:port` (testele dau unul fals). */
      scanner: (address: string) => GcsVirusScanner;
      tmpDir: string;
      /** Folderul din care staff-ul importă fișiere urcate pe server (lipsă = importul e oprit). */
      importDir: string | null;
      edition: "vps" | "lite";
      /** O versiune are toate fișierele procesate: serviciul îi decide starea. */
      onAssetReady: (versionId: number) => Promise<void>;
    },
  ) {}

  /** Antivirusul folosit acum (sau `null` = fără: ediția Lite, oprit din ACP, fără adresă). */
  scannerFor(opts: GcsDownloadOptions): GcsVirusScanner | null {
    if (this.deps.edition === "lite" || !opts.av.enabled) return null;
    const target = parseScannerAddress(opts.av.address);
    return target ? this.deps.scanner(opts.av.address) : null;
  }

  async currentScanner(): Promise<GcsVirusScanner> {
    return this.scannerFor(await readDownloadOptions(this.deps.settings)) ?? NO_SCANNER;
  }

  /** Categoria în care se încarcă: cea aleasă (dreptul de încărcare) sau, pentru o versiune nouă, a fișierului (autorul / staff-ul). */
  private async uploadCategory(actor: GcsActor, input: { categoryId: number; fileId?: number | null }) {
    const { db, access } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (!(await access.canUseApp(actor))) throw new GcsNotFound();
    if (input.fileId) {
      const file = await db.downloadFile.findUnique({ where: { id: input.fileId }, select: { authorId: true, categoryId: true } });
      if (!file) throw new GcsNotFound();
      const rights = await access.rights(actor, file.categoryId);
      if (file.authorId !== actor.userId && !rights.moderate) throw new GcsForbidden({ permission: "downloads.upload" });
      const category = await access.category(file.categoryId);
      if (!category) throw new GcsNotFound();
      return { category, rights };
    }
    const category = await access.category(input.categoryId);
    if (!category) throw new GcsValidationError({ categoryId: "invalid_choice" });
    const rights = await access.rights(actor, category.id);
    if (!rights.upload) throw new GcsForbidden({ permission: "downloads.upload" });
    return { category, rights };
  }

  /** Limita unui fișier pentru actor în categorie (octeți; `null` = fără), sau `0` dacă grupul nu are voie deloc. */
  async maxBytes(actor: GcsActor, categoryMb: number | null): Promise<number | null> {
    const [opts, groupMb] = await Promise.all([readDownloadOptions(this.deps.settings), this.deps.permissions.groupValue<number | boolean>(actor, "downloads.max_mb")]);
    const group = typeof groupMb === "number" ? groupMb : -1;
    if (group === 0) return 0;
    return effectiveMaxBytes({ siteMb: opts.maxFileMb, categoryMb, groupMb: group });
  }

  /** Spațiul folosit de un membru (fișierele încărcate și importate, fără linkuri și eșecuri), în octeți. */
  async usedBytes(userId: string): Promise<number> {
    const sum = await this.deps.db.downloadAsset.aggregate({ where: { uploaderId: userId, source: { not: "LINK" }, state: { not: "FAILED" } }, _sum: { size: true } });
    return Number(sum._sum.size ?? 0);
  }

  /** Cota membrului (octeți; `null` = fără limită). */
  async quotaBytes(actor: GcsActor): Promise<number | null> {
    const mb = await this.deps.permissions.groupValue<number | boolean>(actor, "downloads.quota_mb");
    return typeof mb === "number" && mb >= 0 ? mb * 1024 * 1024 : null;
  }

  async siteUsedBytes(): Promise<number> {
    const sum = await this.deps.db.downloadAsset.aggregate({ where: { source: { not: "LINK" }, state: { not: "FAILED" } }, _sum: { size: true } });
    return Number(sum._sum.size ?? 0);
  }

  private async checkSpace(actor: GcsActor, size: number, opts: GcsDownloadOptions): Promise<void> {
    const quota = await this.quotaBytes(actor);
    if (quota !== null && (await this.usedBytes(actor.userId!)) + size > quota) throw new GcsValidationError({ file: "over_quota" }, { quotaMb: String(Math.round(quota / 1048576)) });
    if (opts.totalQuotaGb > 0 && (await this.siteUsedBytes()) + size > opts.totalQuotaGb * 1024 ** 3) throw new GcsValidationError({ file: "site_full" });
  }

  /**
   * Începe încărcarea unui fișier: extensia permisă de categorie, mărimea (cea mai mică limită dintre categorie și grup),
   * cota membrului și a site-ului. Întoarce id-ul și mărimea bucăților.
   */
  async start(actor: GcsActor, input: { categoryId: number; fileId?: number | null; name: string; size: number }): Promise<{ id: string; chunkSize: number; received: number }> {
    const { db, rateLimiter } = this.deps;
    const { category } = await this.uploadCategory(actor, input);
    const name = cleanFileName(input.name);
    const ext = extensionAllowed(name, category.options.extensions);
    if (!ext.ok) throw new GcsValidationError({ file: ext.error }, ext.detail ? { ext: ext.detail } : undefined);
    if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new GcsValidationError({ file: "empty" });
    const max = await this.maxBytes(actor, category.options.maxFileMb);
    if (max === 0) throw new GcsForbidden({ permission: "downloads.max_mb" });
    if (max !== null && input.size > max) throw new GcsValidationError({ file: "too_large" }, { maxMb: String(Math.round(max / 1048576)) });
    const opts = await readDownloadOptions(this.deps.settings);
    await this.checkSpace(actor, input.size, opts);
    const limit = await rateLimiter.consume(`downloads:start:${actor.userId}`, START_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const row = await db.downloadAsset.create({
      data: { uploaderId: actor.userId, categoryId: category.id, name, size: BigInt(input.size), chunkSize: DOWNLOAD_CHUNK_BYTES, source: "UPLOAD", state: "UPLOADING" },
    });
    return { id: row.id, chunkSize: DOWNLOAD_CHUNK_BYTES, received: 0 };
  }

  private async ownAsset(actor: GcsActor, id: string): Promise<DownloadAsset> {
    if (!actor.userId || !/^[a-z0-9]{8,40}$/i.test(id)) throw new GcsNotFound();
    const row = await this.deps.db.downloadAsset.findUnique({ where: { id } });
    if (!row || row.uploaderId !== actor.userId) throw new GcsNotFound();
    return row;
  }

  /**
   * O bucată: exact `chunkSize` octeți (ultima: restul), la `offset = received`. O bucată repetată (răspuns pierdut) se
   * confirmă fără să se scrie din nou. Ultima bucată programează procesarea.
   */
  async chunk(actor: GcsActor, id: string, offset: number, bytes: Buffer): Promise<{ received: number; complete?: true }> {
    const { db, files } = this.deps;
    const row = await this.ownAsset(actor, id);
    const size = Number(row.size);
    const received = Number(row.received);
    if (row.state !== "UPLOADING") {
      if (row.state === "FAILED") throw new GcsValidationError({ file: row.error ?? "failed" });
      return { received: size, complete: true };
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % row.chunkSize !== 0 || offset >= size) throw new GcsValidationError({ offset: "invalid" });
    const expected = Math.min(row.chunkSize, size - offset);
    if (bytes.length !== expected) throw new GcsValidationError({ chunk: "invalid_size" }, { expected: String(expected) });
    if (offset + expected <= received) return { received };
    if (offset !== received) throw new GcsValidationError({ offset: "mismatch" }, { received: String(received) });
    await files.put(chunkKey(row.id, offset), bytes, "application/octet-stream");
    const done = offset + expected >= size;
    const updated = await db.downloadAsset.updateMany({
      where: { id: row.id, received: BigInt(offset), state: "UPLOADING" },
      data: { received: BigInt(offset + expected), ...(done ? { state: "RECEIVED" } : {}) },
    });
    if (updated.count === 0) {
      const now = await db.downloadAsset.findUnique({ where: { id: row.id }, select: { received: true } });
      throw new GcsValidationError({ offset: "mismatch" }, { received: String(Number(now?.received ?? 0)) });
    }
    if (!done) return { received: offset + expected };
    await this.deps.jobs.enqueue(DOWNLOAD_JOBS.process, { assetId: row.id }, { jobId: `downloads-process-${row.id}` });
    return { received: size, complete: true };
  }

  async status(actor: GcsActor, ids: string[]): Promise<GcsAssetStatus[]> {
    if (!actor.userId) return [];
    const valid = [...new Set(ids)].filter((id) => /^[a-z0-9]{8,40}$/i.test(id)).slice(0, 50);
    const rows = await this.deps.db.downloadAsset.findMany({ where: { id: { in: valid }, uploaderId: actor.userId } });
    return rows.map(assetStatus);
  }

  /** Renunță la un fișier încă nelegat de o versiune (formularul nesalvat). */
  async cancel(actor: GcsActor, id: string): Promise<void> {
    const row = await this.ownAsset(actor, id);
    if (row.versionId !== null) throw new GcsForbidden({ reason: "attached" });
    await this.removeAsset(row);
  }

  /** Șterge fișierul din stocare (și bucățile rămase), apoi rândul. */
  async removeAsset(row: Pick<DownloadAsset, "id" | "storageKey" | "chunkSize" | "received" | "size">): Promise<void> {
    await this.dropChunks(row);
    if (row.storageKey) await this.deps.files.delete(row.storageKey).catch(() => {});
    await this.deps.db.downloadAsset.deleteMany({ where: { id: row.id } });
  }

  private async dropChunks(row: Pick<DownloadAsset, "id" | "chunkSize" | "received" | "size">): Promise<void> {
    if (!row.chunkSize) return;
    const end = Math.min(Number(row.size), Number(row.received) + row.chunkSize);
    for (let offset = 0; offset < end; offset += row.chunkSize) await this.deps.files.delete(chunkKey(row.id, offset)).catch(() => {});
  }

  /** Un link extern (mirror): doar https, fără domeniile blocate, cu dreptul de grup `downloads.links`. */
  async link(actor: GcsActor, input: { categoryId: number; fileId?: number | null; url: string; name?: string }): Promise<GcsAssetStatus> {
    const { db, permissions } = this.deps;
    const { category } = await this.uploadCategory(actor, input);
    if (!(await permissions.can(actor, "downloads.links"))) throw new GcsForbidden({ permission: "downloads.links" });
    let url: URL;
    try {
      url = new URL(input.url.trim());
    } catch {
      throw new GcsValidationError({ url: "invalid" });
    }
    if (url.protocol !== "https:" || url.username || url.password || input.url.length > 2000) throw new GcsValidationError({ url: "invalid" });
    const opts = await readDownloadOptions(this.deps.settings);
    if (isBlockedHost(url.hostname, opts.urlBlocklist)) throw new GcsValidationError({ url: "blocked_domain" }, { domain: url.hostname });
    const name = cleanFileName(input.name?.trim() || decodeURIComponent(url.pathname.split("/").pop() || url.hostname));
    const row = await db.downloadAsset.create({
      data: { uploaderId: actor.userId, categoryId: category.id, name, url: url.toString(), source: "LINK", state: "READY", scanStatus: "SKIPPED", kind: "link", chunkSize: 0 },
    });
    return assetStatus(row);
  }

  private async importRoot(actor: GcsActor): Promise<string> {
    if (!this.deps.importDir) throw new GcsForbidden({ reason: "import_disabled" });
    if (!(await this.deps.permissions.can(actor, "downloads.import_path"))) throw new GcsForbidden({ permission: "downloads.import_path" });
    await mkdir(this.deps.importDir, { recursive: true });
    return realpath(this.deps.importDir);
  }

  /** Fișierele din folderul de import (două niveluri), pentru alegerea din formular. */
  async importable(actor: GcsActor): Promise<{ path: string; size: number }[]> {
    const root = await this.importRoot(actor);
    const out: { path: string; size: number }[] = [];
    const walk = async (dir: string, depth: number) => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && depth < 2) await walk(full, depth + 1);
        else if (entry.isFile()) out.push({ path: path.relative(root, full).split(path.sep).join("/"), size: (await stat(full)).size });
        if (out.length >= 500) return;
      }
    };
    await walk(root, 0);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Calea reală a unui fișier din folderul de import (fără ieșiri din folder prin `..` sau legături). */
  private async importFile(root: string, rel: string): Promise<{ full: string; size: number }> {
    if (!rel || rel.includes("\0") || path.isAbsolute(rel)) throw new GcsValidationError({ path: "invalid" });
    const full = await realpath(path.join(root, rel)).catch(() => null);
    if (!full || !(full === root || full.startsWith(root + path.sep))) throw new GcsValidationError({ path: "invalid" });
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) throw new GcsValidationError({ path: "not_found" });
    return { full, size: info.size };
  }

  /** Importă un fișier de pe server (staff): aceleași verificări ca o încărcare (extensie, tip real, antivirus). */
  async importPath(actor: GcsActor, input: { categoryId: number; fileId?: number | null; path: string }): Promise<GcsAssetStatus> {
    const { category } = await this.uploadCategory(actor, input);
    const root = await this.importRoot(actor);
    const { size } = await this.importFile(root, input.path);
    const name = cleanFileName(input.path);
    const ext = extensionAllowed(name, category.options.extensions);
    if (!ext.ok) throw new GcsValidationError({ path: ext.error }, ext.detail ? { ext: ext.detail } : undefined);
    if (size === 0) throw new GcsValidationError({ path: "empty" });
    const row = await this.deps.db.downloadAsset.create({
      data: { uploaderId: actor.userId, categoryId: category.id, name, url: input.path, size: BigInt(size), received: BigInt(size), source: "PATH", state: "RECEIVED", chunkSize: 0 },
    });
    await this.deps.jobs.enqueue(DOWNLOAD_JOBS.process, { assetId: row.id }, { jobId: `downloads-process-${row.id}` });
    return assetStatus(row);
  }

  // ─── Procesarea (jobul) ───────────────────────────────────────────────────────────────────────────────────

  /** Lipește bucățile într-un fișier temporar, cu sha256; verifică mărimea. */
  private async assemble(row: DownloadAsset, tmp: string): Promise<string> {
    const hash = createHash("sha256");
    const out = createWriteStream(tmp);
    try {
      for (let offset = 0; offset < Number(row.size); offset += row.chunkSize) {
        const chunk = await this.deps.files.get(chunkKey(row.id, offset));
        if (!chunk) throw new Error("chunk_missing");
        for await (const part of Readable.fromWeb(chunk.body as import("node:stream/web").ReadableStream) as AsyncIterable<Buffer>) {
          hash.update(part);
          if (!out.write(part)) await once(out, "drain");
        }
      }
    } finally {
      await new Promise<void>((resolve) => out.end(() => resolve()));
    }
    const info = await stat(tmp);
    if (info.size !== Number(row.size)) throw new Error("size_mismatch");
    return hash.digest("hex");
  }

  private async sha256Of(file: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const part of createReadStream(file) as AsyncIterable<Buffer>) hash.update(part);
    return hash.digest("hex");
  }

  private async head(file: string): Promise<Buffer> {
    const handle = await open(file, "r");
    try {
      const buf = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  /**
   * Atașamentele membrilor din restul site-ului (forum, mesaje, chat): antivirusul, dacă setarea „Scanează și
   * atașamentele” e pornită. Întoarce semnătura găsită (încărcarea e refuzată, staff-ul alertat) sau `null`.
   */
  async scanAttachment(file: { name: string; bytes: Buffer }): Promise<string | null> {
    const opts = await readDownloadOptions(this.deps.settings);
    if (!opts.av.forumAttachments || !(await this.deps.access.appEnabled())) return null;
    const scanner = this.scannerFor(opts);
    if (!scanner) return null;
    const verdict = await scanner.scan((async function* () {
      yield file.bytes;
    })(), opts.av.maxScanMb * 1024 * 1024);
    if (verdict.status !== "infected") return null;
    await this.deps.bus.emit({ name: "downloads.infected", payload: { assetId: "attachment", uploaderId: null, signature: verdict.signature, name: file.name }, tags: [] });
    return verdict.signature;
  }

  /** Antivirusul pe un fișier de pe disc; fără scanner: `skipped`. */
  async scanFile(file: string, opts: GcsDownloadOptions): Promise<GcsScanVerdict | { status: "skipped" }> {
    const scanner = this.scannerFor(opts);
    if (!scanner) return { status: "skipped" };
    return scanner.scan(createReadStream(file) as AsyncIterable<Uint8Array>, opts.av.maxScanMb * 1024 * 1024);
  }

  /** Jobul `downloads.process`: tipul real, extensia, antivirusul, apoi stocarea (sau carantina). Idempotent. */
  async process(assetId: string): Promise<void> {
    const { db, files, settings } = this.deps;
    const row = await db.downloadAsset.findUnique({ where: { id: assetId } });
    if (!row || row.state !== "RECEIVED") return;
    const opts = await readDownloadOptions(settings);
    await mkdir(this.deps.tmpDir, { recursive: true });
    const tmp = path.join(this.deps.tmpDir, `${randomUUID()}.part`);
    try {
      let source = tmp;
      let sha256: string;
      if (row.source === "PATH") {
        const root = await realpath(this.deps.importDir ?? "").catch(() => null);
        if (!root) throw new Error("import_disabled");
        source = (await this.importFile(root, row.url ?? "")).full;
        sha256 = await this.sha256Of(source);
      } else {
        sha256 = await this.assemble(row, tmp);
      }
      const size = (await stat(source)).size;
      const kind: GcsFileKind = sniffKind(await this.head(source));
      const category = row.categoryId ? await this.deps.access.category(row.categoryId) : null;
      const allowed = category ? extensionAllowed(row.name, category.options.extensions) : { ok: true as const };
      const match = allowed.ok ? contentMatches(row.name, kind) : allowed;
      if (!match.ok) {
        await db.downloadAsset.update({ where: { id: row.id }, data: { state: "FAILED", error: match.error, kind, size: BigInt(size), sha256 } });
        await this.dropChunks(row);
        await this.afterReady(row.id);
        return;
      }
      const verdict = await this.scanFile(source, opts);
      const infected = verdict.status === "infected";
      const now = new Date();
      const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const ext = extensionOf(row.name);
      const key = infected ? `downloads/quarantine/${month}/${row.id}` : `downloads/files/${month}/${row.id}${ext ? `.${ext}` : ""}`;
      await files.putFile(key, source, infected ? "application/octet-stream" : mimeOf(kind));
      const engine = verdict.status === "skipped" ? null : await this.engineLabel(opts);
      await db.downloadAsset.update({
        where: { id: row.id },
        data: {
          state: "READY",
          storageKey: key,
          kind,
          mime: mimeOf(kind),
          sha256,
          size: BigInt(size),
          received: BigInt(size),
          scanStatus: verdict.status === "clean" ? "CLEAN" : infected ? "INFECTED" : verdict.status === "skipped" ? "SKIPPED" : "ERROR",
          scanResult: infected ? verdict.signature : verdict.status === "error" ? verdict.error : null,
          scanEngine: engine,
          scannedAt: verdict.status === "skipped" ? null : now,
          error: null,
        },
      });
      await this.dropChunks(row);
      if (infected) await this.deps.bus.emit({ name: "downloads.infected", payload: { assetId: row.id, uploaderId: row.uploaderId, signature: verdict.signature, name: row.name }, tags: [] });
      await this.afterReady(row.id);
    } catch (error) {
      const code = error instanceof Error && /^[a-z_]{3,40}$/.test(error.message) ? error.message : "process_failed";
      await db.downloadAsset.update({ where: { id: row.id }, data: { state: "FAILED", error: code } });
      await this.dropChunks(row);
      await this.afterReady(row.id);
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  }

  /** Versiunea fișierului (dacă formularul a fost deja trimis) își poate decide acum starea. */
  private async afterReady(assetId: string): Promise<void> {
    const row = await this.deps.db.downloadAsset.findUnique({ where: { id: assetId }, select: { versionId: true } });
    if (row?.versionId) await this.deps.onAssetReady(row.versionId);
  }

  private engineMemo: { at: number; value: string | null } | null = null;

  /** `ClamAV 1.4.1 / 27450` (motorul și baza de semnături), cache un minut. */
  private async engineLabel(opts: GcsDownloadOptions): Promise<string | null> {
    if (this.engineMemo && Date.now() - this.engineMemo.at < 60_000) return this.engineMemo.value;
    const info = await (this.scannerFor(opts) ?? NO_SCANNER).info();
    const value = info.available ? [info.engine, info.signatures].filter(Boolean).join(" / ") || null : null;
    this.engineMemo = { at: Date.now(), value };
    return value;
  }

  /**
   * Jobul `downloads.rescan`: fișierele publicate scanate înainte de ultima rescanare (sau niciodată) trec din nou prin
   * antivirus, cu semnăturile noi, câte un lot. Un fișier găsit acum infectat e mutat în carantină, iar versiunea lui e
   * blocată (`downloads.infected`).
   */
  async rescan(now = new Date()): Promise<number> {
    const { db, files, settings } = this.deps;
    const opts = await readDownloadOptions(settings);
    const scanner = this.scannerFor(opts);
    if (!scanner || opts.av.rescanHours === 0) return 0;
    if (!(await scanner.info()).available) return 0;
    const before = new Date(now.getTime() - opts.av.rescanHours * 3600_000);
    const rows = await db.downloadAsset.findMany({
      where: { state: "READY", source: { not: "LINK" }, scanStatus: { in: ["CLEAN", "SKIPPED", "ERROR"] }, storageKey: { not: null }, OR: [{ scannedAt: null }, { scannedAt: { lt: before } }] },
      orderBy: { scannedAt: { sort: "asc", nulls: "first" } },
      take: RESCAN_BATCH,
    });
    const engine = await this.engineLabel(opts);
    for (const row of rows) {
      const stored = await files.get(row.storageKey!);
      if (!stored) {
        await db.downloadAsset.update({ where: { id: row.id }, data: { scannedAt: now, scanStatus: "ERROR", scanResult: "missing" } });
        continue;
      }
      const verdict = await scanner.scan(Readable.fromWeb(stored.body as import("node:stream/web").ReadableStream) as AsyncIterable<Uint8Array>, opts.av.maxScanMb * 1024 * 1024);
      if (verdict.status !== "infected") {
        await db.downloadAsset.update({ where: { id: row.id }, data: { scannedAt: now, scanEngine: engine, ...(verdict.status === "clean" ? { scanStatus: "CLEAN", scanResult: null } : { scanStatus: "ERROR", scanResult: verdict.error }) } });
        continue;
      }
      await this.quarantine(row, verdict.signature, now, engine);
    }
    return rows.length;
  }

  /** Mută un fișier în carantină (rescanare sau decizia staff-ului) și anunță aplicația. */
  async quarantine(row: DownloadAsset, signature: string, now = new Date(), engine: string | null = null): Promise<void> {
    const { db, files } = this.deps;
    const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const key = `downloads/quarantine/${month}/${row.id}`;
    if (row.storageKey && row.storageKey !== key) {
      const stored = await files.get(row.storageKey);
      if (stored) {
        await mkdir(this.deps.tmpDir, { recursive: true });
        const tmp = path.join(this.deps.tmpDir, `${randomUUID()}.q`);
        try {
          const out = createWriteStream(tmp);
          for await (const part of Readable.fromWeb(stored.body as import("node:stream/web").ReadableStream) as AsyncIterable<Buffer>) {
            if (!out.write(part)) await once(out, "drain");
          }
          await new Promise<void>((resolve) => out.end(() => resolve()));
          await files.putFile(key, tmp, "application/octet-stream");
          await files.delete(row.storageKey).catch(() => {});
        } finally {
          await rm(tmp, { force: true }).catch(() => {});
        }
      }
    }
    await db.downloadAsset.update({ where: { id: row.id }, data: { storageKey: key, scanStatus: "INFECTED", scanResult: signature.slice(0, 200), scannedAt: now, ...(engine ? { scanEngine: engine } : {}) } });
    await this.deps.bus.emit({ name: "downloads.infected", payload: { assetId: row.id, uploaderId: row.uploaderId, signature, name: row.name, rescan: true }, tags: [] });
  }

  /**
   * Jobul `downloads.maintain` (orar): încărcările neterminate sau nelegate mai vechi decât setarea, cele eșuate (după o
   * zi) și fișierele din carantină mai vechi decât perioada de păstrare (doar cele ale versiunilor deja șterse sau
   * respinse).
   */
  async maintain(now = new Date()): Promise<{ removed: number }> {
    const { db } = this.deps;
    const opts = await readDownloadOptions(this.deps.settings);
    const stale = new Date(now.getTime() - opts.unfinishedHours * 3600_000);
    const day = new Date(now.getTime() - 24 * 3600_000);
    const rows = await db.downloadAsset.findMany({
      where: {
        OR: [
          { versionId: null, createdAt: { lt: stale } },
          { state: "FAILED", versionId: null, createdAt: { lt: day } },
          ...(opts.av.quarantineDays > 0
            ? [{ scanStatus: "INFECTED" as const, scannedAt: { lt: new Date(now.getTime() - opts.av.quarantineDays * 86_400_000) }, OR: [{ versionId: null }, { version: { status: { in: ["REJECTED" as const, "QUARANTINED" as const] } } }] }]
            : []),
        ],
      },
      take: 200,
    });
    for (const row of rows) await this.removeAsset(row);
    // Logul descărcărilor: păstrat cât spune fiecare categorie (0 = mereu).
    for (const c of await this.deps.access.categories()) {
      if (c.options.logDays > 0) await db.downloadLog.deleteMany({ where: { file: { categoryId: c.id }, createdAt: { lt: new Date(now.getTime() - c.options.logDays * 86_400_000) } } });
    }
    return { removed: rows.length };
  }

  registerJobs(jobs: GcsJobQueue, enabled: () => Promise<boolean>): void {
    jobs.register({ name: DOWNLOAD_JOBS.process, handler: async (data) => this.process(String(data.assetId ?? "")) });
    jobs.register({ name: DOWNLOAD_JOBS.maintain, everyMs: 3_600_000, handler: async () => void (await this.maintain()) });
    jobs.register({ name: DOWNLOAD_JOBS.rescan, everyMs: 15 * 60_000, handler: async () => void ((await enabled()) && (await this.rescan())) });
  }
}
