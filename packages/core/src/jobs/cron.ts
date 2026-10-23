import { createHmac, timingSafeEqual } from "node:crypto";

/** Când a rulat ultima dată cron-ul (ms), pentru pasul „Cron” al instalării și ACP. */
export const CRON_LAST_KEY = "gcs:cron:last";
/** Fără o rulare de cron de atâta timp, ediția Lite o semnalează în ACP (joburile rulează doar cât procesul trăiește). */
export const CRON_STALE_MS = 15 * 60_000;

/**
 * Tokenul adresei de cron (`/api/cron?token=…`, ediția Lite), derivat din secretul aplicației: nu se salvează nicăieri,
 * se schimbă odată cu `GCS_SECRET`.
 */
export function cronToken(secret: string): string {
  return createHmac("sha256", secret).update("gcs-cron").digest("hex").slice(0, 40);
}

export function verifyCronToken(given: unknown, secret: string): boolean {
  if (typeof given !== "string" || given.length === 0) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(cronToken(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
