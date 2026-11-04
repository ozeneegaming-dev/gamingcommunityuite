import os from "node:os";
import path from "node:path";
import { GcsAppService, GcsNotificationService, type GcsActor, type GcsJobDef, type GcsJobQueue } from "@gcs/core";
import type { GcsScanVerdict, GcsScannerInfo, GcsVirusScanner } from "../src/downloads/scanner";
import { createDownloads } from "../src/downloads/wire";
import { createForumWorld } from "./world";

/** Un document de editor cu un paragraf. */
export const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Antivirusul fals: disponibil / indisponibil și verdictul după conținut (un fișier care conține `VIRUS` e infectat). */
export function fakeScanner() {
  const state = { available: true, scans: 0, errorNext: false };
  const scanner: GcsVirusScanner = {
    info: async (): Promise<GcsScannerInfo> => (state.available ? { available: true, engine: "ClamAV 1.4.1", signatures: 27450, signaturesAt: null, error: null } : { available: false, engine: null, signatures: null, signaturesAt: null, error: "unreachable" }),
    scan: async (body): Promise<GcsScanVerdict> => {
      state.scans++;
      if (!state.available) return { status: "error", error: "unreachable" };
      if (state.errorNext) {
        state.errorNext = false;
        return { status: "error", error: "too_large" };
      }
      const parts: Buffer[] = [];
      for await (const p of body) parts.push(Buffer.from(p));
      return Buffer.concat(parts).includes("VIRUS") ? { status: "infected", signature: "Test.Virus-1" } : { status: "clean" };
    },
  };
  return { state, scanner };
}

/** Coada de joburi în memorie: joburile așteaptă până la `run()` (testul alege momentul). */
export function memoryJobs() {
  const defs = new Map<string, GcsJobDef>();
  const queue: { name: string; data: Record<string, unknown> }[] = [];
  const jobs: GcsJobQueue = {
    driver: "sql",
    register: (def) => void defs.set(def.name, def),
    registered: () => [...defs.values()],
    setRecorder: () => {},
    enqueue: async (name, data = {}) => void queue.push({ name, data }),
    upsertScheduler: async () => {},
    removeScheduler: async () => {},
    schedulerIds: async () => [],
    start: async () => async () => {},
    close: async () => {},
  };
  async function run(): Promise<number> {
    let n = 0;
    while (queue.length > 0) {
      const job = queue.shift()!;
      await defs.get(job.name)?.handler(job.data);
      n++;
    }
    return n;
  }
  return { jobs, queue, run };
}

/**
 * Un site de test cu aplicația Descărcări: lumea forumului, aplicațiile, notificările, antivirusul fals, coada de
 * joburi în memorie și ajutoarele pentru categorii și încărcări.
 */
export async function createDownloadWorld(opts: { edition?: "vps" | "lite" } = {}) {
  const w = await createForumWorld();
  const apps = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, permissions: w.permissions, settings: w.settings });
  const notifications = new GcsNotificationService({ db: w.db, bus: w.bus, cache: w.cache, registry: w.registry });
  const av = fakeScanner();
  const q = memoryJobs();
  const dl = createDownloads({
    db: w.db,
    cache: w.cache,
    bus: w.bus,
    settings: w.settings,
    permissions: w.permissions,
    acp: w.acp,
    apps,
    registry: w.registry,
    attachments: w.attachments,
    files: w.files,
    jobs: q.jobs,
    actors: w.actors,
    rateLimiter: w.rateLimiter,
    follows: w.follows,
    notifications,
    topics: w.topics,
    posts: w.posts,
    edition: opts.edition ?? "vps",
    configDir: path.join(os.tmpdir(), `gcs-dl-config-${process.pid}`),
    secret: () => "gcs-test-secret",
    scanner: () => av.scanner,
  });

  let counter = 0;
  async function user(name: string, group = "member"): Promise<GcsActor> {
    return w.actorFor(await w.createUser(`${name}${++counter}`, group));
  }

  /** O categorie (ca Root Admin), cu opțiunile schimbate. */
  async function category(options: Record<string, unknown> = {}, extra: { parentId?: number | null; vipOnly?: boolean; name?: string } = {}) {
    return dl.admin.createCategory(w.root, { name: extra.name ?? `Categoria ${++counter}`, parentId: extra.parentId ?? null, vipOnly: extra.vipOnly ?? false, options });
  }

  /** Încarcă un fișier întreg (bucăți de mărimea cerută de server) și rulează procesarea. */
  async function upload(actor: GcsActor, categoryId: number, name: string, bytes: Buffer, run = true): Promise<string> {
    const started = await dl.uploads.start(actor, { categoryId, name, size: bytes.length });
    for (let offset = 0; offset < bytes.length; offset += started.chunkSize) await dl.uploads.chunk(actor, started.id, offset, bytes.subarray(offset, offset + started.chunkSize));
    if (run) await q.run();
    return started.id;
  }

  const zip = (text = "hello") => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(text.padEnd(64, "."))]);

  return { ...w, apps, notifications, av, q, dl, user, category, upload, zip };
}

export type GcsDownloadWorld = Awaited<ReturnType<typeof createDownloadWorld>>;
