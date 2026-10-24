import { createHash } from "node:crypto";
import type { Prisma } from "@gcs/db";

/** Benzile lacătelor de tranzacție, după cele 256 ale `GcsSqlKv` (același tabel, alt interval). */
const FIRST = 1000;
const STRIPES = 4096;

/**
 * Lacăt pe o cheie până la sfârșitul tranzacției (fostul `pg_advisory_xact_lock`), portabil pe PostgreSQL și MySQL:
 * cheia alege o bandă din `gcs_kv_locks`, blocată cu `SELECT … FOR UPDATE`. Două tranzacții cu aceeași cheie se
 * așteaptă una pe alta; chei diferite pot împărți rar o bandă (doar așteptare în plus, fără erori).
 */
export async function gcsTxLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  const stripe = FIRST + (createHash("sha1").update(key).digest().readUInt32BE(0) % STRIPES);
  const rows = await tx.$queryRawUnsafe<unknown[]>(`SELECT stripe FROM gcs_kv_locks WHERE stripe = ${stripe} FOR UPDATE`);
  if (rows.length > 0) return;
  await tx.gcsKvLock.createMany({ data: [{ stripe }], skipDuplicates: true });
  await tx.$queryRawUnsafe(`SELECT stripe FROM gcs_kv_locks WHERE stripe = ${stripe} FOR UPDATE`);
}
