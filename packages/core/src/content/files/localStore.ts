import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { GcsByteRange, GcsFileStore, GcsStoredFile } from "./store";

/** Store într-un folder local (teste, dev fără MinIO). */
export class GcsLocalFileStore implements GcsFileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Calea fișierului; o cheie care ar ieși din folder (`..`) e refuzată. */
  private file(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Cheie de fișier invalidă: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.file(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string, range?: GcsByteRange): Promise<GcsStoredFile | null> {
    const full = this.file(key);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) return null;
    const stream = range ? createReadStream(full, { start: range.start, end: range.end }) : createReadStream(full);
    return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, size: info.size };
  }

  async delete(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }
}
