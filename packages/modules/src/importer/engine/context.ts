import { normalizeUsername, type GcsActor, type GcsDoc, type GcsDocNode, type GcsRendered, type GcsRenderOptions } from "@gcs/core";
import type { Prisma } from "@gcs/db";
import type { GcsConvertAttachment, GcsConvertContext } from "../convert/context";
import { convertContent, renderImported } from "../convert";
import type { GcsImportFiles } from "../source/files";
import type { GcsBatch, GcsContentFormat, GcsSourceAdapter } from "../types";
import type { GcsImportMap } from "./map";
import { GcsImportStop, type GcsImportConfig, type GcsImportEngineDeps, type GcsImportStepState } from "./types";

type Tx = Prisma.TransactionClient;
export type GcsRowResult = "imported" | "skipped";

/** Tranzacțiile loturilor: scurte, dar cu loc pentru un lot întreg de postări convertite. */
export const IMPORT_TX = { timeout: 120_000, maxWait: 30_000 };

/** Un cache cu scrieri „în așteptare”: intră în cache doar după commit-ul tranzacției care le-a produs. */
export class GcsOverlay<V> {
  private readonly base = new Map<string, V>();
  private local = new Map<string, V>();

  get(key: string): V | undefined {
    return this.local.get(key) ?? this.base.get(key);
  }

  has(key: string): boolean {
    return this.local.has(key) || this.base.has(key);
  }

  set(key: string, value: V): void {
    this.local.set(key, value);
  }

  /** Valori deja confirmate (ex. încărcate din baza de date). */
  seed(entries: Iterable<[string, V]>): void {
    for (const [k, v] of entries) this.base.set(k, v);
    if (this.base.size > 50_000) this.base.clear();
  }

  commit(): void {
    for (const [k, v] of this.local) this.base.set(k, v);
    this.local = new Map();
  }

  discard(): void {
    this.local = new Map();
  }
}

/** Ce id-uri cere convertorul la prima trecere (ca harta să se încarce o singură dată pe lot). */
type Refs = { members: Set<string>; names: Set<string>; posts: Set<string>; topics: Set<string>; forums: Set<string>; attachments: Set<string> };
const emptyRefs = (): Refs => ({ members: new Set(), names: new Set(), posts: new Set(), topics: new Set(), forums: new Set(), attachments: new Set() });

/**
 * Rezolvarea entităților deja importate pentru convertor: id-urile vechi → membri, postări, topicuri, forumuri și
 * atașamente noi. Se încarcă pe loturi; postările create în lotul curent intră prin `GcsOverlay`.
 */
export class GcsImportLookups {
  readonly members = new GcsOverlay<{ id: string; name: string } | null>();
  readonly names = new GcsOverlay<{ id: string; name: string } | null>();
  readonly posts = new GcsOverlay<{ id: number; topicId: number } | null>();
  readonly topics = new GcsOverlay<{ id: number; slug: string } | null>();
  readonly forums = new GcsOverlay<{ id: number; slug: string } | null>();
  readonly attachments = new GcsOverlay<GcsConvertAttachment | null>();

  constructor(
    private readonly deps: { db: GcsImportEngineDeps["db"]; map: GcsImportMap },
    private readonly base: { schema: GcsConvertContext["schema"]; oldUrl: string | null },
  ) {}

  /** Contextul care doar notează ce se cere (prima trecere). */
  recorder(refs: Refs): GcsConvertContext {
    return {
      ...this.base,
      member: (id) => (refs.members.add(id), null),
      memberByName: (name) => (refs.names.add(normalizeUsername(name)), null),
      post: (id) => (refs.posts.add(id), null),
      topic: (id) => (refs.topics.add(id), null),
      forum: (id) => (refs.forums.add(id), null),
      attachment: (id) => (refs.attachments.add(id), null),
    };
  }

  context(): GcsConvertContext {
    return {
      ...this.base,
      member: (id) => this.members.get(id) ?? null,
      memberByName: (name) => this.names.get(normalizeUsername(name)) ?? null,
      post: (id) => this.posts.get(id) ?? null,
      topic: (id) => this.topics.get(id) ?? null,
      forum: (id) => this.forums.get(id) ?? null,
      attachment: (id) => this.attachments.get(id) ?? null,
    };
  }

  async load(refs: Refs): Promise<void> {
    const { db, map } = this.deps;
    const missing = (o: GcsOverlay<unknown>, ids: Set<string>) => [...ids].filter((id) => !o.has(id));

    const memberIds = missing(this.members, refs.members);
    if (memberIds.length > 0) {
      const mapped = await map.get("member", memberIds);
      const users = await db.user.findMany({ where: { id: { in: [...mapped.values()] } }, select: { id: true, name: true } });
      const byId = new Map(users.map((u) => [u.id, u]));
      this.members.seed(memberIds.map((id) => [id, byId.get(mapped.get(id) ?? "") ?? null]));
    }
    const names = missing(this.names, refs.names);
    if (names.length > 0) {
      const users = await db.user.findMany({ where: { nameNormalized: { in: names } }, select: { id: true, name: true, nameNormalized: true } });
      const byName = new Map(users.map((u) => [u.nameNormalized, { id: u.id, name: u.name }]));
      this.names.seed(names.map((n) => [n, byName.get(n) ?? null]));
    }
    const postIds = missing(this.posts, refs.posts);
    if (postIds.length > 0) {
      const mapped = await map.get("post", postIds);
      const rows = await db.post.findMany({ where: { id: { in: [...mapped.values()].map(Number) } }, select: { id: true, topicId: true } });
      const byId = new Map(rows.map((p) => [String(p.id), p]));
      this.posts.seed(postIds.map((id) => [id, byId.get(mapped.get(id) ?? "") ?? null]));
    }
    for (const [overlay, ids, type] of [
      [this.topics, refs.topics, "topic"],
      [this.forums, refs.forums, "forum"],
    ] as const) {
      const need = missing(overlay, ids);
      if (need.length === 0) continue;
      const mapped = await map.get(type, need);
      const targets = [...mapped.values()].map(Number);
      const rows = type === "topic"
        ? await db.topic.findMany({ where: { id: { in: targets } }, select: { id: true, slug: true } })
        : await db.forum.findMany({ where: { id: { in: targets } }, select: { id: true, slug: true } });
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      overlay.seed(need.map((id) => [id, byId.get(mapped.get(id) ?? "") ?? null]));
    }
    const attIds = missing(this.attachments, refs.attachments);
    if (attIds.length > 0) {
      const mapped = await map.get("attachment", attIds);
      const rows = await db.attachment.findMany({ where: { id: { in: [...mapped.values()] } }, select: { id: true, filename: true, mime: true, width: true, height: true } });
      const byId = new Map(rows.map((a) => [a.id, { id: a.id, isImage: a.mime.startsWith("image/"), filename: a.filename, width: a.width, height: a.height }]));
      this.attachments.seed(attIds.map((id) => [id, byId.get(mapped.get(id) ?? "") ?? null]));
    }
  }

  commit(): void {
    this.posts.commit();
    this.members.commit();
  }

  discard(): void {
    this.posts.discard();
    this.members.discard();
  }
}

export type GcsConvertedContent = {
  rendered: GcsRendered;
  unrecognized: number;
  fallback: boolean;
  /** Id-urile GCS ale atașamentelor folosite (inline sau adăugate la final). */
  attachmentIds: string[];
};

/** Atașamentele nefolosite în text se adaugă la finalul conținutului (imagini sau linkuri). */
function appendAttachments(doc: GcsDoc | null, list: GcsConvertAttachment[]): GcsDoc | null {
  if (list.length === 0) return doc;
  const nodes: GcsDocNode[] = list.map((a) =>
    a.isImage
      ? { type: "image", attrs: { attachmentId: a.id, alt: a.filename.slice(0, 300), ...(a.width ? { width: a.width } : {}), ...(a.height ? { height: a.height } : {}) } }
      : { type: "paragraph", content: [{ type: "text", text: a.filename, marks: [{ type: "link", attrs: { href: `/files/${a.id}` } }] }] },
  );
  return { type: "doc", content: [...(doc?.content ?? []), ...nodes] };
}

/** Contextul unui pas: sursa, harta, starea, jurnalul și unelte pentru loturi și conținut. */
export class GcsStepContext {
  constructor(
    readonly deps: GcsImportEngineDeps,
    readonly job: { id: string; config: GcsImportConfig; postsPerPage: number },
    readonly adapter: GcsSourceAdapter,
    readonly files: GcsImportFiles | null,
    readonly map: GcsImportMap,
    readonly state: GcsImportStepState,
    readonly actor: GcsActor,
    readonly render: GcsRenderOptions,
    private readonly hooks: { log: (level: "info" | "warn" | "error", message: string, sourceId?: string) => Promise<void>; checkpoint: () => Promise<void> },
  ) {}

  get format(): GcsContentFormat {
    return this.adapter.format;
  }

  log(level: "info" | "warn" | "error", message: string, sourceId?: string): Promise<void> {
    return this.hooks.log(level, message, sourceId);
  }

  /** Salvează progresul și verifică pauza sau anularea (în afara loturilor sursei, ex. la finalizare). */
  checkpointProgress(): Promise<void> {
    return this.hooks.checkpoint();
  }

  newLookups(): GcsImportLookups {
    return new GcsImportLookups({ db: this.deps.db, map: this.map }, { schema: this.adapter.schema, oldUrl: this.job.config.oldUrl || null });
  }

  /** Toate loturile unei metode a sursei, de la cursorul salvat; după fiecare lot: progres, checkpoint, pauză/anulare. */
  async batches<T>(fetch: (cursor: string | null, limit: number) => Promise<GcsBatch<T>>, limit: number, handle: (rows: T[]) => Promise<void>): Promise<void> {
    let cursor = this.state.cursor;
    for (;;) {
      const batch = await fetch(cursor, limit);
      if (batch.rows.length > 0) await handle(batch.rows);
      this.state.done += batch.rows.length;
      this.state.cursor = batch.next;
      await this.hooks.checkpoint();
      if (batch.next === null) return;
      cursor = batch.next;
    }
  }

  /**
   * Rândurile unui lot, într-o singură tranzacție. Dacă tranzacția pică, lotul se reia rând cu rând: rândul stricat
   * ajunge în jurnal ca eroare, restul merge mai departe. `onCommit`/`onRollback` confirmă sau aruncă cache-urile.
   */
  async rows<T>(
    rows: T[],
    idOf: (row: T) => string,
    handle: (tx: Tx, row: T) => Promise<GcsRowResult>,
    hooks: { onCommit?: () => void; onRollback?: () => void } = {},
  ): Promise<void> {
    const { db } = this.deps;
    try {
      const results = await db.$transaction(async (tx) => {
        const out: GcsRowResult[] = [];
        for (const row of rows) out.push(await handle(tx, row));
        return out;
      }, IMPORT_TX);
      hooks.onCommit?.();
      for (const r of results) this.state[r]++;
      return;
    } catch (error) {
      hooks.onRollback?.();
      if (error instanceof GcsImportStop) throw error;
    }
    for (const row of rows) {
      try {
        const result = await db.$transaction((tx) => handle(tx, row), IMPORT_TX);
        hooks.onCommit?.();
        this.state[result]++;
      } catch (error) {
        hooks.onRollback?.();
        if (error instanceof GcsImportStop) throw error;
        this.state.errors++;
        await this.log("error", errorMessage(error), idOf(row));
      }
    }
  }

  /** Prima trecere a convertorului: notează ce entități cere conținutul. */
  collectRefs(lookups: GcsImportLookups, raws: string[]): ReturnType<typeof emptyRefs> {
    const refs = emptyRefs();
    const recorder = lookups.recorder(refs);
    for (const raw of raws) convertContent(this.format, raw, recorder);
    return refs;
  }

  /** Conținutul vechi → document GCS randat (a doua trecere), cu atașamentele rămase adăugate la final. */
  convert(lookups: GcsImportLookups, raw: string, attachmentSourceIds: string[] = []): GcsConvertedContent {
    const ctx = lookups.context();
    const result = convertContent(this.format, raw, ctx);
    const inline = new Set(result.attachments);
    const extra = attachmentSourceIds.filter((id) => !inline.has(id)).map((id) => ctx.attachment(id)).filter((a): a is GcsConvertAttachment => a !== null);
    const doc = appendAttachments(result.doc, extra);
    const rendered = renderImported(doc, this.format, raw, this.render);
    const used = [...result.attachments.map((id) => ctx.attachment(id)?.id), ...extra.map((a) => a.id)].filter((id): id is string => !!id);
    return { rendered, unrecognized: result.unrecognized, fallback: rendered.fallback, attachmentIds: [...new Set(used)] };
  }

  emptyRefs(): Refs {
    return emptyRefs();
  }
}

/** Mesajul unei erori pentru jurnal: scurt, fără detaliile interne ale driverului. */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim().slice(0, 300) || "eroare necunoscută";
}
