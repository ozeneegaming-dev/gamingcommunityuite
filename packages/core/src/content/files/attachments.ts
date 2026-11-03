import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Prisma, PrismaClient } from "@gcs/db";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import type { GcsRateLimiter } from "../../auth/rateLimit";
import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError } from "../../errors";
import type { GcsPermissionService } from "../../permissions/service";
import type { GcsActor, GcsContainerRef } from "../../permissions/types";
import { videoContainerOk } from "../../plugins/media";
import { HEADER_VIDEO_MAX_MB } from "../../themes/settings";
import { GCS_IMAGE_DEFAULTS, processImage, thumbnailOf, type GcsImageFormat, type GcsUploadPolicy } from "./images";
import type { GcsByteRange, GcsFileStore } from "./store";
import { looksLikeSvg, sanitizeSvg, SVG_MAX_BYTES } from "./svg";
import { fileExtension, GCS_BINARY_TYPES, GCS_KNOWN_EXTENSIONS, GCS_TEXT_EXTENSIONS, uploadTypeError } from "./uploadPolicy";

/** Imaginile decorative (iconițe, fundaluri ale forumurilor și widget-urilor): publice, legate de ținta lor. */
export const DECOR_CONTENT_TYPE = "decor.image";

/** Imaginile se recodează (fără EXIF, latura maximă și formatul din setările încărcărilor). */
const IMAGE_FORMATS = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as const;
type ImageMime = keyof typeof IMAGE_FORMATS;
const FORMAT_EXT: Record<GcsImageFormat, string> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif" };

/**
 * Videoul din spatele antetului unei teme: MP4 sau WebM (tipul citit din conținut, containerul verificat), cel mult
 * 25 MB, păstrat așa cum e (fără recodare). E public, ca imaginile temei, și se servește cu `Range`.
 */
export const HEADER_VIDEO_CONTENT_TYPE = "theme.headerVideo";
const VIDEO_FORMATS = { "video/mp4": "mp4", "video/webm": "webm" } as const;

/** Recodarea fără setările încărcărilor (ex. emoticoanele Chat Pro, care au limitele lor): formatul original, max 4096 px. */
const ORIGINAL_IMAGE = { maxSide: 4096, quality: 85 };
const UPLOAD_LIMIT = { window: 3600, max: 30 };

/** Fără setări (teste, scripturi): valorile implicite ale ACP → Setări → Încărcări și imagini. */
export const GCS_DEFAULT_UPLOAD_POLICY: GcsUploadPolicy = { allowedExtensions: GCS_KNOWN_EXTENSIONS, image: GCS_IMAGE_DEFAULTS };

/** Cheia miniaturii unei imagini, lângă fișier (`2026/11/<uuid>.thumb.webp`). */
export const thumbnailKey = (storageKey: string) => `${storageKey.replace(/\.[a-z0-9]+$/i, "")}.thumb.webp`;

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
  /** Imaginile (și videoul antetului) se afișează în pagină; restul se descarcă (`Content-Disposition: attachment`). */
  inline: boolean;
  /** Fișierul răspunde la cererile `Range` ale player-ului (videoul antetului); `range` = partea trimisă, dacă s-a cerut. */
  seekable?: boolean;
  range?: GcsByteRange | null;
};

/** Verifică dacă actorul vede conținutul de care e legat un atașament (înregistrată de fiecare modul). */
export type GcsAttachmentAccess = (actor: GcsActor, contentId: string) => Promise<boolean>;

type Tx = Prisma.TransactionClient;
/** Un fișier verificat (și, pentru imagini, recodat), gata de salvat; `thumb` = miniatura imaginii, dacă are una. */
type GcsPreparedFile = { bytes: Buffer; mime: string; ext: string; width: number | null; height: number | null; thumb?: Buffer | null };

function cleanFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?/\\]/g, "").trim().slice(0, 120);
  return clean || "fisier";
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp"]);

/** Numele afișat al unei imagini recodate în alt format (ex. `poza.jpg` → `poza.webp`); celelalte fișiere rămân. */
function withExtension(filename: string, ext: string): string {
  const m = /^(.+)\.([A-Za-z0-9]{1,8})$/.exec(filename);
  if (!m) return filename;
  const current = m[2]!.toLowerCase();
  if (!IMAGE_EXTS.has(current) || current === ext || (current === "jpeg" && ext === "jpg")) return filename;
  return `${m[1]}.${ext}`;
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
      /** Setările încărcărilor (extensiile permise, imaginile), citite la fiecare upload; lipsă = valorile implicite. */
      policy?: () => Promise<GcsUploadPolicy>;
    },
  ) {}

  private async policy(): Promise<GcsUploadPolicy> {
    return this.deps.policy ? this.deps.policy().catch(() => GCS_DEFAULT_UPLOAD_POLICY) : GCS_DEFAULT_UPLOAD_POLICY;
  }

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
    const prepared = await this.prepare(file.bytes, filename, await this.policy());
    return this.save(actor.userId, withExtension(filename, prepared.ext), prepared);
  }

  /**
   * Un fișier adus de importul din altă platformă: aceeași verificare ca un upload nou (tipul real din magic bytes,
   * extensiile permise, recodarea imaginilor după setări), fără permisiunile și limitele de grup ale unui membru (dreptul
   * îl verifică ACP-ul care pornește importul). Rămâne nelegat până când importul îl leagă de postare sau de mesaj.
   * `original`: imaginea păstrează formatul (ex. emoticoanele Chat Pro, cu limitele lor), fără lista de extensii.
   */
  async importFile(ownerId: string | null, file: GcsUploadedFile, opts: { maxBytes: number; original?: boolean }): Promise<GcsAttachmentInfo> {
    if (file.bytes.length > opts.maxBytes) throw new GcsValidationError({ file: "too_large" });
    const filename = cleanFilename(file.name);
    const prepared = await this.prepare(file.bytes, filename, opts.original ? null : await this.policy());
    return this.save(ownerId, withExtension(filename, prepared.ext), prepared);
  }

  private async save(ownerId: string | null, filename: string, prepared: GcsPreparedFile): Promise<GcsAttachmentInfo> {
    const { db, store } = this.deps;
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${prepared.ext}`;

    await store.put(key, prepared.bytes, prepared.mime);
    if (prepared.thumb) await store.put(thumbnailKey(key), prepared.thumb, "image/webp");
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

  /**
   * Tipul real (magic bytes) și extensia (`uploadTypeError`), apoi, pentru imagini, recodarea cu setările încărcărilor:
   * latura maximă, calitatea, WebP, metadatele și miniatura. Fără setări (`null`): formatul original, max 4096 px,
   * fără EXIF și fără lista de extensii (doar tipurile cunoscute, fără cele periculoase).
   */
  private async prepare(bytes: Buffer, filename: string, policy: GcsUploadPolicy | null): Promise<GcsPreparedFile> {
    const detected = await fileTypeFromBuffer(bytes);
    const sniffed = detected ? { mime: detected.mime, ext: detected.ext } : null;
    // UTF-8 se verifică doar pentru extensiile de text (un binar mare fără magic bytes nu se decodează degeaba).
    const text = !detected && GCS_TEXT_EXTENSIONS.includes(fileExtension(filename)) && isUtf8Text(bytes);
    const error = uploadTypeError(filename, sniffed, policy ? policy.allowedExtensions : GCS_KNOWN_EXTENSIONS, text);
    if (error) throw new GcsValidationError({ file: error });

    if (detected && detected.mime in IMAGE_FORMATS) {
      const source = IMAGE_FORMATS[detected.mime as ImageMime];
      const image = policy?.image;
      const format: GcsImageFormat = image?.webp ? "webp" : source;
      const side = image?.maxSide ?? ORIGINAL_IMAGE.maxSide;
      const out = await processImage(bytes, {
        width: side,
        height: side,
        fit: "inside",
        format,
        quality: image?.quality ?? ORIGINAL_IMAGE.quality,
        animated: source === "gif" || source === "webp",
        stripMetadata: image?.stripMetadata ?? true,
      });
      // Miniatura doar pentru imaginile mai mari decât ea (altfel imaginea însăși e destul de mică).
      const thumbSide = image?.thumbnailSide ?? 0;
      const big = thumbSide > 0 && Math.max(out.width ?? 0, out.height ?? 0) > thumbSide;
      const thumb = big ? (await thumbnailOf(out.bytes, thumbSide).catch(() => null))?.bytes ?? null : null;
      return { bytes: out.bytes, mime: `image/${format}`, ext: FORMAT_EXT[format], width: out.width, height: out.height, thumb };
    }
    if (detected && GCS_BINARY_TYPES[detected.mime]) {
      return { bytes, mime: detected.mime, ext: detected.ext, width: null, height: null };
    }
    return { bytes, mime: "text/plain", ext: path.extname(filename).slice(1).toLowerCase(), width: null, height: null };
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
    // Mărimile proprii (avatar 512×512 decupat, cover max 1920×1080); calitatea și metadatele din setările încărcărilor.
    const image = (await this.policy()).image;
    const processed = await processImage(file.bytes, {
      ...(opts.kind === "avatar" ? { width: 512, height: 512, fit: "cover" as const } : { width: 1920, height: 1080, fit: "inside" as const }),
      format: "webp",
      quality: image.quality,
      animated,
      stripMetadata: image.stripMetadata,
    });
    const out = processed.bytes;
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
        width: processed.width,
        height: processed.height,
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
    const out = await processImage(file.bytes, { width: opts.width, height: opts.height, fit: opts.fit, format: "webp", quality: 88 });
    return this.save(ownerId, `${cleanFilename(file.name).replace(/\.[a-z0-9]+$/i, "") || "imagine"}.webp`, {
      bytes: out.bytes,
      mime: "image/webp",
      ext: "webp",
      width: out.width,
      height: out.height,
    });
  }

  /**
   * O imagine decorativă (Aspect forumuri: iconița, fundalul unui forum sau al benzii unui widget): PNG, WebP, GIF, JPEG
   * sau SVG. SVG-ul se curăță (listă albă, fără scripturi și legături externe) și se rasterizează; totul devine WebP de cel
   * mult `maxSide` px, fără EXIF. Un GIF / WebP animat rămâne animat doar cu `animated`. Fișierul e public
   * (`decor.image`, legat de `target`, ex. `forum:12:icon`); dreptul ACP și limita de rată le verifică apelantul.
   */
  async storeDecorImage(ownerId: string | null, file: GcsUploadedFile, opts: { maxBytes: number; maxSide: number; animated: boolean; target: string }): Promise<GcsAttachmentInfo> {
    const { db, store } = this.deps;
    if (file.bytes.length > opts.maxBytes) throw new GcsValidationError({ file: "too_large" }, { maxKb: String(Math.floor(opts.maxBytes / 1024)) });
    if (!/^[a-z][a-z0-9_.:-]{0,80}$/.test(opts.target)) throw new GcsValidationError({ target: "invalid" });
    const detected = await fileTypeFromBuffer(file.bytes);
    let processed;
    if (detected && detected.mime in IMAGE_FORMATS) {
      const animated = opts.animated && (detected.mime === "image/gif" || detected.mime === "image/webp");
      processed = await processImage(file.bytes, { width: opts.maxSide, height: opts.maxSide, fit: "inside", format: "webp", quality: 88, animated });
    } else if (!detected && file.bytes.length <= SVG_MAX_BYTES && looksLikeSvg(file.bytes)) {
      const clean = sanitizeSvg(file.bytes.toString("utf8"));
      if (!clean) throw new GcsValidationError({ file: "invalid_svg" });
      // Desenul vectorial se rasterizează la latura maximă (iconițele rămân clare pe ecranele dense).
      processed = await processImage(Buffer.from(clean), { width: opts.maxSide, height: opts.maxSide, fit: "inside", enlarge: true, density: 300, format: "webp", quality: 90 });
    } else {
      throw new GcsValidationError({ file: "unsupported_type" });
    }
    const out = processed.bytes;
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.webp`;
    await store.put(key, out, "image/webp");
    const row = await db.attachment.create({
      data: {
        ownerId,
        storageKey: key,
        filename: `${cleanFilename(file.name).replace(/\.[a-z0-9]+$/i, "") || "imagine"}.webp`,
        mime: "image/webp",
        size: out.length,
        width: processed.width,
        height: processed.height,
        contentType: DECOR_CONTENT_TYPE,
        contentId: opts.target,
      },
    });
    return { id: row.id, url: `/files/${row.id}`, filename: row.filename, mime: row.mime, size: row.size, isImage: true, width: row.width, height: row.height };
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
    const processed = await processImage(
      file.bytes,
      favicon
        ? { width: 64, height: 64, fit: "contain", format: "png", quality: 100 }
        : opts.kind === "header"
          ? { width: 2560, height: 800, fit: "inside", format: "webp", quality: 82 }
          : { width: 800, height: 240, fit: "inside", format: "webp", quality: 90 },
    );
    const out = processed.bytes;
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
        width: processed.width,
        height: processed.height,
        contentType: `theme.${opts.kind}`,
        contentId: opts.themeKey,
      },
    });
    return { id: row.id, url: `/files/${row.id}`, filename: row.filename, mime, size: row.size, isImage: true, width: row.width, height: row.height };
  }

  /**
   * Videoul din spatele antetului unei teme (MP4 / WebM, cel mult 25 MB): tipul se citește din conținut (semnătura
   * fișierului, nu extensia), iar containerul trebuie să aibă partea cu pistele (`moov` / `Segment`), altfel nu e un
   * video adevărat.
   * Fișierul rămâne cum e (fără recodare); e public (`theme.headerVideo`, legat de cheia temei). Dreptul ACP îl verifică
   * apelantul.
   */
  async uploadSiteVideo(actor: GcsActor, file: GcsUploadedFile, opts: { themeKey: string }): Promise<GcsAttachmentInfo> {
    const { db, store } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (file.bytes.length > HEADER_VIDEO_MAX_MB * 1024 * 1024) throw new GcsValidationError({ file: "too_large" }, { maxMb: String(HEADER_VIDEO_MAX_MB) });
    const detected = await fileTypeFromBuffer(file.bytes);
    if (!detected || !(detected.mime in VIDEO_FORMATS)) throw new GcsValidationError({ file: "unsupported_type" });
    const mime = detected.mime as keyof typeof VIDEO_FORMATS;
    if (!videoContainerOk(mime, file.bytes)) throw new GcsValidationError({ file: "invalid_video" });
    const ext = VIDEO_FORMATS[mime];
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
    await store.put(key, file.bytes, mime);
    const row = await db.attachment.create({
      data: { ownerId: actor.userId, storageKey: key, filename: `header-video.${ext}`, mime, size: file.bytes.length, contentType: HEADER_VIDEO_CONTENT_TYPE, contentId: opts.themeKey },
    });
    return { id: row.id, url: `/files/${row.id}`, filename: row.filename, mime, size: row.size, isImage: false, width: null, height: null };
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

  /**
   * Șterge fișierele, legate sau nu (ACP › Sistem › Fișiere; dreptul îl verifică apelantul). Conținutul care le folosea
   * rămâne, cu imaginea lipsă. Întoarce câte fișiere a șters.
   */
  async removeAny(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.deps.db.attachment.findMany({ where: { id: { in: ids } }, select: { id: true, storageKey: true } });
    await this.deleteRows(rows);
    return rows.length;
  }

  private async deleteRows(rows: { id: string; storageKey: string }[]): Promise<void> {
    if (rows.length === 0) return;
    for (const row of rows) {
      await this.deps.store.delete(row.storageKey).catch(() => {});
      // Miniatura imaginii, dacă are una (lipsa ei nu e o eroare).
      await this.deps.store.delete(thumbnailKey(row.storageKey)).catch(() => {});
    }
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

  /**
   * Deschide un atașament pentru descărcare. Orice lipsă de acces arată ca „nu există” (nu dezvăluim fișierul). Cu
   * `thumb`, miniatura imaginii (WebP), dacă are una; altfel fișierul întreg. Videoul antetului se derulează: `range`
   * primește mărimea fișierului și alege partea de trimis (antetul `Range` al cererii).
   */
  async open(actor: GcsActor, id: string, opts: { thumb?: boolean; range?: (size: number) => GcsByteRange | null } = {}): Promise<GcsOpenedAttachment> {
    const row = await this.deps.db.attachment.findUnique({ where: { id } });
    if (!row) throw new GcsNotFound();
    const allowed = row.contentType === null || row.contentId === null
      ? actor.userId !== null && row.ownerId === actor.userId
      : ((await this.access.get(row.contentType)?.(actor, row.contentId)) ?? false);
    if (!allowed) throw new GcsNotFound();
    return this.openRow(row, opts);
  }

  /**
   * Deschide orice atașament, fără verificarea accesului conținutului: doar pentru ACP › Sistem › Fișiere, după poarta
   * ACP și dreptul pe secțiune (verificate de apelant). Miniatura, dacă e cerută și există.
   */
  async openTrusted(id: string, opts: { thumb?: boolean } = {}): Promise<GcsOpenedAttachment> {
    const row = await this.deps.db.attachment.findUnique({ where: { id } });
    if (!row) throw new GcsNotFound();
    return this.openRow(row, opts);
  }

  private async openRow(
    row: { storageKey: string; filename: string; mime: string; contentType: string | null; size: number },
    opts: { thumb?: boolean; range?: (size: number) => GcsByteRange | null },
  ): Promise<GcsOpenedAttachment> {
    const image = row.mime in IMAGE_FORMATS;
    if (opts.thumb && image) {
      const thumb = await this.deps.store.get(thumbnailKey(row.storageKey)).catch(() => null);
      if (thumb) return { body: thumb.body, size: thumb.size, mime: "image/webp", filename: row.filename.replace(/\.[a-z0-9]+$/i, "") + ".webp", inline: true };
    }
    const video = row.contentType === HEADER_VIDEO_CONTENT_TYPE && row.mime in VIDEO_FORMATS;
    const range = video && opts.range ? opts.range(row.size) : null;
    const file = await this.deps.store.get(row.storageKey, range ?? undefined);
    if (!file) throw new GcsNotFound();
    if (video) return { body: file.body, size: file.size, mime: row.mime, filename: row.filename, inline: true, seekable: true, range };
    return { body: file.body, size: file.size, mime: row.mime, filename: row.filename, inline: image };
  }

  /**
   * Fișierele încărcate și nelegate de niciun conținut, mai vechi decât `before` (curățenia fișierelor orfane), cel mult
   * `limit`, cele mai vechi primele; `after` = id-ul de după care continuă lotul următor.
   */
  async unattachedBefore(before: Date, limit: number, after: string | null = null): Promise<{ id: string; storageKey: string; size: number }[]> {
    return this.deps.db.attachment.findMany({
      where: { contentType: null, createdAt: { lt: before }, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true, storageKey: true, size: true },
    });
  }

  /** Șterge din store fișierele unui conținut șters (după commit-ul tranzacției). */
  async deleteFor(contentType: string, contentIds: string[]): Promise<void> {
    await this.deleteRows(await this.deps.db.attachment.findMany({ where: { contentType, contentId: { in: contentIds } } }));
  }
}
