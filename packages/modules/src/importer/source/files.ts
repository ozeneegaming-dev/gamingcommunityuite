import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { checkFetchUrl, GcsBlockedFetch, safeFetchBuffer, type GcsSafeFetchDeps } from "@gcs/core";

/** Fișierele site-ului vechi (atașamente, avatare): din folderul montat, de la o adresă web sau din memorie (teste). */
export interface GcsImportFiles {
  /** Conținutul fișierului de la calea relativă dată (ex. `uploads/monthly_2020_01/a.png`); `null` dacă lipsește. */
  read(relPath: string): Promise<Buffer | null>;
}

/** O cale relativă sigură (`a/b/c.png`): fără căi absolute, fără `..`, fără caractere de control; altfel `null`. */
export function safeRelativePath(rel: string): string | null {
  if (!rel || rel.length > 500 || /[\u0000-\u001f]/.test(rel)) return null;
  const parts = rel.replace(/\\/g, "/").split("/");
  if (parts[0] === "" || /^[A-Za-z]:$/.test(parts[0]!)) return null;
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return parts.join("/");
}

/**
 * Folderul montat doar pentru citire. Calea rezolvată (cu tot cu symlink-uri, prin `realpath`) trebuie să rămână
 * în interiorul folderului; fișierele peste `maxBytes` sunt refuzate.
 */
export function folderFiles(root: string, maxBytes: number): GcsImportFiles {
  let rootReal: Promise<string> | null = null;
  return {
    async read(rel) {
      const safe = safeRelativePath(rel);
      if (!safe) return null;
      rootReal ??= realpath(root);
      const base = await rootReal;
      const inside = (p: string) => p.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
      const full = path.resolve(base, ...safe.split("/"));
      if (!inside(full)) return null;
      let real: string;
      try {
        real = await realpath(full);
      } catch {
        return null;
      }
      if (!inside(real)) return null;
      const info = await stat(real);
      if (!info.isFile()) return null;
      if (info.size > maxBytes) throw new GcsBlockedFetch("too_large");
      return readFile(real);
    },
  };
}

/** Fișierele de la adresa web a site-ului vechi, prin descărcarea anti-SSRF (`safeFetchBuffer`). */
export function urlFiles(baseUrl: string, maxBytes: number, deps: GcsSafeFetchDeps = {}): GcsImportFiles {
  const base = checkFetchUrl(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  return {
    async read(rel) {
      const safe = safeRelativePath(rel);
      if (!safe) return null;
      const url = new URL(safe.split("/").map(encodeURIComponent).join("/"), base);
      try {
        return (await safeFetchBuffer(url.toString(), { maxBytes, timeoutMs: 30_000 }, deps)).bytes;
      } catch (error) {
        if (error instanceof GcsBlockedFetch && error.reason === "http_404") return null;
        throw error;
      }
    },
  };
}

/** Fișierele unei surse de test. */
export function memoryFiles(files: Record<string, Buffer>): GcsImportFiles {
  return {
    async read(rel) {
      const safe = safeRelativePath(rel);
      return safe ? (files[safe] ?? null) : null;
    },
  };
}

/** Prima cale care există dintr-o listă (ex. mărimile unui avatar). */
export async function readFirst(files: GcsImportFiles, paths: string[]): Promise<{ path: string; bytes: Buffer } | null> {
  for (const p of paths) {
    const bytes = await files.read(p);
    if (bytes) return { path: p, bytes };
  }
  return null;
}
