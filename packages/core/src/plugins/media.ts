import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@gcs/db";
import { fileTypeFromBuffer } from "file-type";
import sharp, { type Sharp } from "sharp";
import type { GcsRedisRateLimiter } from "../auth/rateLimit";
import type { GcsByteRange, GcsFileStore } from "../content/files/store";
import { GcsRateLimited, GcsValidationError } from "../errors";
import { composeApng, GcsApngError, type GcsApngLimits } from "./apng";
import type { GcsPluginMediaKind } from "./catalog";
import type { GcsPluginManifest } from "./manifest";

/** Declarația `media` din manifest (după validare, cu valorile implicite). */
export type GcsPluginMediaDecl = NonNullable<GcsPluginManifest["media"]>;

/** Un fișier media al unui plugin, așa cum îl vede pluginul (`ctx.media`, corpul formularelor). */
export type GcsPluginMediaInfo = {
  id: string;
  kind: GcsPluginMediaKind;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  url: string;
  status: "pending" | "kept";
  createdAt: string;
  /**
   * Doar în rezultatul încărcării (corpul formularului), nu și în `get`/`list`: SHA-256 al fișierului trimis (hex, ca
   * pluginul să recunoască duplicatele), numele lui original (curățat) și numărul de cadre al unei imagini animate.
   */
  sha256?: string;
  originalName?: string;
  frames?: number;
};

/** Un fișier verificat (imaginile recodate), gata de salvat. `frames` > 1 = imagine animată. */
export type GcsPreparedPluginMedia = {
  kind: GcsPluginMediaKind;
  mime: string;
  ext: string;
  bytes: Buffer;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  frames?: number;
};

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/apng", "image/webp", "image/gif"]);
/**
 * Limitele imaginilor animate (APNG, GIF, WebP): cadrele, latura pânzei, pixelii tuturor cadrelor (memoria, ×4 octeți)
 * și timpul de lucru. Un fișier peste ele e refuzat cu un motiv clar (`too_many_frames`, `animation_too_large`,
 * `processing_timeout`).
 */
export const PLUGIN_ANIMATION_LIMITS: GcsApngLimits = { maxFrames: 600, maxSide: 4096, maxPixels: 32_000_000, timeBudgetMs: 20_000 };
const VIDEO = { "video/mp4": "mp4", "video/webm": "webm" } as const;
const AUDIO = { "audio/mpeg": "mp3", "audio/ogg": "ogg" } as const;
const MB = 1024 * 1024;
/** Fișierele încărcate, dar nepăstrate de plugin (`ctx.media.keep`), se șterg după acest timp. */
export const PLUGIN_MEDIA_PENDING_MS = 6 * 3600_000;
const UPLOAD_LIMIT = { window: 3600, max: 60 };
/** Încărcările din ACP (cataloage, încărcare în bloc): o limită separată, mai mare, doar pentru staff-ul cu acces ACP. */
const ACP_UPLOAD_LIMIT = { window: 3600, max: 300 };
const WEBP = { quality: 88, alphaQuality: 100, effort: 4 } as const;
/**
 * Animațiile: efortul 2 (în loc de 4) scurtează codarea cu ~40% pentru fișiere cu ~8% mai mari — un lot de zeci de rame
 * animate trebuie să încapă în timpul unei cereri (proxy-ul are de obicei 60 s).
 */
const WEBP_ANIMATED = { ...WEBP, effort: 2 } as const;

// ─── Durata video, citită din container (fără ffmpeg) ───

/** Durata unui MP4 din `moov/mvhd` (sau `moov/mvex/mehd` la fișierele fragmentate); `null` dacă lipsește. */
export function mp4DurationMs(bytes: Buffer): number | null {
  const boxes = (start: number, end: number): { type: string; start: number; end: number }[] => {
    const out: { type: string; start: number; end: number }[] = [];
    let at = start;
    while (at + 8 <= end && out.length < 512) {
      let size = bytes.readUInt32BE(at);
      const type = bytes.toString("latin1", at + 4, at + 8);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) break;
        const big = bytes.readBigUInt64BE(at + 8);
        if (big > BigInt(end - at)) break;
        size = Number(big);
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) break;
      out.push({ type, start: at + header, end: at + size });
      at += size;
    }
    return out;
  };
  const moov = boxes(0, bytes.length).find((b) => b.type === "moov");
  if (!moov) return null;
  const inner = boxes(moov.start, moov.end);
  const mvhd = inner.find((b) => b.type === "mvhd");
  if (!mvhd || mvhd.end - mvhd.start < 20) return null;
  const version = bytes[mvhd.start]!;
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (mvhd.end - mvhd.start < 32) return null;
    timescale = bytes.readUInt32BE(mvhd.start + 20);
    duration = Number(bytes.readBigUInt64BE(mvhd.start + 24));
  } else {
    timescale = bytes.readUInt32BE(mvhd.start + 12);
    duration = bytes.readUInt32BE(mvhd.start + 16);
  }
  if ((duration === 0 || duration === 0xffffffff) && timescale > 0) {
    const mvex = inner.find((b) => b.type === "mvex");
    const mehd = mvex ? boxes(mvex.start, mvex.end).find((b) => b.type === "mehd") : undefined;
    if (mehd && mehd.end - mehd.start >= 8) {
      duration = bytes[mehd.start] === 1 && mehd.end - mehd.start >= 12 ? Number(bytes.readBigUInt64BE(mehd.start + 4)) : bytes.readUInt32BE(mehd.start + 4);
    }
  }
  if (!timescale || !duration || !Number.isFinite(duration)) return null;
  return Math.round((duration / timescale) * 1000);
}

/** Un element EBML: id-ul (cu biții de lungime), începutul datelor și sfârșitul (`null` = mărime necunoscută). */
function ebmlElement(bytes: Buffer, at: number): { id: number; dataStart: number; dataEnd: number | null } | null {
  const vint = (pos: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null => {
    const first = bytes[pos];
    if (first === undefined || first === 0) return null;
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
    if (length > 8 || pos + length > bytes.length) return null;
    let value = keepMarker ? first : first & (0xff >> length);
    let allOnes = value === 0xff >> length;
    for (let i = 1; i < length; i++) {
      value = value * 256 + bytes[pos + i]!;
      if (bytes[pos + i] !== 0xff) allOnes = false;
    }
    return { value, length, unknown: !keepMarker && allOnes };
  };
  const id = vint(at, true);
  if (!id || id.length > 4) return null;
  const size = vint(at + id.length, false);
  if (!size) return null;
  const dataStart = at + id.length + size.length;
  return { id: id.value, dataStart, dataEnd: size.unknown ? null : dataStart + size.value };
}

/** Durata unui WebM din `Segment/Info` (`Duration` × `TimecodeScale`); `null` dacă lipsește. */
export function webmDurationMs(bytes: Buffer): number | null {
  const SEGMENT = 0x18538067;
  const INFO = 0x1549a966;
  const TIMECODE_SCALE = 0x2ad7b1;
  const DURATION = 0x4489;
  let at = 0;
  let steps = 0;
  // Antetul EBML, apoi Segment.
  while (at < bytes.length && steps++ < 64) {
    const el = ebmlElement(bytes, at);
    if (!el) return null;
    if (el.id === SEGMENT) {
      const segEnd = Math.min(el.dataEnd ?? bytes.length, bytes.length);
      let pos = el.dataStart;
      let inner = 0;
      while (pos < segEnd && inner++ < 256) {
        const child = ebmlElement(bytes, pos);
        if (!child || child.dataEnd === null) return null;
        if (child.id === INFO) {
          let scale = 1_000_000;
          let duration: number | null = null;
          let p = child.dataStart;
          const end = Math.min(child.dataEnd, bytes.length);
          let n = 0;
          while (p < end && n++ < 64) {
            const f = ebmlElement(bytes, p);
            if (!f || f.dataEnd === null || f.dataEnd > end) break;
            const len = f.dataEnd - f.dataStart;
            if (f.id === TIMECODE_SCALE && len >= 1 && len <= 6) scale = bytes.readUIntBE(f.dataStart, len);
            if (f.id === DURATION && (len === 4 || len === 8)) duration = len === 4 ? bytes.readFloatBE(f.dataStart) : bytes.readDoubleBE(f.dataStart);
            p = f.dataEnd;
          }
          if (duration === null || !Number.isFinite(duration) || duration <= 0) return null;
          return Math.round((duration * scale) / 1_000_000);
        }
        pos = child.dataEnd;
      }
      return null;
    }
    if (el.dataEnd === null) return null;
    at = el.dataEnd;
  }
  return null;
}

// ─── Verificarea și recodarea ───

/** Durata unui cadru GIF/WebP: sub 11 ms devine 100 ms, ca în browsere (altfel WebP-ul ar rula „cât de repede poate”). */
const frameDelay = (ms: number) => (ms <= 10 ? 100 : Math.min(ms, 60_000));

const animationError = (error: unknown): GcsValidationError => {
  if (error instanceof GcsApngError) return new GcsValidationError({ file: error.code }, error.code === "too_many_frames" ? { maxFrames: String(PLUGIN_ANIMATION_LIMITS.maxFrames) } : {});
  if (error instanceof GcsValidationError) return error;
  if (error instanceof Error && /timeout/i.test(error.message)) return new GcsValidationError({ file: "processing_timeout" });
  return new GcsValidationError({ file: "invalid_image" });
};

/**
 * WebP-ul final al unei animații: latura maximă (`maxSide` = `null` când cadrele au deja mărimea finală), duratele și
 * buclele păstrate; mereu recodat.
 */
async function encodeAnimation(img: Sharp, maxSide: number | null, delays: number[], loop: number): Promise<GcsPreparedPluginMedia> {
  const sized = maxSide === null ? img : img.resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
  const out = await sized
    .webp(delays.length > 1 ? { ...WEBP_ANIMATED, loop, delay: delays } : WEBP)
    .timeout({ seconds: Math.ceil(PLUGIN_ANIMATION_LIMITS.timeBudgetMs / 1000) })
    .toBuffer();
  const meta = await sharp(out, { animated: true }).metadata();
  return { kind: "image", mime: "image/webp", ext: "webp", bytes: out, width: meta.width ?? null, height: meta.pageHeight ?? meta.height ?? null, durationMs: null, frames: meta.pages ?? 1 };
}

/** O imagine statică → WebP (orientarea EXIF aplicată, fără metadate). */
async function stillImage(bytes: Buffer, maxSide: number): Promise<GcsPreparedPluginMedia> {
  let out: Buffer;
  try {
    out = await sharp(bytes, { limitInputPixels: 64_000_000 }).rotate().resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).webp(WEBP).toBuffer();
  } catch {
    throw new GcsValidationError({ file: "invalid_image" });
  }
  const meta = await sharp(out).metadata();
  return { kind: "image", mime: "image/webp", ext: "webp", bytes: out, width: meta.width ?? null, height: meta.height ?? null, durationMs: null, frames: 1 };
}

/** APNG → WebP animat: cadrele compuse în nucleu (`apng.ts`), apoi recodate de `sharp`. */
async function animatedPng(bytes: Buffer, maxSide: number): Promise<GcsPreparedPluginMedia> {
  try {
    const anim = await composeApng(bytes, PLUGIN_ANIMATION_LIMITS);
    let { width, height, rgba } = anim;
    // `resize` pe o intrare `raw` cu mai multe pagini ar păstra doar prima pagină: cadrele prea mari se micșorează pe rând.
    const scale = Math.min(1, maxSide / Math.max(width, height));
    if (scale < 1) {
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const size = width * height * 4;
      const frames: Buffer[] = [];
      for (let i = 0; i < anim.frames; i++) {
        frames.push(await sharp(rgba.subarray(i * size, (i + 1) * size), { raw: { width, height, channels: 4 } }).resize(w, h, { fit: "fill" }).raw().toBuffer());
      }
      rgba = Buffer.concat(frames);
      width = w;
      height = h;
    }
    const img = sharp(rgba, { raw: { width, height: height * anim.frames, channels: 4, pageHeight: height }, limitInputPixels: false });
    return await encodeAnimation(img, null, anim.delays, anim.loop);
  } catch (error) {
    throw animationError(error);
  }
}

/** GIF sau WebP animat → WebP animat (un singur cadru = imagine statică), cu aceleași limite ca APNG. */
async function animatedImage(bytes: Buffer, maxSide: number): Promise<GcsPreparedPluginMedia> {
  const L = PLUGIN_ANIMATION_LIMITS;
  try {
    const meta = await sharp(bytes, { animated: true, limitInputPixels: false }).metadata();
    const pages = meta.pages ?? 1;
    const width = meta.width ?? 0;
    const pageHeight = meta.pageHeight ?? meta.height ?? 0;
    if (!width || !pageHeight) throw new GcsValidationError({ file: "invalid_image" });
    if (pages <= 1) return await stillImage(bytes, maxSide);
    if (pages > L.maxFrames) throw new GcsApngError("too_many_frames");
    if (width > L.maxSide || pageHeight > L.maxSide || width * pageHeight * pages > L.maxPixels) throw new GcsApngError("animation_too_large");
    const delays = Array.from({ length: pages }, (_, i) => frameDelay(meta.delay?.[i] ?? 100));
    return await encodeAnimation(sharp(bytes, { animated: true, limitInputPixels: false }), maxSide, delays, meta.loop ?? 0);
  } catch (error) {
    throw animationError(error);
  }
}

/**
 * Verifică (și, pentru imagini, recodează) un fișier încărcat pentru un plugin, după declarația lui `media`:
 * tipul real din conținut, mărimea per tip, dimensiunile, durata video. Fișierul original nu se păstrează niciodată
 * pentru imagini: ce se salvează e WebP-ul generat de `sharp` (fără metadate).
 */
export async function preparePluginMedia(bytes: Buffer, decl: GcsPluginMediaDecl): Promise<GcsPreparedPluginMedia> {
  const detected = await fileTypeFromBuffer(bytes);
  const mime = detected?.mime ?? "";
  if (IMAGE_MIMES.has(mime)) {
    const rule = decl.image;
    if (!rule) throw new GcsValidationError({ file: "unsupported_type" });
    if (bytes.length > rule.maxMb * MB) throw new GcsValidationError({ file: "too_large" }, { maxMb: String(rule.maxMb) });
    if (rule.animated && mime === "image/apng") return animatedPng(bytes, rule.maxSide);
    if (rule.animated && (mime === "image/gif" || mime === "image/webp")) return animatedImage(bytes, rule.maxSide);
    // Fără animații declarate, un APNG / GIF devine imaginea lui statică (primul cadru).
    return stillImage(bytes, rule.maxSide);
  }
  if (mime in VIDEO) {
    const rule = decl.video;
    if (!rule) throw new GcsValidationError({ file: "unsupported_type" });
    if (bytes.length > rule.maxMb * MB) throw new GcsValidationError({ file: "too_large" }, { maxMb: String(rule.maxMb) });
    const durationMs = mime === "video/mp4" ? mp4DurationMs(bytes) : webmDurationMs(bytes);
    if (durationMs === null) throw new GcsValidationError({ file: "duration_unknown" });
    if (durationMs > rule.maxSeconds * 1000) throw new GcsValidationError({ file: "too_long" }, { maxSeconds: String(rule.maxSeconds) });
    return { kind: "video", mime, ext: VIDEO[mime as keyof typeof VIDEO], bytes, width: null, height: null, durationMs };
  }
  if (mime in AUDIO) {
    const rule = decl.audio;
    if (!rule) throw new GcsValidationError({ file: "unsupported_type" });
    if (bytes.length > rule.maxMb * MB) throw new GcsValidationError({ file: "too_large" }, { maxMb: String(rule.maxMb) });
    return { kind: "audio", mime, ext: AUDIO[mime as keyof typeof AUDIO], bytes, width: null, height: null, durationMs: null };
  }
  throw new GcsValidationError({ file: "unsupported_type" });
}

/** Numele original al unui fișier încărcat, doar ca text: fără cale, fără caractere de control, cel mult 120 de caractere. */
export function pluginUploadName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const base = raw.split(/[\\/]/).pop() ?? "";
  const name = base
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name ? [...name].slice(0, 120).join("") : null;
}

/** Cea mai mare încărcare acceptată de declarație (pentru `Content-Length` înainte de citirea formularului). */
export function pluginMediaMaxBytes(decl: GcsPluginMediaDecl): number {
  return Math.max(decl.image?.maxMb ?? 0, decl.video?.maxMb ?? 0, decl.audio?.maxMb ?? 0) * MB;
}

/**
 * Antetul `Range: bytes=a-b` (un singur interval, ca la player-ele audio/video). `null` = fără antet sau o formă
 * neacceptată (se trimite tot fișierul), `"unsatisfiable"` = interval în afara fișierului (416).
 */
export function parseByteRange(header: string | null | undefined, size: number): GcsByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (size <= 0) return "unsatisfiable";
  let start: number;
  let end: number;
  if (m[1] === "") {
    // Ultimii N octeți.
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return "unsatisfiable";
  return { start, end };
}

/** Adresa publică a unui fișier media al pluginului. */
export const pluginMediaUrl = (pluginKey: string, id: string, ext: string) => `/plugins/${pluginKey}/media/${id}.${ext}`;

type MediaRow = {
  id: string;
  pluginKey: string;
  kind: string;
  mime: string;
  ext: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  storageKey: string;
  status: string;
  createdAt: Date;
};

const toInfo = (r: MediaRow): GcsPluginMediaInfo => ({
  id: r.id,
  kind: r.kind as GcsPluginMediaKind,
  mime: r.mime,
  size: r.size,
  width: r.width,
  height: r.height,
  durationMs: r.durationMs,
  url: pluginMediaUrl(r.pluginKey, r.id, r.ext),
  status: r.status === "kept" ? "kept" : "pending",
  createdAt: r.createdAt.toISOString(),
});

const ids = (raw: unknown): string[] => (Array.isArray(raw) ? [...new Set(raw.filter((v): v is string => typeof v === "string" && /^[a-z0-9]{10,40}$/.test(v)))].slice(0, 200) : []);

/**
 * Fișierele media ale pluginurilor (capabilitatea `media`, specul Studio VIP §2.2): încărcarea (verificare, recodare,
 * cotă, limită de rată), păstrarea sau ștergerea de către plugin, servirea publică și curățarea la dezinstalare.
 */
export class GcsPluginMediaService {
  constructor(private readonly deps: { db: PrismaClient; store: GcsFileStore; rateLimiter: GcsRedisRateLimiter }) {}

  /**
   * Un fișier nou, în așteptare până când pluginul îl păstrează. `uploader.acp`: încărcarea vine dintr-o rută ACP a
   * pluginului (poarta ACP verificată), cu limita de rată separată, mai mare (cataloagele, încărcarea în bloc).
   */
  async upload(pluginKey: string, decl: GcsPluginMediaDecl, file: { bytes: Buffer; name?: string }, uploader: { userId: string | null; acp?: boolean }): Promise<GcsPluginMediaInfo> {
    const { db, store, rateLimiter } = this.deps;
    if (uploader.userId) {
      const limit = uploader.acp
        ? await rateLimiter.consume(`plugin-media-acp:${uploader.userId}`, ACP_UPLOAD_LIMIT)
        : await rateLimiter.consume(`plugin-media:${uploader.userId}`, UPLOAD_LIMIT);
      if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    }
    await this.purgePending(pluginKey);
    const prepared = await preparePluginMedia(file.bytes, decl);
    const used = await db.pluginMedia.aggregate({ where: { pluginKey }, _sum: { size: true } });
    if ((used._sum.size ?? 0) + prepared.bytes.length > decl.quotaMb * MB) throw new GcsValidationError({ file: "quota_exceeded" }, { quotaMb: String(decl.quotaMb) });
    const now = new Date();
    const storageKey = `plugins/${pluginKey}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${prepared.ext}`;
    await store.put(storageKey, prepared.bytes, prepared.mime);
    const row = await db.pluginMedia.create({
      data: {
        pluginKey,
        kind: prepared.kind,
        mime: prepared.mime,
        ext: prepared.ext,
        size: prepared.bytes.length,
        width: prepared.width,
        height: prepared.height,
        durationMs: prepared.durationMs,
        storageKey,
        uploadedBy: uploader.userId,
      },
    });
    const name = pluginUploadName(file.name);
    return {
      ...toInfo(row),
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      ...(name ? { originalName: name } : {}),
      ...(prepared.frames ? { frames: prepared.frames } : {}),
    };
  }

  /** Păstrează fișierele încărcate (altfel se șterg după 6 ore). Doar ale pluginului. */
  async keep(pluginKey: string, raw: unknown): Promise<number> {
    const list = ids(raw);
    if (list.length === 0) return 0;
    const { count } = await this.deps.db.pluginMedia.updateMany({ where: { pluginKey, id: { in: list } }, data: { status: "kept" } });
    return count;
  }

  async get(pluginKey: string, raw: unknown): Promise<GcsPluginMediaInfo[]> {
    const list = ids(raw);
    if (list.length === 0) return [];
    return (await this.deps.db.pluginMedia.findMany({ where: { pluginKey, id: { in: list } } })).map(toInfo);
  }

  async list(pluginKey: string, opts: unknown): Promise<GcsPluginMediaInfo[]> {
    const o = (opts && typeof opts === "object" ? opts : {}) as { kind?: unknown; limit?: unknown; offset?: unknown };
    const kind = o.kind === "image" || o.kind === "video" || o.kind === "audio" ? o.kind : undefined;
    const limit = Number.isInteger(o.limit) ? Math.min(Math.max(o.limit as number, 1), 200) : 50;
    const offset = Number.isInteger(o.offset) ? Math.max(o.offset as number, 0) : 0;
    const rows = await this.deps.db.pluginMedia.findMany({ where: { pluginKey, ...(kind ? { kind } : {}) }, orderBy: { createdAt: "desc" }, take: limit, skip: offset });
    return rows.map(toInfo);
  }

  /** Șterge fișierele (store + rânduri). Doar ale pluginului. */
  async delete(pluginKey: string, raw: unknown): Promise<number> {
    const list = ids(raw);
    if (list.length === 0) return 0;
    return this.remove(await this.deps.db.pluginMedia.findMany({ where: { pluginKey, id: { in: list } }, select: { id: true, storageKey: true } }));
  }

  async usage(pluginKey: string): Promise<{ files: number; bytes: number }> {
    const agg = await this.deps.db.pluginMedia.aggregate({ where: { pluginKey }, _sum: { size: true }, _count: true });
    return { files: agg._count, bytes: agg._sum.size ?? 0 };
  }

  /** Toate fișierele pluginului (dezinstalarea fără păstrarea datelor). */
  async deleteAll(pluginKey: string): Promise<number> {
    return this.remove(await this.deps.db.pluginMedia.findMany({ where: { pluginKey }, select: { id: true, storageKey: true } }));
  }

  /** Fișierele nepăstrate, mai vechi de 6 ore. */
  async purgePending(pluginKey: string, now = Date.now()): Promise<number> {
    const rows = await this.deps.db.pluginMedia.findMany({
      where: { pluginKey, status: "pending", createdAt: { lt: new Date(now - PLUGIN_MEDIA_PENDING_MS) } },
      select: { id: true, storageKey: true },
      take: 200,
    });
    return this.remove(rows);
  }

  private async remove(rows: { id: string; storageKey: string }[]): Promise<number> {
    if (rows.length === 0) return 0;
    for (const r of rows) await this.deps.store.delete(r.storageKey).catch(() => {});
    const { count } = await this.deps.db.pluginMedia.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return count;
  }

  /** Un fișier pentru servire (`/plugins/<cheie>/media/<id>.<ext>`): doar al pluginului, cu extensia lui. */
  async open(pluginKey: string, file: string, range?: (size: number) => GcsByteRange | null): Promise<{ body: ReadableStream<Uint8Array>; size: number; mime: string; range: GcsByteRange | null } | null> {
    const m = /^([a-z0-9]{10,40})\.([a-z0-9]{2,5})$/.exec(file);
    if (!m) return null;
    const row = await this.deps.db.pluginMedia.findFirst({ where: { id: m[1]!, pluginKey, ext: m[2]! } });
    if (!row) return null;
    // Mărimea e cunoscută din rând: intervalul cerut se validează înainte de citire.
    const wanted = range ? range(row.size) : null;
    const stored = await this.deps.store.get(row.storageKey, wanted ?? undefined);
    return stored ? { body: stored.body, size: row.size, mime: row.mime, range: wanted } : null;
  }
}
