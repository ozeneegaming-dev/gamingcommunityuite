import { jsonStrings, Prisma, type PrismaClient, retryOnUnique } from "@gcs/db";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsModuleRegistry, GcsNotificationTypeDef } from "../modules/registry";
import type { GcsActor } from "../permissions/types";
import { notificationCatalog, notificationTabs, type GcsNotificationCatalogCategory, type GcsNotificationTab } from "./categories";
import {
  GCS_NOTIFY_CHANNELS,
  cleanDefaults,
  cleanOverride,
  codeChannels,
  deliversNothing,
  effectiveChannels,
  parseOverride,
  resolveDelivery,
  typeDefaults,
  type GcsChannelOverride,
  type GcsDelivery,
  type GcsTypeChannels,
  type GcsTypeDefaults,
} from "./channels";

export const NOTIFICATIONS_ACP_SECTION = "members.notifications";
/** Setările curățeniei (ACP → Notificări): după câte zile pleacă notificările citite și dacă pleacă și cele necitite. */
export const NOTIFICATIONS_PRUNE_DAYS_SETTING = "notifications.prune_days";
export const NOTIFICATIONS_PRUNE_UNREAD_SETTING = "notifications.prune_unread";
export const DEFAULT_PRUNE_DAYS = 90;
/** Statisticile pe zi se păstrează un an. */
const STATS_RETENTION_DAYS = 365;
const UNREAD_TTL = 300;
const DEFAULTS_TTL = 300;
const DEFAULTS_KEY = "notif:defaults";
const DEFAULTS_TAG = "notif:defaults";
const MAX_LIST = 100;

/** Canalele cu statistici (ACP): ce a plecat și ce a fost deschis. */
export const NOTIFY_STAT_CHANNELS = GCS_NOTIFY_CHANNELS;
export type GcsNotifyStatChannel = (typeof NOTIFY_STAT_CHANNELS)[number];

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
  /** O notificare importantă trece și prin canalele „doar important”; lipsă = importanța tipului. */
  important?: boolean;
  /** Emailul îl trimite altcineva (ex. rezumatul săptămânal „Ce ai ratat”): notificarea nu intră în emailuri și digesturi. */
  skipEmail?: boolean;
};

export type GcsNotificationView = {
  id: number;
  type: string;
  count: number;
  actorIds: string[];
  data: { title?: string; href?: string; snippet?: string } & Record<string, unknown>;
  read: boolean;
  important: boolean;
  /** Apare în clopoțel (o notificare doar pentru toast / email / push nu apare). */
  site: boolean;
  updatedAt: string;
  createdAt: string;
};

/** Preferințele unui membru pentru un tip: valorile implicite (cu blocările), ce a ales și rezultatul. */
export type GcsNotificationTypePrefs = { defaults: GcsTypeDefaults; override: GcsChannelOverride; effective: GcsTypeChannels };

/** Ce trimite ACP-ul pentru un tip: canalele și blocările (validate de serviciu). */
export type GcsNotificationDefaultsInput = Record<string, { channels?: unknown; locks?: unknown }>;

/** Filtrul listei: doar necitite / doar citite, înainte de un id (paginare), tipurile unui tab. */
export type GcsNotificationListOptions = { unreadOnly?: boolean; readOnly?: boolean; before?: number; limit?: number; types?: string[] };

/** Statisticile pe canal din ultimele zile (ACP). */
export type GcsNotificationStats = {
  days: number;
  channels: { channel: GcsNotifyStatChannel; sent: number; clicked: number }[];
  types: { type: string; sent: number; clicked: number }[];
};

const notifTags = (userId: string) => [`notifications:${userId}`];
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Notificările (spec principal §10, specul etapei 4, Notificări v2): stocare, grupare, canalele pe tip (cu valorile
 * implicite și blocările din ACP), numărul de necitite, statisticile și curățenia. Modulele le creează din ascultători;
 * livrarea live, emailurile și web push pornesc din evenimentul `notification.created`.
 */
export class GcsNotificationService {
  private readonly targets = new Map<string, GcsNotificationTarget>();

  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      cache: GcsCache;
      registry: GcsModuleRegistry;
      /** Aplicațiile active (categoriile apar și dispar cu aplicația); lipsă = toate modulele. */
      apps?: { enabledFilter(): Promise<(key: string) => boolean> };
      /** Setările (curățenia); lipsă = valorile implicite. */
      settings?: { get<T>(key: string): Promise<T> };
    },
  ) {}

  registerTarget(targetType: string, target: GcsNotificationTarget): void {
    this.targets.set(targetType, target);
  }

  /** Destinatarii (din `userIds`, în aceeași ordine) care pot vedea ținta; un tip de țintă necunoscut → nimeni. */
  async visibleTo(targetType: string, targetId: string, userIds: string[]): Promise<string[]> {
    const target = this.targets.get(targetType);
    if (!target) return [];
    const out: string[] = [];
    for (const id of userIds) if (await target.canView(id, targetId)) out.push(id);
    return out;
  }

  // ─── Catalogul: categoriile și tipurile aplicațiilor active ─────────────────

  /** Categoriile cu tipurile modulelor active (setări, pagina notificărilor, ACP). */
  async catalog(): Promise<GcsNotificationCatalogCategory[]> {
    const active = this.deps.apps ? await this.deps.apps.enabledFilter() : () => true;
    return notificationCatalog(this.deps.registry, active);
  }

  /** Taburile paginii `/notifications` (Toate, Mențiuni, Mesaje, Moderare, aplicațiile). */
  async tabs(): Promise<GcsNotificationTab[]> {
    return notificationTabs(await this.catalog());
  }

  // ─── Valorile implicite (ACP) și preferințele membrilor ────────────────────

  private codeDefaults(def: GcsNotificationTypeDef): GcsTypeChannels {
    return codeChannels(def);
  }

  /** Valorile implicite ale tuturor tipurilor (cele din cod, peste care vin cele salvate în ACP, cu blocările). */
  async defaults(): Promise<Record<string, GcsTypeDefaults>> {
    let saved = await this.deps.cache.get<{ type: string; channels: unknown; locks: unknown }[]>(DEFAULTS_KEY);
    if (!saved) {
      saved = (await this.deps.db.notificationDefault.findMany({ select: { type: true, channels: true, locks: true } })).map((r) => ({ type: r.type, channels: r.channels, locks: r.locks }));
      await this.deps.cache.set(DEFAULTS_KEY, saved, { ttlSec: DEFAULTS_TTL, tags: [DEFAULTS_TAG] });
    }
    const rows = new Map(saved.map((r) => [r.type, r]));
    return Object.fromEntries(this.deps.registry.notificationTypes().map((def) => [def.key, typeDefaults(this.codeDefaults(def), rows.get(def.key))]));
  }

  /** Valorile implicite ale unui tip (`null` = tip necunoscut). */
  async defaultsFor(type: string): Promise<GcsTypeDefaults | null> {
    return (await this.defaults())[type] ?? null;
  }

  /** Preferințele membrului pe fiecare tip cunoscut: valorile implicite, alegerile lui și rezultatul (cu blocările aplicate). */
  async preferences(userId: string): Promise<Record<string, GcsNotificationTypePrefs>> {
    const [defaults, rows] = await Promise.all([this.defaults(), this.deps.db.notificationPreference.findMany({ where: { userId } })]);
    const overrides = new Map(rows.map((r) => [r.type, parseOverride(r.channels)]));
    return Object.fromEntries(
      Object.entries(defaults).map(([type, d]) => {
        const override = overrides.get(type) ?? {};
        return [type, { defaults: d, override, effective: effectiveChannels(d, override) }];
      }),
    );
  }

  /**
   * Salvează alegerile membrului pentru tipurile date (tipurile necunoscute se ignoră). Canalele blocate în ACP și valorile
   * egale cu cele implicite nu se salvează; un tip fără nicio diferență își pierde rândul (urmează valorile implicite).
   */
  async setPreferences(userId: string, prefs: Record<string, unknown>): Promise<void> {
    const defaults = await this.defaults();
    const ops = Object.entries(prefs)
      .filter(([type]) => defaults[type])
      .map(([type, raw]) => {
        const channels = cleanOverride(defaults[type]!, raw);
        return Object.keys(channels).length === 0
          ? this.deps.db.notificationPreference.deleteMany({ where: { userId, type } })
          : this.deps.db.notificationPreference.upsert({ where: { userId_type: { userId, type } }, create: { userId, type, channels }, update: { channels } });
      });
    if (ops.length > 0) await this.deps.db.$transaction(ops);
  }

  /** „Resetează la implicit” (membrul): toate alegerile lui dispar. */
  async resetPreferences(userId: string): Promise<number> {
    return (await this.deps.db.notificationPreference.deleteMany({ where: { userId } })).count;
  }

  /** „Resetează la implicit pentru toți membrii” (ACP): alegerile tuturor dispar. Întoarce câte rânduri s-au șters. */
  async resetAllPreferences(actor: GcsActor): Promise<number> {
    const { count } = await this.deps.db.notificationPreference.deleteMany({});
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "notifications.reset_all", targetType: "settings", targetId: "notifications", after: { removed: count }, ip: actor.ip });
    return count;
  }

  /**
   * Valorile implicite din ACP pentru tipurile date: canalele (lipsă = cele din cod) și blocările („forțat” /
   * „dezactivat”). Un tip necunoscut → eroare de validare.
   */
  async setDefaults(actor: GcsActor, input: GcsNotificationDefaultsInput): Promise<void> {
    const types = new Map(this.deps.registry.notificationTypes().map((t) => [t.key, t]));
    if (Object.keys(input).some((k) => !types.has(k))) throw new GcsValidationError({ type: "unknown" });
    const before = await this.defaults();
    const rows = Object.entries(input).map(([type, raw]) => ({ type, ...cleanDefaults(this.codeDefaults(types.get(type)!), raw) }));
    await this.deps.db.$transaction(
      rows.map((r) => this.deps.db.notificationDefault.upsert({ where: { type: r.type }, create: { type: r.type, channels: r.channels, locks: r.locks }, update: { channels: r.channels, locks: r.locks } })),
    );
    await this.deps.cache.invalidateTags([DEFAULTS_TAG]);
    const changed = Object.fromEntries(rows.map((r) => [r.type, { ...r.channels, locks: r.locks }]));
    const was = Object.fromEntries(rows.map((r) => [r.type, before[r.type]]));
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "notifications.defaults", targetType: "settings", targetId: "notifications", before: was, after: changed, ip: actor.ip });
  }

  /** „Resetează valorile implicite” (ACP): tipurile revin la valorile declarate de module, fără blocări. */
  async resetDefaults(actor: GcsActor): Promise<void> {
    const { count } = await this.deps.db.notificationDefault.deleteMany({});
    await this.deps.cache.invalidateTags([DEFAULTS_TAG]);
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "notifications.defaults_reset", targetType: "settings", targetId: "notifications", after: { removed: count }, ip: actor.ip });
  }

  // ─── „Oprește toate emailurile” (ACP, pentru un membru) ────────────────────

  async emailsOff(userId: string): Promise<boolean> {
    return (await this.deps.db.notificationMember.findUnique({ where: { userId }, select: { emailsOff: true } }))?.emailsOff === true;
  }

  /** Oprește (sau repornește) toate emailurile de notificare ale unui membru, inclusiv canalele forțate și rezumatul. */
  async setEmailsOff(actor: GcsActor, userId: string, off: boolean): Promise<void> {
    const now = new Date();
    const data = { emailsOff: off, emailsOffAt: off ? now : null, emailsOffById: off ? actor.userId : null };
    await this.deps.db.notificationMember.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: off ? "notifications.emails_off" : "notifications.emails_on", targetType: "user", targetId: userId, ip: actor.ip });
  }

  /** Membrii (dintre cei dați) cu toate emailurile oprite. */
  async emailsOffAmong(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.deps.db.notificationMember.findMany({ where: { userId: { in: userIds }, emailsOff: true }, select: { userId: true } });
    return new Set(rows.map((r) => r.userId));
  }

  /**
   * Ce canale primește acum un membru pentru un tip (o notificare importantă sau nu), după preferințele de acum: digesturile
   * le recalculează la trimitere (un email oprit între timp nu mai pleacă).
   */
  async deliveryFor(userId: string, type: string, important: boolean): Promise<GcsDelivery | null> {
    const defaults = await this.defaultsFor(type);
    if (!defaults) return null;
    const [row, off] = await Promise.all([this.deps.db.notificationPreference.findUnique({ where: { userId_type: { userId, type } } }), this.emailsOff(userId)]);
    return resolveDelivery(defaults, row ? parseOverride(row.channels) : null, { important, emailsOff: off });
  }

  // ─── Crearea ───────────────────────────────────────────────────────────────

  /**
   * Creează (sau grupează) notificarea pentru fiecare destinatar care: nu e actorul, nu-l ignoră pe actor, vede ținta și
   * primește tipul pe măcar un canal. Pe site (clopoțelul) se grupează cu necitita de același fel; doar pentru toast /
   * email / push se creează una deja citită, fără grupare. Întoarce id-urile notificărilor create sau actualizate.
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

    const important = input.important ?? def.important;
    const [defaults, prefRows, emailsOff, described] = await Promise.all([
      this.defaultsFor(input.type),
      db.notificationPreference.findMany({ where: { userId: { in: visible }, type: input.type } }),
      this.emailsOffAmong(visible),
      target.describe(input.targetId),
    ]);
    if (!described || !defaults) return [];
    const overrides = new Map(prefRows.map((p) => [p.userId, parseOverride(p.channels)]));
    const groupKey = `${input.type}:${input.targetType}:${input.targetId}`;
    const data = { ...described, ...(input.data ?? {}) } as Prisma.InputJsonObject;
    const now = new Date();
    const out: number[] = [];
    const sent: Record<"site" | "toast", number> = { site: 0, toast: 0 };

    for (const userId of visible) {
      const delivery = resolveDelivery(defaults, overrides.get(userId), { important, emailsOff: emailsOff.has(userId) });
      if (input.skipEmail) delivery.email = null;
      if (deliversNothing(delivery)) continue;
      const channels = { toast: delivery.toast, push: delivery.push, email: delivery.email };
      // Fără email de trimis: marcată ca „trimisă”, deci nu intră în emailul imediat sau în digesturi.
      const emailedAt = delivery.email === null ? now : null;
      const actor = input.actorId;
      let row: { id: number; inserted: boolean } | undefined;
      const fields = { userId, type: input.type, targetType: input.targetType, targetId: input.targetId, groupKey, data, important, channels, emailedAt };
      if (delivery.site) {
        // Grupare pe notificarea necitită a aceluiași `groupKey` (unică prin `unreadKey`, coloana generată), cu ultimii 3
        // actori; un actor repetat nu crește numărul (în afară de tipurile `countEach`, unde fiecare eveniment contează).
        row = await this.upsertUnread(fields, actor ?? null, def.countEach === true, now);
      } else {
        const created = await db.notification.create({ data: { ...fields, actorIds: actor ? [actor] : [], count: 1, site: false, readAt: now, createdAt: now, updatedAt: now }, select: { id: true } });
        row = { id: created.id, inserted: true };
      }
      if (!row) continue;
      out.push(row.id);
      if (delivery.site) sent.site++;
      if (delivery.toast) sent.toast++;
      await bus.emit({
        name: "notification.created",
        payload: {
          userId,
          notificationId: row.id,
          type: input.type,
          inserted: row.inserted,
          important,
          site: delivery.site,
          toast: delivery.toast,
          push: delivery.push,
          emailMode: delivery.email,
          // Forma etapei 4, pentru ascultătorii vechi.
          email: delivery.email === "instant" ? "INSTANT" : delivery.email ? "DIGEST" : "OFF",
        },
        tags: notifTags(userId),
      });
    }
    await this.recordSent(input.type, "site", sent.site);
    await this.recordSent(input.type, "toast", sent.toast);
    return out;
  }

  /**
   * Notificarea necitită a grupului: actualizată dacă există (cu verificare optimistă pe `count`), altfel creată; două
   * creări simultane se ciocnesc pe indexul unic `(userId, unreadKey)` și a doua trece la actualizare.
   */
  private async upsertUnread(
    fields: { userId: string; type: string; targetType: string; targetId: string; groupKey: string; data: Prisma.InputJsonObject; important: boolean; channels: Prisma.InputJsonObject; emailedAt: Date | null },
    actor: string | null,
    countEach: boolean,
    now: Date,
  ): Promise<{ id: number; inserted: boolean } | undefined> {
    const { db } = this.deps;
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = await db.notification.findFirst({ where: { userId: fields.userId, groupKey: fields.groupKey, readAt: null }, select: { id: true, count: true, actorIds: true, important: true } });
      if (existing) {
        const prev = jsonStrings(existing.actorIds);
        const repeated = !countEach && actor !== null && prev.includes(actor);
        const actorIds = actor === null ? prev : [actor, ...prev.filter((a) => a !== actor)].slice(0, 3);
        const updated = await db.notification.updateMany({
          where: { id: existing.id, readAt: null, count: existing.count },
          data: { count: repeated ? existing.count : existing.count + 1, actorIds, data: fields.data, important: existing.important || fields.important, channels: fields.channels, updatedAt: now },
        });
        if (updated.count === 1) return { id: existing.id, inserted: false };
        continue;
      }
      try {
        const created = await db.notification.create({ data: { ...fields, actorIds: actor ? [actor] : [], count: 1, site: true, createdAt: now, updatedAt: now }, select: { id: true } });
        return { id: created.id, inserted: true };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
    return undefined;
  }

  // ─── Citirea ───────────────────────────────────────────────────────────────

  private view(r: {
    id: number;
    type: string;
    count: number;
    actorIds: unknown;
    data: unknown;
    readAt: Date | null;
    important: boolean;
    site: boolean;
    updatedAt: Date;
    createdAt: Date;
  }): GcsNotificationView {
    return {
      id: r.id,
      type: r.type,
      count: r.count,
      actorIds: jsonStrings(r.actorIds),
      data: (r.data ?? {}) as GcsNotificationView["data"],
      read: r.readAt !== null,
      important: r.important,
      site: r.site,
      updatedAt: r.updatedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    };
  }

  /**
   * Notificările din clopoțel ale userului, cele mai noi primele: necitite / citite, înainte de un id (paginare) și
   * `types` (un tab, ex. Mențiuni; panoul chat-ului).
   */
  async list(userId: string, opts: GcsNotificationListOptions = {}): Promise<GcsNotificationView[]> {
    const rows = await this.deps.db.notification.findMany({
      where: {
        userId,
        site: true,
        ...(opts.unreadOnly ? { readAt: null } : opts.readOnly ? { readAt: { not: null } } : {}),
        ...(opts.before ? { id: { lt: opts.before } } : {}),
        ...(opts.types ? { type: { in: opts.types } } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: Math.min(opts.limit ?? 20, MAX_LIST),
    });
    return rows.map((r) => this.view(r));
  }

  /** O notificare a userului după id (și cele doar pentru toast / push), `null` dacă nu e a lui. */
  async get(userId: string, id: number): Promise<GcsNotificationView | null> {
    if (!Number.isSafeInteger(id)) return null;
    const row = await this.deps.db.notification.findFirst({ where: { id, userId } });
    return row ? this.view(row) : null;
  }

  async unreadCount(userId: string | null): Promise<number> {
    if (!userId) return 0;
    const key = `notif:unread:${userId}`;
    const cached = await this.deps.cache.get<number>(key);
    if (cached !== null) return cached;
    const n = await this.deps.db.notification.count({ where: { userId, readAt: null, site: true } });
    await this.deps.cache.set(key, n, { ttlSec: UNREAD_TTL, tags: notifTags(userId) });
    return n;
  }

  /** Necititele pe tab (numărul din dreptul fiecărui tab de pe pagina notificărilor). */
  async unreadByType(userId: string): Promise<Record<string, number>> {
    const rows = await this.deps.db.notification.groupBy({ by: ["type"], where: { userId, readAt: null, site: true }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.type, r._count._all]));
  }

  private async changed(userId: string): Promise<number> {
    await this.deps.cache.invalidateTags(notifTags(userId));
    const unread = await this.unreadCount(userId);
    await this.deps.bus.emit({ name: "notification.read", payload: { userId, unread }, tags: notifTags(userId) });
    return unread;
  }

  /** Marchează citite notificările date (doar ale userului) sau toate (dintr-un tab: `types`). Întoarce numărul nou de necitite. */
  async markRead(userId: string, ids: number[] | "all", opts: { types?: string[] } = {}): Promise<number> {
    await this.deps.db.notification.updateMany({
      where: { userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }), ...(opts.types ? { type: { in: opts.types } } : {}) },
      data: { readAt: new Date() },
    });
    return this.changed(userId);
  }

  /** Marchează din nou necitită o notificare din clopoțel (dacă nu există deja una necitită în același grup). */
  async markUnread(userId: string, id: number): Promise<number> {
    const { db } = this.deps;
    const row = await db.notification.findFirst({ where: { id, userId, site: true, readAt: { not: null } }, select: { groupKey: true } });
    // O necitită din același grup există deja: rămâne citită (indexul unic `(userId, unreadKey)` ar refuza oricum).
    if (row && !(await db.notification.findFirst({ where: { userId, groupKey: row.groupKey, readAt: null }, select: { id: true } }))) {
      await db.notification.updateMany({ where: { id, userId, readAt: { not: null } }, data: { readAt: null } }).catch((error: unknown) => {
        if ((error as { code?: string }).code !== "P2002") throw error;
      });
    }
    return this.changed(userId);
  }

  /** Șterge notificările date ale userului, pe cele citite sau pe toate (dintr-un tab: `types`). Întoarce numărul nou de necitite. */
  async remove(userId: string, which: number[] | "read" | "all", opts: { types?: string[] } = {}): Promise<number> {
    await this.deps.db.notification.deleteMany({
      where: {
        userId,
        ...(Array.isArray(which) ? { id: { in: which } } : which === "read" ? { readAt: { not: null } } : {}),
        ...(opts.types ? { type: { in: opts.types } } : {}),
      },
    });
    return this.changed(userId);
  }

  // ─── Statisticile (ACP) ────────────────────────────────────────────────────

  /** Adaugă `n` trimiteri pe canal (ziua de azi, UTC). */
  async recordSent(type: string, channel: GcsNotifyStatChannel, n = 1, now = new Date()): Promise<void> {
    if (n <= 0) return;
    const day = new Date(`${dayOf(now)}T00:00:00Z`);
    await retryOnUnique(() =>
      this.deps.db.notificationStat.upsert({ where: { day_type_channel: { day, type, channel } }, create: { day, type, channel, sent: n }, update: { sent: { increment: n } } }),
    );
  }

  /**
   * O notificare deschisă (din clopoțel / pagină, toast, email sau push): o singură dată pe notificare, numărată pe
   * canalul de unde a venit click-ul.
   */
  async recordClick(userId: string, id: number, channel: GcsNotifyStatChannel, now = new Date()): Promise<boolean> {
    if (!Number.isSafeInteger(id)) return false;
    const { db } = this.deps;
    const claimed = await db.notification.updateMany({ where: { id, userId, clickedAt: null }, data: { clickedAt: now } });
    if (claimed.count !== 1) return false;
    const row = await db.notification.findUnique({ where: { id }, select: { type: true } });
    if (!row) return false;
    const day = new Date(`${dayOf(now)}T00:00:00Z`);
    await retryOnUnique(() =>
      db.notificationStat.upsert({ where: { day_type_channel: { day, type: row.type, channel } }, create: { day, type: row.type, channel, clicked: 1 }, update: { clicked: { increment: 1 } } }),
    );
    return true;
  }

  /** Trimiterile și deschiderile din ultimele `days` zile: pe canal și pe tip (cele mai trimise primele). */
  async stats(days = 30, now = new Date()): Promise<GcsNotificationStats> {
    const since = new Date(now.getTime() - (days - 1) * 86_400_000);
    const rows = await this.deps.db.notificationStat.findMany({ where: { day: { gte: new Date(`${dayOf(since)}T00:00:00Z`) } } });
    const byChannel = new Map<string, { sent: number; clicked: number }>();
    const byType = new Map<string, { sent: number; clicked: number }>();
    for (const r of rows) {
      const c = byChannel.get(r.channel) ?? { sent: 0, clicked: 0 };
      c.sent += r.sent;
      c.clicked += r.clicked;
      byChannel.set(r.channel, c);
      const t = byType.get(r.type) ?? { sent: 0, clicked: 0 };
      t.sent += r.sent;
      t.clicked += r.clicked;
      byType.set(r.type, t);
    }
    return {
      days,
      channels: NOTIFY_STAT_CHANNELS.map((channel) => ({ channel, ...(byChannel.get(channel) ?? { sent: 0, clicked: 0 }) })),
      types: [...byType.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.sent - a.sent || a.type.localeCompare(b.type)),
    };
  }

  // ─── Curățenia (worker) ────────────────────────────────────────────────────

  private async setting<T>(key: string, fallback: T): Promise<T> {
    if (!this.deps.settings) return fallback;
    try {
      return await this.deps.settings.get<T>(key);
    } catch {
      return fallback;
    }
  }

  /**
   * Șterge notificările citite (și pe cele doar pentru toast / email / push) mai vechi de N zile (setarea
   * `notifications.prune_days`, implicit 90); cu `notifications.prune_unread`, și pe cele necitite. Statisticile pe zi se
   * păstrează un an. Întoarce câte notificări s-au șters.
   */
  async prune(now = new Date()): Promise<number> {
    const raw = await this.setting<number>(NOTIFICATIONS_PRUNE_DAYS_SETTING, DEFAULT_PRUNE_DAYS);
    const days = Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_PRUNE_DAYS;
    const unread = (await this.setting<boolean>(NOTIFICATIONS_PRUNE_UNREAD_SETTING, false)) === true;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const { count } = await this.deps.db.notification.deleteMany({
      where: unread ? { OR: [{ readAt: { lt: cutoff } }, { readAt: null, updatedAt: { lt: cutoff } }] } : { readAt: { lt: cutoff } },
    });
    await this.deps.db.notificationStat.deleteMany({ where: { day: { lt: new Date(now.getTime() - STATS_RETENTION_DAYS * 86_400_000) } } });
    return count;
  }

  /** Numele vechi al curățeniei (jobul zilnic al etapei 4). */
  cleanup(now = new Date()): Promise<number> {
    return this.prune(now);
  }
}
