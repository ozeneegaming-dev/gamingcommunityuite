import type { GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { RETENTION_KEYS, retentionSetting, type GcsRetentionKey } from "./settings";

/** Jobul zilnic al perioadelor de păstrare (worker-ul VPS sau coada SQL a ediției Lite). */
export const RETENTION_JOB = "system.retention";
/** Câte rânduri se șterg dintr-o dată (o tranzacție scurtă, fără blocări lungi pe tabele mari). */
export const RETENTION_BATCH = 1000;

/** Intrările de autentificare din jurnalul ACP (urmează perioada „autentificări”, nu pe cea a jurnalului). */
export const LOGIN_AUDIT_ACTIONS = ["acp.login", "acp.login_failed", "auth.login_locked", "auth.login_unlocked", "auth.ip_locked"];

export type GcsRetentionResult = Record<GcsRetentionKey, number>;

const DAY_MS = 86_400_000;

/**
 * Perioadele de păstrare a datelor (ACP → Setări → Termeni și confidențialitate): ce e mai vechi decât perioada se
 * șterge, pe loturi. 0 zile = se păstrează mereu.
 * - `audit_days`: jurnalul ACP (fără intrările de autentificare);
 * - `login_days`: dispozitivele nevăzute de atâtea zile (istoricul autentificărilor, cu IP-ul) și intrările de
 *   autentificare din jurnalul ACP;
 * - `spam_log_days`: jurnalul anti-spam;
 * - `plugin_log_days`: jurnalul pluginurilor (erorile hook-urilor și mesajele lor);
 * - `sessions_days`: sesiunile și tokenurile de verificare expirate de atâtea zile.
 */
export class GcsRetentionService {
  constructor(private readonly deps: { db: PrismaClient; settings: Pick<GcsSettingsService, "get"> }) {}

  private async days(key: GcsRetentionKey): Promise<number> {
    const value = await this.deps.settings.get<number>(retentionSetting(key)).catch(() => 0);
    return Number.isInteger(value) && value > 0 ? value : 0;
  }

  /** Rulează toate perioadele; întoarce câte rânduri s-au șters pe fiecare. */
  async run(now = new Date()): Promise<GcsRetentionResult> {
    const result = Object.fromEntries(RETENTION_KEYS.map((k) => [k, 0])) as GcsRetentionResult;
    for (const key of RETENTION_KEYS) {
      const days = await this.days(key);
      if (days > 0) result[key] = await this.prune(key, new Date(now.getTime() - days * DAY_MS));
    }
    return result;
  }

  private async prune(key: GcsRetentionKey, cutoff: Date): Promise<number> {
    const { db } = this.deps;
    const before = { lt: cutoff };
    switch (key) {
      case "audit_days":
        return batched(
          () => db.auditLog.findMany({ where: { createdAt: before, action: { notIn: LOGIN_AUDIT_ACTIONS } }, select: { id: true }, take: RETENTION_BATCH }),
          (ids) => db.auditLog.deleteMany({ where: { id: { in: ids } } }),
        );
      case "login_days":
        return (
          (await batched(
            () => db.userDevice.findMany({ where: { lastSeenAt: before }, select: { id: true }, take: RETENTION_BATCH }),
            (ids) => db.userDevice.deleteMany({ where: { id: { in: ids } } }),
          )) +
          (await batched(
            () => db.auditLog.findMany({ where: { createdAt: before, action: { in: LOGIN_AUDIT_ACTIONS } }, select: { id: true }, take: RETENTION_BATCH }),
            (ids) => db.auditLog.deleteMany({ where: { id: { in: ids } } }),
          ))
        );
      case "spam_log_days":
        return batched(
          () => db.spamLog.findMany({ where: { createdAt: before }, select: { id: true }, take: RETENTION_BATCH }),
          (ids) => db.spamLog.deleteMany({ where: { id: { in: ids } } }),
        );
      case "plugin_log_days":
        return batched(
          () => db.pluginLog.findMany({ where: { createdAt: before }, select: { id: true }, take: RETENTION_BATCH }),
          (ids) => db.pluginLog.deleteMany({ where: { id: { in: ids } } }),
        );
      case "sessions_days":
        return (
          (await batched(
            () => db.session.findMany({ where: { expiresAt: before }, select: { id: true }, take: RETENTION_BATCH }),
            (ids) => db.session.deleteMany({ where: { id: { in: ids } } }),
          )) +
          (await batched(
            () => db.verification.findMany({ where: { expiresAt: before }, select: { id: true }, take: RETENTION_BATCH }),
            (ids) => db.verification.deleteMany({ where: { id: { in: ids } } }),
          ))
        );
    }
  }
}

/** Șterge pe loturi: citește id-urile unui lot, le șterge, până rămâne un lot incomplet. */
async function batched<T extends string | number>(page: () => Promise<{ id: T }[]>, remove: (ids: T[]) => Promise<{ count: number }>): Promise<number> {
  let total = 0;
  for (;;) {
    const ids = (await page()).map((r) => r.id);
    if (ids.length === 0) return total;
    total += (await remove(ids)).count;
    if (ids.length < RETENTION_BATCH) return total;
  }
}
