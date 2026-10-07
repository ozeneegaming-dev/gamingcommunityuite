import { hash, verify, type Algorithm, type Options } from "@node-rs/argon2";
import type { PrismaClient } from "@gcs/db";
import { isLegacyPasswordHash, verifyLegacyPassword } from "./legacyPasswords";

/**
 * Argon2id cu parametrii minimi recomandați de OWASP (19 MiB, 2 iterații, 1 fir).
 * `Algorithm` e un `const enum` ambiental, inaccesibil cu `isolatedModules`, deci folosim valoarea lui (Argon2id = 2).
 */
const OPTIONS: Options = {
  algorithm: 2 as Algorithm,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(pw: string): Promise<string> {
  return hash(pw, OPTIONS);
}

/**
 * `false` și pentru un hash invalid. Hash-urile importate din altă platformă sunt marcate (`legacy-…`) și se
 * verifică după formula lor (vezi `legacyPasswords.ts`).
 */
export async function verifyPassword(passwordHash: string, pw: string): Promise<boolean> {
  if (isLegacyPasswordHash(passwordHash)) return verifyLegacyPassword(passwordHash, pw);
  try {
    return await verify(passwordHash, pw);
  } catch {
    return false;
  }
}

/**
 * După o autentificare reușită cu un hash importat: parola se rescrie în Argon2id. Hash-ul vechi (cu sarea lui)
 * identifică contul. Întoarce câte conturi au fost actualizate (0 dacă hash-ul nu e vechi).
 */
export async function upgradeLegacyPassword(db: Pick<PrismaClient, "account">, legacyHash: string, pw: string): Promise<number> {
  if (!isLegacyPasswordHash(legacyHash)) return 0;
  const fresh = await hashPassword(pw);
  const result = await db.account.updateMany({ where: { providerId: "credential", password: legacyHash }, data: { password: fresh } });
  return result.count;
}
