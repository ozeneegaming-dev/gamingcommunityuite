import { createHash } from "node:crypto";
import { isMysql, type Prisma } from "@gcs/db";

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

/**
 * Ca `gcsTxLock`, dar fără așteptare (fostul `pg_try_advisory_xact_lock`): `false` dacă altă tranzacție ține deja
 * cheia (MySQL 8 / MariaDB 10.3+: `FOR UPDATE NOWAIT`; PostgreSQL: lacătul consultativ).
 */
export async function gcsTryTxLock(tx: Prisma.TransactionClient, key: string): Promise<boolean> {
  // PostgreSQL: lacătul consultativ (o eroare de lacăt ar anula tranzacția).
  if (!isMysql()) return ((await tx.$queryRawUnsafe<{ locked: boolean }[]>("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked", key))[0]?.locked ?? false) === true;
  const stripe = FIRST + (createHash("sha1").update(key).digest().readUInt32BE(0) % STRIPES);
  await tx.gcsKvLock.createMany({ data: [{ stripe }], skipDuplicates: true });
  try {
    await tx.$queryRawUnsafe(`SELECT stripe FROM gcs_kv_locks WHERE stripe = ${stripe} FOR UPDATE NOWAIT`);
    return true;
  } catch (error) {
    // PostgreSQL 55P03 (lock_not_available), MySQL 3572 (NOWAIT).
    if (/55P03|3572|could not obtain lock|NOWAIT/i.test(String((error as Error).message))) return false;
    throw error;
  }
}
