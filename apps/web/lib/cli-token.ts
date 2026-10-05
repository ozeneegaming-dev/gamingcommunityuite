import { createHmac, timingSafeEqual } from "node:crypto";

/** Antetul cu care CLI-ul `gcs` se autentifică la `/api/internal/cli`. */
export const CLI_TOKEN_HEADER = "x-gcs-cli-token";

/**
 * Tokenul CLI-ului: HMAC-SHA256 al secretului aplicației (`GCS_SECRET`, din mediul containerului).
 * Doar cine are acces la container (deci la secret) îl poate calcula.
 */
export function cliToken(secret: string): string {
  return createHmac("sha256", secret).update("gcs-cli").digest("hex");
}

export function isValidCliToken(token: string | null, secret: string | undefined): boolean {
  if (!token || !secret) return false;
  const expected = Buffer.from(cliToken(secret));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
