import type { Prisma, PrismaClient } from "@gcs/db";

/** Tipurile din harta id vechi → id nou. */
export type GcsMapType =
  | "group"
  | "member"
  | "profile_field"
  | "forum"
  | "prefix"
  | "topic"
  | "attachment"
  | "post"
  | "conversation"
  | "message"
  | "warning"
  | "status";

type Db = Pick<PrismaClient, "importMap"> | Prisma.TransactionClient;

/**
 * Prefixul legăturii unui membru importat al cărui cont a fost șters (specul 2026-10-09-stergere-unire-membri): o rulare
 * nouă nu-l recreează (legătura există), iar conținutul lui se importă fără autor (legătura nu dă un cont).
 */
export const IMPORT_DELETED_MEMBER = "deleted:";

/**
 * Harta id vechi → id nou (`import_map`), pe cheia sursei (schema + host-ul vechi). Fiecare entitate creată intră în
 * hartă în aceeași tranzacție, deci o rulare nouă (reluare sau sincronizare) sare exact peste ce există deja.
 */
export class GcsImportMap {
  constructor(
    private readonly db: Pick<PrismaClient, "importMap">,
    readonly source: string,
  ) {}

  /**
   * Id-urile noi pentru id-urile vechi date (lipsă = încă neimportate). Membrii cu contul șters lipsesc din rezultat (fără
   * autor), în afară de `includeDeleted` (pasul membrilor: legătura există, deci nu-i recreează).
   */
  async get(type: GcsMapType, ids: Iterable<string>, opts: { includeDeleted?: boolean } = {}): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].filter((x) => x !== "");
    const out = new Map<string, string>();
    for (let i = 0; i < unique.length; i += 1000) {
      const rows = await this.db.importMap.findMany({ where: { source: this.source, type, sourceId: { in: unique.slice(i, i + 1000) } }, select: { sourceId: true, targetId: true } });
      for (const r of rows) if (opts.includeDeleted || !r.targetId.startsWith(IMPORT_DELETED_MEMBER)) out.set(r.sourceId, r.targetId);
    }
    return out;
  }

  async one(type: GcsMapType, id: string): Promise<string | null> {
    return (await this.get(type, [id])).get(id) ?? null;
  }

  /** Toată harta unui tip mic (grupuri, forumuri, prefixe, câmpuri). */
  async all(type: GcsMapType): Promise<Map<string, string>> {
    const rows = await this.db.importMap.findMany({ where: { source: this.source, type }, select: { sourceId: true, targetId: true } });
    return new Map(rows.filter((r) => !r.targetId.startsWith(IMPORT_DELETED_MEMBER)).map((r) => [r.sourceId, r.targetId]));
  }

  async set(tx: Db, type: GcsMapType, sourceId: string, targetId: string | number): Promise<void> {
    await tx.importMap.create({ data: { source: this.source, type, sourceId, targetId: String(targetId) } });
  }

  async count(type: GcsMapType): Promise<number> {
    return this.db.importMap.count({ where: { source: this.source, type } });
  }
}
