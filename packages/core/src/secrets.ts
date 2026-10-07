import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const DEV_SECRET = "gcs-dev-secret-not-for-production-use";
const VERSION = "v1";

/** Cheia AES-256 derivată (HKDF) din secretul aplicației, același în `web` și în `gcs-worker`. */
function deriveKey(secret?: string): Buffer {
  const base = secret ?? process.env.GCS_SECRET ?? (process.env.NODE_ENV === "production" ? undefined : DEV_SECRET);
  if (!base) throw new Error("GCS_SECRET lipsește");
  return Buffer.from(hkdfSync("sha256", base, "gcs", "gcs:secret-box:v1", 32));
}

/**
 * Criptează un secret de stocat în baza de date (ex. parola bazei vechi la import): AES-256-GCM, IV aleator.
 * Forma: `v1.<iv>.<tag>.<text cifrat>` (base64url).
 */
export function sealSecret(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Decriptează un secret; `null` dacă a fost modificat sau cheia e alta (ex. `GCS_SECRET` schimbat). */
export function openSecret(sealed: string, secret?: string): string | null {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
