import { crc32, inflateRawSync } from "node:zlib";

export type GcsPluginZipLimits = {
  maxArchiveBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxRatio: number;
  maxPathLength: number;
};

/** Limitele arhivei unui plugin (§1.1 din designul pluginurilor). */
export const PLUGIN_ZIP_LIMITS: Readonly<GcsPluginZipLimits> = {
  /** Arhiva întreagă. */
  maxArchiveBytes: 8 * 1024 * 1024,
  maxFiles: 400,
  /** Un fișier, despachetat. */
  maxFileBytes: 4 * 1024 * 1024,
  /** Toate fișierele, despachetate. */
  maxTotalBytes: 32 * 1024 * 1024,
  /** Raportul despachetat / împachetat, peste care un fișier (> 4 KB) e considerat bombă ZIP. */
  maxRatio: 200,
  maxPathLength: 200,
};

/** O eroare de arhivă: `code` e cheia de traducere a raportului (`acp.plugins.checks.<code>`). */
export class GcsPluginPackageError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string> = {},
  ) {
    super(`${code}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ""}`);
    this.name = "GcsPluginPackageError";
  }
}

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * O cale din arhivă e acceptată doar dacă e relativă, cu `/`, fără `.`/`..`, fără `\`, `:` sau caractere de control și
 * cu segmente din `[A-Za-z0-9._-]` (deci fără zip-slip, căi absolute sau litere de unitate).
 */
export function isSafeArchivePath(name: string): boolean {
  if (name.length === 0 || name.length > PLUGIN_ZIP_LIMITS.maxPathLength) return false;
  if (name.startsWith("/") || name.includes("\\") || name.includes(":")) return false;
  const segments = name.split("/");
  return segments.every((s) => s !== "." && s !== ".." && SEGMENT_RE.test(s));
}

type CentralEntry = { name: string; method: number; flags: number; crc: number; compressed: number; size: number; offset: number; kind: "file" | "dir" };

function findEndOfCentralDirectory(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new GcsPluginPackageError("zip_invalid");
}

function entryKind(madeBy: number, external: number): "file" | "dir" | "link" | "special" {
  const host = madeBy >> 8;
  if (host === 3) {
    const type = (external >>> 16) & S_IFMT;
    if (type === S_IFLNK) return "link";
    if (type === S_IFDIR) return "dir";
    if (type === S_IFREG || type === 0) return "file";
    return "special";
  }
  return external & 0x10 ? "dir" : "file";
}

/**
 * Citește o arhivă ZIP (directorul central) și întoarce fișierele (cale → conținut), cu toate verificările de siguranță:
 * mărimi, număr de fișiere, ZIP64 și criptare refuzate, link-uri simbolice și intrări speciale refuzate, căi sigure,
 * duplicate (și cu majuscule diferite, inclusiv o cale care e și fișier, și folder), raport de compresie, mărimea reală la dezarhivare limitată și CRC32 verificat.
 * Directoarele nu apar în rezultat.
 */
export function readPluginZip(buf: Buffer, limits: Readonly<GcsPluginZipLimits> = PLUGIN_ZIP_LIMITS): Map<string, Buffer> {
  if (buf.length > limits.maxArchiveBytes) throw new GcsPluginPackageError("archive_too_large", { max: String(limits.maxArchiveBytes) });
  if (buf.length < 22) throw new GcsPluginPackageError("zip_invalid");
  const eocd = findEndOfCentralDirectory(buf);
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const onDisk = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new GcsPluginPackageError("zip64_unsupported");
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw new GcsPluginPackageError("zip_multidisk");
  if (total > limits.maxFiles) throw new GcsPluginPackageError("too_many_files", { max: String(limits.maxFiles) });
  if (cdOffset + cdSize > eocd) throw new GcsPluginPackageError("zip_invalid");

  const entries: CentralEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) throw new GcsPluginPackageError("zip_invalid");
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const startDisk = buf.readUInt16LE(p + 34);
    const external = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > eocd) throw new GcsPluginPackageError("zip_invalid");
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    // Numele: UTF-8 valid (bitul 11) sau ASCII; altfel nu putem garanta cum îl interpretează alte unelte.
    const name = rawName.toString("utf8");
    if (!Buffer.from(name, "utf8").equals(rawName)) throw new GcsPluginPackageError("path_unsafe", { path: name.slice(0, 80) });
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff || startDisk !== 0) throw new GcsPluginPackageError("zip64_unsupported");
    if (flags & 0x0001 || flags & 0x0040) throw new GcsPluginPackageError("zip_encrypted", { path: name.slice(0, 80) });

    const kind = entryKind(madeBy, external);
    if (kind === "link") throw new GcsPluginPackageError("symlink", { path: name.slice(0, 80) });
    if (kind === "special") throw new GcsPluginPackageError("special_file", { path: name.slice(0, 80) });
    const isDir = kind === "dir" || name.endsWith("/");
    const clean = isDir ? name.replace(/\/$/, "") : name;
    if (!isSafeArchivePath(clean)) throw new GcsPluginPackageError("path_unsafe", { path: name.slice(0, 80) });
    if (isDir) {
      if (size !== 0) throw new GcsPluginPackageError("zip_invalid");
      continue;
    }
    if (method !== 0 && method !== 8) throw new GcsPluginPackageError("zip_method", { path: clean });
    entries.push({ name: clean, method, flags, crc, compressed, size, offset, kind: "file" });
  }

  // Folderele implicite ale fișierelor: o cale nu poate fi și fișier, și folder (`a.css` și `a.css/b.css` nu se pot
  // dezarhiva). Fără majuscule, ca pe Windows/macOS.
  const dirs = new Set<string>();
  for (const e of entries) {
    const parts = e.name.toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }

  const seen = new Set<string>();
  let totalSize = 0;
  const files = new Map<string, Buffer>();
  for (const e of entries) {
    const lower = e.name.toLowerCase();
    if (seen.has(lower) || dirs.has(lower)) throw new GcsPluginPackageError("duplicate_path", { path: e.name });
    seen.add(lower);
    if (e.size > limits.maxFileBytes) throw new GcsPluginPackageError("file_too_large", { path: e.name, max: String(limits.maxFileBytes) });
    totalSize += e.size;
    if (totalSize > limits.maxTotalBytes) throw new GcsPluginPackageError("total_too_large", { max: String(limits.maxTotalBytes) });
    if (e.size > 4096 && e.size / Math.max(1, e.compressed) > limits.maxRatio) throw new GcsPluginPackageError("compression_ratio", { path: e.name });

    // Antetul local: aceeași cale și aceeași metodă ca în directorul central (fără „două nume” pentru același fișier).
    const lh = e.offset;
    if (lh + 30 > cdOffset || buf.readUInt32LE(lh) !== 0x04034b50) throw new GcsPluginPackageError("zip_invalid");
    const localMethod = buf.readUInt16LE(lh + 8);
    const localNameLen = buf.readUInt16LE(lh + 26);
    const localExtraLen = buf.readUInt16LE(lh + 28);
    const localName = buf.subarray(lh + 30, lh + 30 + localNameLen).toString("utf8");
    if (localMethod !== e.method || localName !== e.name) throw new GcsPluginPackageError("zip_invalid");
    const start = lh + 30 + localNameLen + localExtraLen;
    const end = start + e.compressed;
    if (end > cdOffset) throw new GcsPluginPackageError("zip_invalid");
    const raw = buf.subarray(start, end);

    let data: Buffer;
    if (e.method === 0) {
      if (e.compressed !== e.size) throw new GcsPluginPackageError("zip_invalid");
      data = Buffer.from(raw);
    } else {
      try {
        // Mărimea reală e limitată la cea declarată (+1, ca să prindem o declarație mincinoasă).
        data = inflateRawSync(raw, { maxOutputLength: e.size + 1 });
      } catch {
        throw new GcsPluginPackageError("zip_corrupt", { path: e.name });
      }
      if (data.length !== e.size) throw new GcsPluginPackageError("zip_corrupt", { path: e.name });
    }
    if (crc32(data) >>> 0 !== e.crc >>> 0) throw new GcsPluginPackageError("zip_crc", { path: e.name });
    files.set(e.name, data);
  }
  return files;
}
