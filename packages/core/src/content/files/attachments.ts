import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Prisma, PrismaClient } from "@gcs/db";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import type { GcsRateLimiter } from "../../auth/rateLimit";
import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError } from "../../errors";
import type { GcsPermissionService } from "../../permissions/service";
import type { GcsActor, GcsContainerRef } from "../../permissions/types";
import type { GcsFileStore } from "./store";

/** Imaginile se recodează (fără EXIF, max 4096 px). */
const IMAGE_FORMATS = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as const;
type ImageMime = keyof typeof IMAGE_FORMATS;

/** Tipurile binare acceptate, recunoscute după magic bytes (nu după extensie). */
const BINARY_MIMES = new Set([
  "application/pdf",
  "application/zip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  // Mesajele vocale din chat (MediaRecorder: WebM/Opus în Chrome și Firefox, MP4/AAC în Safari).
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
]);

/** Fișierele text (configuri de joc, loguri) nu au magic bytes; se acceptă după extensie, doar dacă sunt UTF-8 valid. */
const TEXT_EXTENSIONS = new Set(["txt", "cfg", "ini", "log", "json", "md", "csv", "yml", "yaml"]);

const MAX_IMAGE_SIDE = 4096;
const UPLOAD_LIMIT = { window: 3600, max: 30 };

export type GcsUploadedFile = { name: string; bytes: Buffer };
/**
 * Unde se încarcă: containerul și permisiunea cerută pe el (ex. `{ type: "forum", id: "3" }`, `forums.upload`).
 * Fără container, permisiunea e o setare de grup (ex. `pm.send` pentru mesajele private).
 */
export type GcsUploadContext = { container?: GcsContainerRef; permission: string };

export type GcsAttachmentInfo = {
  id: string;
  url: string;
  filename: string;
  mime: string;
  size: number;
  isImage: boolean;
  width: number | null;
  height: number | null;
};

export type GcsOpenedAttachment = {
  body: ReadableStream<Uint8Array>;
  size: number;
  mime: string;
  filename: string;
  /** Imaginile se afișează în pagină; restul se descarcă (`Content-Disposition: attachment`). */
  inline: boolean;
};

/** Verifică dacă actorul vede conținutul de care e legat un atașament (înregistrată de fiecare modul). */
export type GcsAttachmentAccess = (actor: GcsActor, contentId: string) => Promise<boolean>;

type Tx = Prisma.TransactionClient;
/** Un fișier verificat (și, pentru imagini, recodat), gata de salvat. */
type GcsPreparedFile = { bytes: Buffer; mime: string; ext: string; width: number | null; height: number | null };

function cleanFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?/\\]/g, "").trim().slice(0, 120);
  return clean || "fisier";
}

function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atașamentele (spec §15, „Upload-uri”): tipul real din magic bytes, limite de mărime pe grup, imagini recodate,
 * iar descărcarea respectă permisiunile conținutului de care e legat fișierul.
 */
export class GcsAttachmentService {
  private readonly access = new Map<string, GcsAttachmentAccess>();

  constructor(
    private readonly deps: {
      db: PrismaClient;
      store: GcsFileStore;
      permissions: GcsPermissionService;
      rateLimiter: GcsRateLimiter;
    },
  ) {}

  /** Un modul își înregistrează verificarea pentru `contentType` (ex. `forums.post`). */
  registerAccess(contentType: string, check: GcsAttachmentAccess): void {
    this.access.set(contentType, check);
  }

  async upload(actor: GcsActor, file: GcsUploadedFile, ctx: GcsUploadContext): Promise<GcsAttachmentInfo> {
    const { permissions, rateLimiter } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ permission: ctx.permission });
    if (ctx.container) await permissions.assert(actor, ctx.permission, ctx.container);
    else await permissions.assert(actor, ctx.permission);

    const maxMb = await permissions.groupValue<number | boolean>(actor, "upload.max_mb");
    if (typeof maxMb !== "number" || (maxMb !== -1 && file.bytes.length > maxMb * 1024 * 1024)) {
      throw new GcsValidationError({ file: "too_large" }, { maxMb: String(maxMb) });
    }
    const limit = await rateLimiter.consume(`upload:${actor.userId}`, UPLOAD_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });

    const filename = cleanFilename(file.name);
    return this.save(actor.userId, filename, await this.prepare(file.bytes, filename));
  }

  /**
   * Un fișier adus de importul din altă platformă: aceeași verificare ca un upload nou (tipul real din magic bytes,
   * recodarea imaginilor), fără permisiunile și limitele de grup ale unui membru (dreptul îl verifică ACP-ul care
   * pornește importul). Rămâne nelegat până când importul îl leagă de postare sau de mesaj.
   */
  async importFile(ownerId: string | null, file: GcsUploadedFile, opts: { maxBytes: number }): Promise<GcsAttachmentInfo> {
    if (file.bytes.length > opts.maxBytes) throw new GcsValidationError({ file: "too_large" });
    const filename = cleanFilename(file.name);
    return this.save(ownerId, filename, await this.prepare(file.bytes, filename));
  }

  private async save(ownerId: string | null, filename: string, prepared: GcsPreparedFile): Promise<GcsAttachmentInfo> {
    const { db, store } = this.deps;
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${prepared.ext}`;

    await store.put(key, prepared.bytes, prepared.mime);
    const row = await db.attachment.create({
      data: {
        ownerId,
        storageKey: key,
        filename,
        mime: prepared.mime,
        size: prepared.bytes.length,
        width: prepared.width,
        height: prepared.height,
      },
    });
    return {
      id: row.id,
      url: `/files/${row.id}`,
      filename,
      mime: row.mime,
      size: row.size,
      isImage: prepared.mime in IMAGE_FORMATS,
      width: row.width,
      height: row.height,
    };
  }

  /** Tipul real și, pentru imagini, recodarea. */
  private async prepare(bytes: Buffer, filename: string): Promise<GcsPreparedFile> {
    const detected = await fileTypeFromBuffer(bytes);

    if (detected && detected.mime in IMAGE_FORMATS) {
      const mime = detected.mime as ImageMime;
      const format = IMAGE_FORMATS[mime];
      const animated = format === "gif" || format === "webp";
      let img = sharp(bytes, { animated, limitInputPixels: 100_000_000 });
      if (!animated) img = img.rotate();
      img = img.resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true });
      let out: Buffer;
      try {
        out = await (format === "jpeg" ? img.jpeg({ quality: 85, mozjpeg: true }) : format === "png" ? img.png() : format === "webp" ? img.webp({ quality: 85 }) : img.gif()).toBuffer();
      } catch {
        // Antet valid, conținut stricat (sau prea mare): e o eroare a fișierului, nu a serverului.
        throw new GcsValidationError({ file: "invalid_image" });
      }
      const meta = await sharp(out).metadata();
      return { bytes: out, mime, ext: detected.ext, width: meta.width ?? null, height: meta.pageHeight ?? meta.height ?? null };
    }
    if (detected && BINARY_MIMES.has(detected.mime)) {
      return { bytes, mime: detected.mime, ext: detected.ext, width: null, height: null };
    }
    const ext = path.extname(filename).slice(1).toLowerCase();
    if (!detected && TEXT_EXTENSIONS.has(ext) && isUtf8Text(bytes)) {
      return { bytes, mime: "text/plain", ext, width: null, height: null };
    }
    throw new GcsValidationError({ file: "unsupported_type" });
  }

  /**
   * Avatarul sau cover-ul unui user (specul etapei 3, §4): doar imagini, recodate în WebP
   * (avatar 512×512 decupat, cover max 1920 px lățime). Animația se păstrează doar cu `animated: true`
   * (GIF/WebP animat → WebP animat); altfel rămâne primul cadru. Legat direct de user (`user.avatar` / `user.cover`),
   * iar fișierele vechi de același fel sunt șterse.
   */
  async uploadProfileImage(
    actor: GcsActor,
    file: GcsUploadedFile,
    opts: { kind: "avatar" | "cover"; maxMb: number; animated: boolean },
    internal: { skipRateLimit?: boolean } = {},
  ): Promise<GcsAttachmentInfo> {
    const { db, store, rateLimiter } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (opts.maxMb !== -1 && file.bytes.length > opts.maxMb * 1024 * 1024) {
      throw new GcsValidationError({ file: "too_large" }, { maxMb: String(opts.maxMb) });
    }
    if (!internal.skipRateLimit) {
      const limit = await rateLimiter.consume(`upload:${actor.userId}`, UPLOAD_LIMIT);
      if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    }

    const detected = await fileTypeFromBuffer(file.bytes);
    if (!detected || !(detected.mime in IMAGE_FORMATS)) throw new GcsValidationError({ file: "unsupported_type" });
    const animatedSource = detected.mime === "image/gif" || detected.mime === "image/webp";
    const animated = opts.animated && animatedSource;
    let out: Buffer;
    try {
      let img = sharp(file.bytes, { animated, limitInputPixels: 100_000_000 });
      if (!animated) img = img.rotate();
      img =
        opts.kind === "avatar"
          ? img.resize({ width: 512, height: 512, fit: "cover", position: "attention" })
          : img.resize({ width: 1920, height: 1080, fit: "inside", withoutEnlargement: true });
      out = await img.webp({ quality: 85 }).toBuffer();
    } catch {
      throw new GcsValidationError({ file: "invalid_image" });
    }
    const meta = await sharp(out).metadata();
    const contentType = `user.${opts.kind}`;
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.webp`;
    await store.put(key, out, "image/webp");
    const previous = await db.attachment.findMany({ where: { contentType, contentId: actor.userId } });
    const row = await db.attachment.create({
      data: {
        ownerId: actor.userId,
        storageKey: key,
        filename: `${opts.kind}.webp`,
        mime: "image/webp",
        size: out.length,
        width: meta.width ?? null,
        height: meta.pageHeight ?? meta.height ?? null,
        contentType,
        contentId: actor.userId,
      },
    });
    await this.deleteRows(previous);
    return { id: row.id, url: `/files/${row.id}`, filename: row.filename, mime: row.mime, size: row.size, isImage: true, width: row.width, height: row.height };
  }

  /**
   * O imagine cu mărimea fixată de modul (ex. logo-ul sau bannerul unui clan, specul 2026-10-08-clanuri §9): doar
   * imagini (tipul real din magic bytes), recodate în WebP fără EXIF și fără animație; `fit: "cover"` decupează exact la
   * `width × height`, `"inside"` o încadrează (fără mărire). Limita de mărime o dă apelantul (opțiunile modulului), iar
   * dreptul de a încărca îl verifică tot apelantul. Rămâne nelegată (a membrului) până când modulul o leagă de conținut.
   */
  async uploadImage(actor: GcsActor, file: GcsUploadedFile, opts: { maxBytes: number; width: number; height: number; fit: "cover" | "inside" }): Promise<GcsAttachmentInfo> {
    const { rateLimiter } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (file.bytes.length > opts.maxBytes) throw new GcsValidationError({ file: "too_large" }, { maxKb: String(Math.floor(opts.maxBytes / 1024)) });
    const limit = await rateLimiter.consume(`upload:${actor.userId}`, UPLOAD_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    return this.storeImage(actor.userId, file, opts);
  }

  /**
   * Aceeași recodare ca `uploadImage`, pentru imaginile aduse de un modul în numele site-ului (ex. imaginile hărților
   * încărcate în masă din ACP sau descărcate după un șablon de adresă): fără limitele de upload ale unui membru. Dreptul
   * și limitele le verifică apelantul; fișierul rămâne nelegat până când modulul îl leagă de conținut.
   */
  async storeImage(ownerId: string | null, file: GcsUploadedFile, opts: { maxBytes: number; width: number; height: number; fit: "cover" | "inside" }): Promise<GcsAttachmentInfo> {
    if (file.bytes.length > opts.maxBytes) throw new GcsValidationError({ file: "too_large" }, { maxKb: String(Math.floor(opts.maxBytes / 1024)) });
    const detected = await fileTypeFromBuffer(file.bytes);
    if (!detected || !(detected.mime in IMAGE_FORMATS)) throw new GcsValidationError({ file: "unsupported_type" });
    let out: Buffer;
    try {
      const img = sharp(file.bytes, { limitInputPixels: 100_000_000 }).rotate();
      out = await img
        .resize(opts.fit === "cover" ? { width: opts.width, height: opts.height, fit: "cover", position: "attention" } : { width: opts.width, height: opts.height, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch {
      throw new GcsValidationError({ file: "invalid_image" });
    }
    const meta = await sharp(out).metadata();
    return this.save(ownerId, `${cleanFilename(file.name).replace(/\.[a-z0-9]+$/i, "") || "imagine"}.webp`, {
      bytes: out,
      mime: "image/webp",
      ext: "webp",
      width: meta.width ?? null,
      height: meta.height ?? null,
    });
  }

  /**
   * Logo-ul sau favicon-ul unei teme (specul etapei 5): doar imagini, recodate, fără animație. Logo-ul devine WebP
   * (max 800×240, transparența se păstrează), favicon-ul PNG 64×64 (încadrat, fundal transparent). Fișierul e public
   * (`theme.logo` / `theme.favicon`, legat de cheia temei); dreptul ACP îl verifică apelantul. Imaginea antetului
   * (designul Nova, `theme.header`) poate avea 5 MB și devine WebP de cel mult 2560×800.
   */
  async uploadSiteImage(actor: GcsActor, file: GcsUploadedFile, opts: { kind: "logo" | "favicon" | "header"; themeKey: string }): Promise<GcsAttachmentInfo> {
    const { db, store } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const maxMb = opts.kind === "header" ? 5 : 2;
    if (file.bytes.length > maxMb * 1024 * 1024) throw new GcsValidationError({ file: "too_large" }, { maxMb: String(maxMb) });
    const detected = await fileTypeFromBuffer(file.bytes);
    if (!detected || !(detected.mime in IMAGE_FORMATS)) throw new GcsValidationError({ file: "unsupported_type" });
    const favicon = opts.kind === "favicon";
    let out: Buffer;
    try {
      const img = sharp(file.bytes, { limitInputPixels: 100_000_000 }).rotate();
      out = favicon
        ? await img.resize({ width: 64, height: 64, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
        : opts.kind === "header"
          ? await img.resize({ width: 2560, height: 800, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
          : await img.resize({ width: 800, height: 240, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
    } catch {
      throw new GcsValidationError({ file: "invalid_image" });
    }
    const meta = await sharp(out).metadata();
    const [mime, ext] = favicon ? (["image/png", "png"] as const) : (["image/webp", "webp"] as const);
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
    await store.put(key, out, mime);
    const row = await db.attachment.create({
      data: {
        ownerId: actor.userId,
        storageKey: key,
        filename: `${opts.kind}.${ext}`,
        mime,
        size: out.length,
        width: meta.width ?? null,
        height: meta.height ?? null,
        contentType: `theme.${opts.kind}`,
        contentId: opts.themeKey,
      },
    });
    return { id: row.id, url: `/files/${row.id}`, filename: row.filename, mime, size: row.size, isImage: true, width: row.width, height: row.height };
  }

  /**
   * Dacă imaginea de profil e animată, o înlocuiește cu primul cadru (ex. cover-ul unui VIP expirat).
   * Întoarce noul atașament, sau `null` dacă nu era nimic de schimbat.
   */
  async flattenProfileImage(userId: string, kind: "avatar" | "cover"): Promise<GcsAttachmentInfo | null> {
    const { db, store } = this.deps;
    const row = await db.attachment.findFirst({ where: { contentType: `user.${kind}`, contentId: userId }, orderBy: { createdAt: "desc" } });
    if (!row) return null;
    const file = await store.get(row.storageKey);
    if (!file) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of file.body as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (((await sharp(bytes, { animated: true }).metadata()).pages ?? 1) <= 1) return null;
    return this.uploadProfileImage(
      { userId, groupIds: [], primaryGroupId: 0, isBanned: false, ip: "" },
      { name: row.filename, bytes },
      { kind, maxMb: -1, animated: false },
      { skipRateLimit: true },
    );
  }

  /** Șterge avatarul sau cover-ul unui user (resetare de către staff sau înlocuire). */
  async deleteProfileImage(userId: string, kind: "avatar" | "cover"): Promise<void> {
    await this.deleteRows(await this.deps.db.attachment.findMany({ where: { contentType: `user.${kind}`, contentId: userId } }));
  }

  /**
   * Un lot din fișierele încărcate de un membru și nelegate de niciun conținut (ștergerea contului); întoarce câte s-au
   * șters (0 = nu mai sunt).
   */
  async deleteUnattachedOf(ownerId: string, limit = 100): Promise<number> {
    const rows = await this.deps.db.attachment.findMany({ where: { ownerId, contentType: null }, take: limit, select: { id: true, storageKey: true } });
    await this.deleteRows(rows);
    return rows.length;
  }

  /** Renunță la fișiere încărcate și încă nelegate (ex. un emoticon respins după verificarea dimensiunilor). */
  async discard(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.deleteRows(await this.deps.db.attachment.findMany({ where: { id: { in: ids }, contentType: null }, select: { id: true, storageKey: true } }));
  }

  private async deleteRows(rows: { id: string; storageKey: string }[]): Promise<void> {
    if (rows.length === 0) return;
    for (const row of rows) await this.deps.store.delete(row.storageKey).catch(() => {});
    await this.deps.db.attachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  }

  /**
   * Leagă atașamentele încărcate de conținutul salvat, în tranzacția conținutului.
   * Doar atașamentele proprietarului, încă nelegate (sau deja legate de același conținut).
   */
  async attach(tx: Tx, ids: string[], ref: { contentType: string; contentId: string; ownerId: string }): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const rows = await tx.attachment.findMany({ where: { id: { in: unique } } });
    const ok = rows.length === unique.length &&
      rows.every((r) => r.ownerId === ref.ownerId && (r.contentType === null || (r.contentType === ref.contentType && r.contentId === ref.contentId)));
    if (!ok) throw new GcsForbidden({ reason: "attachment" });
    await tx.attachment.updateMany({ where: { id: { in: unique } }, data: { contentType: ref.contentType, contentId: ref.contentId } });
  }

  /** Deschide un atașament pentru descărcare. Orice lipsă de acces arată ca „nu există” (nu dezvăluim fișierul). */
  async open(actor: GcsActor, id: string): Promise<GcsOpenedAttachment> {
    const row = await this.deps.db.attachment.findUnique({ where: { id } });
    if (!row) throw new GcsNotFound();
    const allowed = row.contentType === null || row.contentId === null
      ? actor.userId !== null && row.ownerId === actor.userId
      : ((await this.access.get(row.contentType)?.(actor, row.contentId)) ?? false);
    if (!allowed) throw new GcsNotFound();

    const file = await this.deps.store.get(row.storageKey);
    if (!file) throw new GcsNotFound();
    return { body: file.body, size: file.size, mime: row.mime, filename: row.filename, inline: row.mime in IMAGE_FORMATS };
  }

  /** Șterge din store fișierele unui conținut șters (după commit-ul tranzacției). */
  async deleteFor(contentType: string, contentIds: string[]): Promise<void> {
    await this.deleteRows(await this.deps.db.attachment.findMany({ where: { contentType, contentId: { in: contentIds } } }));
  }
}
