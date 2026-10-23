import { randomUUID } from "node:crypto";
import type { GcsKv } from "./kv";

/**
 * Lacăte scurte între procese (worker, web, cron), peste `GcsKv`: `SET NX` cu expirare și eliberare doar de către cel
 * care l-a luat. Expirarea e plasa de siguranță pentru un proces oprit în timp ce ține lacătul.
 */
export class GcsLock {
  constructor(
    private readonly kv: GcsKv,
    private readonly prefix = "gcs:lock:",
  ) {}

  /** Ia lacătul; întoarce tokenul (pentru `release`) sau `null` dacă e ținut de altcineva. */
  async acquire(name: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    return (await this.kv.set(this.prefix + name, token, { ttlMs, nx: true })) ? token : null;
  }

  async release(name: string, token: string): Promise<void> {
    await this.kv.delIfEquals(this.prefix + name, token);
  }

  /** Rulează `fn` doar dacă lacătul e liber; altfel întoarce `null` fără să aștepte. */
  async withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const token = await this.acquire(name, ttlMs);
    if (!token) return null;
    try {
      return await fn();
    } finally {
      await this.release(name, token).catch(() => {});
    }
  }

  /** „O dată pe interval”: primul apel din fereastră întoarce `true`, celelalte `false` (lacătul nu se eliberează). */
  async once(name: string, windowMs: number): Promise<boolean> {
    return this.kv.set(this.prefix + name, "1", { ttlMs: windowMs, nx: true });
  }
}
