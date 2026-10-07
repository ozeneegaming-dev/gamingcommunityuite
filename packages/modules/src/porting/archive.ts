import { GcsPluginPackageError, isSafeArchivePath, readPluginZip, type GcsPluginZipLimits } from "@gcs/core";
import { gunzipSync } from "node:zlib";

/**
 * Limitele arhivei sursă a unei portări. Arhiva are aceeași mărime maximă ca un pachet de plugin (trece prin același
 * upload), dar o aplicație are mai multe fișiere: până la 2000, 48 MB despachetat.
 */
export const PORT_SOURCE_LIMITS: Readonly<GcsPluginZipLimits> = {
  maxArchiveBytes: 8 * 1024 * 1024,
  maxFiles: 2000,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 48 * 1024 * 1024,
  maxRatio: 200,
  maxPathLength: 200,
};

export type GcsPortArchive = { kind: "zip" | "tar" | "xml"; files: Map<string, Buffer> };

const BLOCK = 512;

function cString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

/** Un număr octal din antet (mărimea, suma de control). Forma binară (base-256, pentru > 8 GB) e refuzată. */
function octal(buf: Buffer, start: number, length: number): number {
  if (buf[start]! & 0x80) throw new GcsPluginPackageError("file_too_large", { path: "", max: "" });
  const text = cString(buf, start, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new GcsPluginPackageError("zip_invalid");
  return parseInt(text, 8);
}

/** Suma de control a antetului: toți octeții, cu câmpul sumei citit ca spații. */
function headerChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  return sum;
}

/** Înregistrările unui antet pax (`<lungime> <cheie>=<valoare>\n`). */
function paxRecords(data: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  const text = data.toString("utf8");
  let p = 0;
  while (p < text.length) {
    const space = text.indexOf(" ", p);
    if (space === -1) break;
    const len = Number(text.slice(p, space));
    if (!Number.isInteger(len) || len <= 0 || p + len > text.length) throw new GcsPluginPackageError("zip_invalid");
    const record = text.slice(space + 1, p + len - 1);
    const eq = record.indexOf("=");
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    p += len;
  }
  return out;
}

/**
 * Citește o arhivă TAR (ustar / pax / GNU, opțional gzip), cu aceleași reguli ca cititorul ZIP al pluginurilor:
 * mărimi și număr de fișiere limitate, căi sigure (fără `..`, căi absolute, `\`, `:`), fără link-uri (simbolice sau
 * hard) și fără intrări speciale, fără duplicate (și cu majuscule diferite) sau coliziuni fișier/folder, suma de control
 * a fiecărui antet verificată. Directoarele nu apar în rezultat. Nimic nu se scrie pe disc.
 */
export function readTar(input: Buffer, limits: Readonly<GcsPluginZipLimits> = PORT_SOURCE_LIMITS): Map<string, Buffer> {
  if (input.length > limits.maxArchiveBytes) throw new GcsPluginPackageError("archive_too_large", { max: String(limits.maxArchiveBytes) });
  let buf = input;
  if (input[0] === 0x1f && input[1] === 0x8b) {
    // Mărimea despachetată e limitată la ce poate conține o arhivă validă (fișierele + antetele lor), nu cea declarată.
    const max = limits.maxTotalBytes + limits.maxFiles * 2 * BLOCK + 20 * BLOCK;
    try {
      buf = gunzipSync(input, { maxOutputLength: max });
    } catch (e) {
      if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new GcsPluginPackageError("total_too_large", { max: String(limits.maxTotalBytes) });
      throw new GcsPluginPackageError("zip_corrupt", { path: "" });
    }
  }

  const files = new Map<string, Buffer>();
  const seen = new Set<string>();
  const dirs = new Set<string>();
  let total = 0;
  let pending: { path?: string } = {};
  let p = 0;
  while (p + BLOCK <= buf.length) {
    const header = buf.subarray(p, p + BLOCK);
    if (header.every((b) => b === 0)) break;
    if (octal(header, 148, 8) !== headerChecksum(header)) throw new GcsPluginPackageError("zip_crc", { path: cString(header, 0, 100).slice(0, 80) });
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156]!);
    const dataStart = p + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) throw new GcsPluginPackageError("zip_invalid");
    p = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x" || type === "L") {
      // Numele lung al intrării următoare (pax `path` sau GNU `././@LongLink`).
      if (size > 64 * 1024) throw new GcsPluginPackageError("zip_invalid");
      const data = buf.subarray(dataStart, dataEnd);
      if (type === "L") pending = { path: cString(data, 0, data.length) };
      else {
        const records = paxRecords(data);
        if (records.has("size") || records.has("linkpath")) throw new GcsPluginPackageError("special_file", { path: (records.get("path") ?? "").slice(0, 80) });
        pending = records.has("path") ? { path: records.get("path")! } : {};
      }
      continue;
    }
    if (type === "g") continue;

    const prefix = cString(header, 345, 155);
    const magic = cString(header, 257, 6);
    const shortName = cString(header, 0, 100);
    let name = pending.path ?? (magic.startsWith("ustar") && prefix ? `${prefix}/${shortName}` : shortName);
    pending = {};
    name = name.replace(/^(?:\.\/)+/, "");

    if (type === "1" || type === "2" || type === "K") throw new GcsPluginPackageError("symlink", { path: name.slice(0, 80) });
    if (type === "5") {
      const clean = name.replace(/\/$/, "");
      if (clean === "" || clean === ".") continue;
      if (!isSafeArchivePath(clean)) throw new GcsPluginPackageError("path_unsafe", { path: name.slice(0, 80) });
      continue;
    }
    if (type !== "0" && type !== "\0" && type !== "7") throw new GcsPluginPackageError("special_file", { path: name.slice(0, 80) });
    if (!isSafeArchivePath(name)) throw new GcsPluginPackageError("path_unsafe", { path: name.slice(0, 80) });

    const lower = name.toLowerCase();
    if (seen.has(lower) || dirs.has(lower)) throw new GcsPluginPackageError("duplicate_path", { path: name });
    const parts = lower.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (seen.has(dir)) throw new GcsPluginPackageError("duplicate_path", { path: name });
      dirs.add(dir);
    }
    seen.add(lower);
    if (files.size >= limits.maxFiles) throw new GcsPluginPackageError("too_many_files", { max: String(limits.maxFiles) });
    if (size > limits.maxFileBytes) throw new GcsPluginPackageError("file_too_large", { path: name, max: String(limits.maxFileBytes) });
    total += size;
    if (total > limits.maxTotalBytes) throw new GcsPluginPackageError("total_too_large", { max: String(limits.maxTotalBytes) });
    files.set(name, Buffer.from(buf.subarray(dataStart, dataEnd)));
  }
  return files;
}

const looksLikeXml = (data: Buffer) => /^(?:\uFEFF)?\s*<(?:\?xml|plugin\b)/.test(data.subarray(0, 512).toString("utf8"));

/** Fișierele de sistem adăugate de unelte (nu fac parte din sursă). */
const JUNK = /(?:^|\/)(?:__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

/**
 * Deschide arhiva încărcată: `.zip` (cititorul întărit al pluginurilor, cu limitele portării), `.tar` / `.tar.gz`
 * sau un singur `.xml`. Tipul se recunoaște după conținut, nu după extensie. Fișierele de sistem (`__MACOSX/`,
 * `.DS_Store`) se ignoră.
 */
export function readPortArchive(fileName: string, data: Buffer): GcsPortArchive {
  if (data.length === 0) throw new GcsPluginPackageError("zip_invalid");
  if (data.length > PORT_SOURCE_LIMITS.maxArchiveBytes) throw new GcsPluginPackageError("archive_too_large", { max: String(PORT_SOURCE_LIMITS.maxArchiveBytes) });
  const clean = (files: Map<string, Buffer>) => new Map([...files].filter(([path]) => !JUNK.test(path)));
  if (data.readUInt32LE(0) === 0x04034b50 || data.readUInt32LE(0) === 0x06054b50) return { kind: "zip", files: clean(readPluginZip(data, PORT_SOURCE_LIMITS)) };
  if ((data[0] === 0x1f && data[1] === 0x8b) || (data.length >= BLOCK && data.subarray(257, 262).toString("latin1") === "ustar")) {
    return { kind: "tar", files: clean(readTar(data)) };
  }
  if (looksLikeXml(data)) {
    const base = fileName.replace(/^.*[\\/]/, "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "") || "plugin.xml";
    return { kind: "xml", files: new Map([[/\.xml$/i.test(base) ? base : `${base}.xml`, data]]) };
  }
  throw new GcsPluginPackageError("unknown_archive");
}
