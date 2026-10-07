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
 * Harta id vechi → id nou (`import_map`), pe cheia sursei (schema + host-ul vechi). Fiecare entitate creată intră în
 * hartă în aceeași tranzacție, deci o rulare nouă (reluare sau sincronizare) sare exact peste ce există deja.
 */
export class GcsImportMap {
  constructor(
    private readonly db: Pick<PrismaClient, "importMap">,
    readonly source: string,
  ) {}

  /** Id-urile noi pentru id-urile vechi date (lipsă = încă neimportate). */
  async get(type: GcsMapType, ids: Iterable<string>): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].filter((x) => x !== "");
    const out = new Map<string, string>();
    for (let i = 0; i < unique.length; i += 1000) {
      const rows = await this.db.importMap.findMany({ where: { source: this.source, type, sourceId: { in: unique.slice(i, i + 1000) } }, select: { sourceId: true, targetId: true } });
      for (const r of rows) out.set(r.sourceId, r.targetId);
    }
    return out;
  }

  async one(type: GcsMapType, id: string): Promise<string | null> {
    return (await this.get(type, [id])).get(id) ?? null;
  }

  /** Toată harta unui tip mic (grupuri, forumuri, prefixe, câmpuri). */
  async all(type: GcsMapType): Promise<Map<string, string>> {
    const rows = await this.db.importMap.findMany({ where: { source: this.source, type }, select: { sourceId: true, targetId: true } });
    return new Map(rows.map((r) => [r.sourceId, r.targetId]));
  }

  async set(tx: Db, type: GcsMapType, sourceId: string, targetId: string | number): Promise<void> {
    await tx.importMap.create({ data: { source: this.source, type, sourceId, targetId: String(targetId) } });
  }

  async count(type: GcsMapType): Promise<number> {
    return this.db.importMap.count({ where: { source: this.source, type } });
  }
}
