import { hash, verify, type Algorithm, type Options } from "@node-rs/argon2";

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

/** `false` și pentru un hash invalid sau într-un alt format (ex. bcrypt, importat din IPS). */
export async function verifyPassword(passwordHash: string, pw: string): Promise<boolean> {
  try {
    return await verify(passwordHash, pw);
  } catch {
    return false;
  }
}
