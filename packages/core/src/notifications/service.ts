import type { NotificationEmail, PrismaClient } from "@gcs/db";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsModuleRegistry } from "../modules/registry";
import type { GcsActor } from "../permissions/types";

export const NOTIFICATIONS_ACP_SECTION = "members.notifications";
const READ_RETENTION_DAYS = 90;
const UNREAD_TTL = 300;

/** Ce știe un modul despre ținta unei notificări: cine o poate vedea și cum se afișează. */
export type GcsNotificationTarget = {
  canView: (userId: string, targetId: string) => Promise<boolean>;
  describe: (targetId: string) => Promise<{ title: string; href: string; snippet?: string } | null>;
};

export type GcsNotifyInput = {
  userIds: string[];
  type: string;
  targetType: string;
  targetId: string;
  actorId: string | null;
  /** Date în plus, păstrate în notificare (ex. numele reacției). */
  data?: Record<string, unknown>;
};

export type GcsNotificationView = {
  id: number;
  type: string;
  count: number;
  actorIds: string[];
  data: { title?: string; href?: string; snippet?: string } & Record<string, unknown>;
  read: boolean;
  updatedAt: string;
};

export type GcsNotificationPrefs = Record<string, { site: boolean; email: NotificationEmail }>;

const notifTags = (userId: string) => [`notifications:${userId}`];

/**
 * Notificările (spec principal §10, specul etapei 4): stocare, grupare, preferințe pe tip și număr de necitite.
 * Modulele le creează din ascultători; livrarea live și emailurile pornesc din evenimentul `notification.created`.
 */
export class GcsNotificationService {
  private readonly targets = new Map<string, GcsNotificationTarget>();

  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; cache: GcsCache; registry: GcsModuleRegistry }) {}

  registerTarget(targetType: string, target: GcsNotificationTarget): void {
    this.targets.set(targetType, target);
  }

  /** Valorile implicite pe tip: cele salvate din ACP, completate cu cele declarate de module. */
  async defaults(): Promise<GcsNotificationPrefs> {
    const rows = await this.deps.db.notificationDefault.findMany();
    const saved = new Map(rows.map((r) => [r.type, r]));
    return Object.fromEntries(
      this.deps.registry.notificationTypes().map((t) => {
        const r = saved.get(t.key);
        return [t.key, { site: r?.site ?? true, email: r?.email ?? t.defaultEmail }];
      }),
    );
  }

  async preferences(userId: string): Promise<GcsNotificationPrefs> {
    const [defaults, rows] = await Promise.all([this.defaults(), this.deps.db.notificationPreference.findMany({ where: { userId } })]);
    for (const r of rows) if (defaults[r.type]) defaults[r.type] = { site: r.site, email: r.email };
    return defaults;
  }

  async setPreferences(userId: string, prefs: GcsNotificationPrefs): Promise<void> {
    const known = new Set(this.deps.registry.notificationTypes().map((t) => t.key));
    const valid = Object.entries(prefs).filter(([type, p]) => known.has(type) && typeof p.site === "boolean" && ["OFF", "INSTANT", "DIGEST"].includes(p.email));
    await this.deps.db.$transaction(
      valid.map(([type, p]) =>
        this.deps.db.notificationPreference.upsert({
          where: { userId_type: { userId, type } },
          create: { userId, type, site: p.site, email: p.email },
          update: { site: p.site, email: p.email },
        }),
      ),
    );
  }

  async setDefaults(actor: GcsActor, prefs: GcsNotificationPrefs): Promise<void> {
    const known = new Set(this.deps.registry.notificationTypes().map((t) => t.key));
    if (Object.keys(prefs).some((k) => !known.has(k))) throw new GcsValidationError({ type: "unknown" });
    const before = await this.defaults();
    await this.deps.db.$transaction(
      Object.entries(prefs).map(([type, p]) =>
        this.deps.db.notificationDefault.upsert({ where: { type }, create: { type, site: p.site, email: p.email }, update: { site: p.site, email: p.email } }),
      ),
    );
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "notifications.defaults", targetType: "settings", targetId: "notifications", before, after: prefs, ip: actor.ip });
  }

  /**
   * Creează (sau grupează) notificarea pentru fiecare destinatar care: nu e actorul, nu-l ignoră pe actor, vede ținta
   * și n-a oprit tipul pe site. Întoarce id-urile notificărilor create sau actualizate.
   */
  async notify(input: GcsNotifyInput): Promise<number[]> {
    const { db, bus, registry } = this.deps;
    const def = registry.notificationType(input.type);
    const target = this.targets.get(input.targetType);
    if (!def || !target) return [];
    let userIds = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
    if (userIds.length === 0) return [];

    if (input.actorId) {
      const ignoring = await db.userIgnore.findMany({ where: { userId: { in: userIds }, ignoredId: input.actorId }, select: { userId: true } });
      const skip = new Set(ignoring.map((r) => r.userId));
      userIds = userIds.filter((id) => !skip.has(id));
    }
    const visible: string[] = [];
    for (const id of userIds) if (await target.canView(id, input.targetId)) visible.push(id);
    if (visible.length === 0) return [];

    const [defaults, prefRows, described] = await Promise.all([
      this.defaults(),
      db.notificationPreference.findMany({ where: { userId: { in: visible }, type: input.type } }),
      target.describe(input.targetId),
    ]);
    if (!described) return [];
    const prefs = new Map(prefRows.map((p) => [p.userId, p]));
    const base = defaults[input.type] ?? { site: true, email: def.defaultEmail };
    const groupKey = `${input.type}:${input.targetType}:${input.targetId}`;
    const data = JSON.stringify({ ...described, ...(input.data ?? {}) });
    const now = new Date().toISOString();
    const out: number[] = [];

    for (const userId of visible) {
      const pref = prefs.get(userId) ?? base;
      if (!pref.site) continue;
      // Upsert pe indexul parțial (necitite): grupare cu ultimii 3 actori; un actor repetat nu crește numărul.
      const actor = input.actorId;
      const rows = await db.$queryRaw<{ id: number; inserted: boolean }[]>`
        INSERT INTO notifications ("userId", type, "targetType", "targetId", "groupKey", "actorIds", count, data, "createdAt", "updatedAt")
        VALUES (${userId}, ${input.type}, ${input.targetType}, ${input.targetId}, ${groupKey},
                ${actor ? [actor] : []}::text[], 1, ${data}::jsonb, ${now}::timestamp, ${now}::timestamp)
        ON CONFLICT ("userId", "groupKey") WHERE "readAt" IS NULL DO UPDATE SET
          count = CASE WHEN ${actor}::text IS NOT NULL AND ${actor}::text = ANY(notifications."actorIds") THEN notifications.count ELSE notifications.count + 1 END,
          "actorIds" = CASE WHEN ${actor}::text IS NULL THEN notifications."actorIds"
                            ELSE (ARRAY[${actor}::text] || array_remove(notifications."actorIds", ${actor}::text))[1:3] END,
          data = EXCLUDED.data,
          "updatedAt" = EXCLUDED."updatedAt"
        RETURNING id, (xmax = 0) AS inserted`;
      const row = rows[0];
      if (!row) continue;
      out.push(row.id);
      await bus.emit({
        name: "notification.created",
        payload: { userId, notificationId: row.id, type: input.type, inserted: row.inserted, important: def.important, email: pref.email },
        tags: notifTags(userId),
      });
    }
    return out;
  }

  async list(userId: string, opts: { unreadOnly?: boolean; before?: number; limit?: number } = {}): Promise<GcsNotificationView[]> {
    const rows = await this.deps.db.notification.findMany({
      where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}), ...(opts.before ? { id: { lt: opts.before } } : {}) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: Math.min(opts.limit ?? 20, 100),
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      count: r.count,
      actorIds: r.actorIds,
      data: (r.data ?? {}) as GcsNotificationView["data"],
      read: r.readAt !== null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async unreadCount(userId: string | null): Promise<number> {
    if (!userId) return 0;
    const key = `notif:unread:${userId}`;
    const cached = await this.deps.cache.get<number>(key);
    if (cached !== null) return cached;
    const n = await this.deps.db.notification.count({ where: { userId, readAt: null } });
    await this.deps.cache.set(key, n, { ttlSec: UNREAD_TTL, tags: notifTags(userId) });
    return n;
  }

  /** Marchează citite notificările date (doar ale userului) sau toate. Întoarce numărul nou de necitite. */
  async markRead(userId: string, ids: number[] | "all"): Promise<number> {
    const now = new Date();
    await this.deps.db.notification.updateMany({
      where: { userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
      data: { readAt: now },
    });
    await this.deps.cache.invalidateTags(notifTags(userId));
    const unread = await this.unreadCount(userId);
    await this.deps.bus.emit({ name: "notification.read", payload: { userId, unread }, tags: notifTags(userId) });
    return unread;
  }

  /** Șterge notificările citite mai vechi de 90 de zile (job zilnic). */
  async cleanup(now = new Date()): Promise<number> {
    const { count } = await this.deps.db.notification.deleteMany({
      where: { readAt: { lt: new Date(now.getTime() - READ_RETENTION_DAYS * 86_400_000) } },
    });
    return count;
  }
}
