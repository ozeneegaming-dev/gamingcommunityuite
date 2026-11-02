import type { PrismaClient } from "@gcs/db";
import { writeAudit } from "../audit";
import type { GcsKv } from "../infra/kv";
import type { GcsActor } from "../permissions/types";
import type { GcsSettingsService } from "../settings/service";

/** Câte parole greșite blochează contul (0 = blocarea e oprită) și pentru câte minute. */
export const LOGIN_MAX_ATTEMPTS_SETTING = "security.login_max_attempts";
export const LOGIN_LOCK_MINUTES_SETTING = "security.login_lock_minutes";
/** Un IP e blocat după de atâtea ori mai multe încercări greșite decât un cont (încercări pe multe conturi). */
export const IP_LOCK_FACTOR = 3;

const PREFIX = "gcs:login:";
const failKey = (scope: "u" | "ip", id: string) => `${PREFIX}fail:${scope}:${id}`;
const lockKey = (scope: "u" | "ip", id: string) => `${PREFIX}lock:${scope}:${id}`;

export type GcsLoginLock = { scope: "account" | "ip"; until: Date };
export type GcsLoginLockConfig = { maxAttempts: number; lockMinutes: number };

/**
 * Blocarea după parole greșite (ACP → Setări → Securitate). Încercările greșite se numără pe cont și pe IP, în
 * stocarea cheilor (Redis în VPS, baza de date în Lite), într-o fereastră egală cu durata blocării. La N încercări
 * greșite contul se blochează M minute (o intrare în jurnalul ACP); un IP, la de 3 ori mai multe. Blocarea se verifică
 * la autentificare și expiră singură (fără job); adminul o poate ridica din pagina membrului.
 */
export class GcsLoginLockout {
  constructor(
    private readonly deps: {
      db: Pick<PrismaClient, "auditLog">;
      kv: GcsKv;
      settings: Pick<GcsSettingsService, "get">;
      /** Blocarea pe IP (oprită împreună cu rate limit-ul, `GCS_DISABLE_RATE_LIMIT=1`). */
      ipLock?: () => boolean;
    },
  ) {}

  async config(): Promise<GcsLoginLockConfig> {
    const { settings } = this.deps;
    const [max, minutes] = await Promise.all([
      settings.get<number>(LOGIN_MAX_ATTEMPTS_SETTING).catch(() => 5),
      settings.get<number>(LOGIN_LOCK_MINUTES_SETTING).catch(() => 15),
    ]);
    return {
      maxAttempts: Number.isInteger(max) && max > 0 ? max : 0,
      lockMinutes: Number.isInteger(minutes) && minutes > 0 ? minutes : 15,
    };
  }

  private ipEnabled(ip: string | null): ip is string {
    return !!ip && ip !== "0.0.0.0" && (this.deps.ipLock?.() ?? true);
  }

  private async readLock(key: string, now: Date): Promise<Date | null> {
    const raw = await this.deps.kv.get(key);
    const until = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(until) && until > now.getTime() ? new Date(until) : null;
  }

  /** Blocarea activă a contului sau a IP-ului (contul are prioritate), ori `null`. */
  async status(input: { userId: string | null; ip: string | null }, now = new Date()): Promise<GcsLoginLock | null> {
    if (input.userId) {
      const until = await this.readLock(lockKey("u", input.userId), now);
      if (until) return { scope: "account", until };
    }
    if (this.ipEnabled(input.ip)) {
      const until = await this.readLock(lockKey("ip", input.ip), now);
      if (until) return { scope: "ip", until };
    }
    return null;
  }

  /** Până când e blocat contul (pagina membrului din ACP), ori `null`. */
  lockedUntil(userId: string, now = new Date()): Promise<Date | null> {
    return this.readLock(lockKey("u", userId), now);
  }

  /**
   * O parolă greșită (`userId` = contul găsit după email, `null` pentru un email necunoscut). Întoarce blocarea pusă
   * acum, dacă încercarea a atins pragul; blocarea se aplică de la următoarea încercare.
   */
  async recordFailure(input: { userId: string | null; ip: string | null }, now = new Date()): Promise<GcsLoginLock | null> {
    const { maxAttempts, lockMinutes } = await this.config();
    if (maxAttempts <= 0) return null;
    const windowSec = lockMinutes * 60;
    const until = new Date(now.getTime() + windowSec * 1000);
    let lock: GcsLoginLock | null = null;
    if (input.userId) {
      const { count } = await this.deps.kv.incrWindow(failKey("u", input.userId), windowSec);
      if (count >= maxAttempts) {
        await this.lock(lockKey("u", input.userId), failKey("u", input.userId), until, windowSec);
        await writeAudit(this.deps.db, {
          actorId: null,
          action: "auth.login_locked",
          targetType: "user",
          targetId: input.userId,
          after: { attempts: count, minutes: lockMinutes },
          ip: input.ip,
        });
        lock = { scope: "account", until };
      }
    }
    if (this.ipEnabled(input.ip)) {
      const { count } = await this.deps.kv.incrWindow(failKey("ip", input.ip), windowSec);
      if (count >= maxAttempts * IP_LOCK_FACTOR) {
        await this.lock(lockKey("ip", input.ip), failKey("ip", input.ip), until, windowSec);
        await writeAudit(this.deps.db, { actorId: null, action: "auth.ip_locked", targetType: "ip", targetId: input.ip, after: { attempts: count, minutes: lockMinutes }, ip: input.ip });
        lock ??= { scope: "ip", until };
      }
    }
    return lock;
  }

  private async lock(key: string, counter: string, until: Date, windowSec: number): Promise<void> {
    await this.deps.kv.set(key, String(until.getTime()), { ttlMs: windowSec * 1000 });
    await this.deps.kv.del(counter);
  }

  /** O autentificare reușită uită încercările greșite ale contului (nu și pe cele ale IP-ului). */
  async recordSuccess(userId: string): Promise<void> {
    await this.deps.kv.del(failKey("u", userId));
  }

  /**
   * Uită blocarea și încercările greșite ale contului, fără jurnal: parola s-a schimbat prin „Am uitat parola” (resetarea
   * are intrarea ei în jurnal). Blocarea IP-ului rămâne.
   */
  async clear(userId: string): Promise<void> {
    await this.deps.kv.del(lockKey("u", userId), failKey("u", userId));
  }

  /** Ridică blocarea contului (ACP → Membri → membrul). Întoarce `false` dacă nu era blocat. */
  async unlock(actor: GcsActor, userId: string, now = new Date()): Promise<boolean> {
    const locked = (await this.lockedUntil(userId, now)) !== null;
    await this.deps.kv.del(lockKey("u", userId), failKey("u", userId));
    if (locked) await writeAudit(this.deps.db, { actorId: actor.userId, action: "auth.login_unlocked", targetType: "user", targetId: userId, ip: actor.ip });
    return locked;
  }
}
