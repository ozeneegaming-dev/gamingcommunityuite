import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import { appAccessKey, type GcsAppLanding, type GcsAppSection, type GcsModule, type GcsModuleRegistry } from "../modules/registry";
import type { GcsPermissionService } from "../permissions/service";
import type { GcsActor } from "../permissions/types";
import { pluginRegistryKey } from "../plugins/catalog";
import type { GcsSettingDef } from "../settings/registry";
import type { GcsSettingsService } from "../settings/service";

export const APPS_ACP_SECTION = "system.applications";
/** Setările paginii Aplicații (secțiunea `apps`, fără formular generic): aplicația de pornire și ordinea aplicațiilor. */
export const APPS_LANDING_SETTING = "apps.landing";
export const APPS_ORDER_SETTING = "apps.order";
const CACHE_KEY = "apps:enabled";
const CACHE_TAG = "apps";
const CACHE_TTL = 3600;
const ORDER_MAX = 200;
/** Grupurile pe care dialogul de acces nu le atinge: Root Admin are mereu acces, bannul anulează oricum tot. */
const FIXED_GROUPS = new Set(["root_admin", "banned"]);
const PLUGIN_PREFIX = pluginRegistryKey("");

/**
 * Setările aplicațiilor (declarate de modulul nucleului): pornirea (`""` = aplicația „acasă”, Forumul) și ordinea. Nu au
 * formular generic: se schimbă din ACP → Sistem → Aplicații.
 */
export const APP_SETTING_DEFS: GcsSettingDef[] = [
  {
    key: APPS_LANDING_SETTING,
    type: "string",
    default: "",
    section: "apps",
    labelKey: "settings.apps.landing",
    validate: (v) => (typeof v === "string" && /^[a-z0-9_.]{0,100}$/.test(v) ? null : "invalid"),
  },
  {
    key: APPS_ORDER_SETTING,
    type: "json",
    default: [],
    section: "apps",
    labelKey: "settings.apps.order",
    validate: (v) => (Array.isArray(v) && v.length <= ORDER_MAX && v.every((k) => typeof k === "string" && k.length <= 100) ? null : "invalid"),
  },
];

export type GcsAppView = { key: string; labelKey: string; icon: string; enabled: boolean };

/** O aplicație din catalog (ACP → Aplicații), fără pluginuri: starea, accesul, secțiunile și pornirea. */
export type GcsAppInfo = {
  key: string;
  labelKey: string;
  icon: string;
  descriptionKey: string | null;
  locked: boolean;
  optional: boolean;
  enabled: boolean;
  /** Permisiunea de acces pe grup (`<app>.app_access`), `null` pentru aplicațiile blocate. */
  access: string | null;
  sections: GcsAppSection[];
  landing: GcsAppLanding | null;
  /** Aplicațiile de care depinde (oprită una, aceasta nu e activă). */
  requires: string[];
  premium: boolean;
};

/** Cine vede: actorul complet sau doar grupurile lui (meniul, widget-urile). */
export type GcsAppViewer = Pick<GcsActor, "groupIds"> & Partial<Pick<GcsActor, "userId" | "isBanned" | "primaryGroupId" | "ip">>;

const asActor = (v: GcsAppViewer): GcsActor => ({
  userId: v.userId ?? null,
  groupIds: v.groupIds,
  primaryGroupId: v.primaryGroupId ?? v.groupIds[0] ?? 0,
  isBanned: v.isBanned ?? false,
  ip: v.ip ?? "",
});

/**
 * Aplicațiile (specul etapei 5 și specul 2026-10-09-acp-navigatie-aplicatii §2):
 * - **pornite / oprite:** modulele `app.optional` se pot opri din ACP; o aplicație oprită nu apare în meniu, widget-uri
 *   sau statistici, iar paginile ei răspund cu 404; celelalte module sunt mereu active;
 * - **accesul pe grup:** permisiunea generată `<app>.app_access` (implicit pentru orice grup); o aplicație e
 *   „restricționată” când măcar un grup nu o are, și doar atunci se verifică actorul (proxy, meniu, widget-uri);
 * - **pornirea:** aplicația a cărei pagină se vede pe `/` (setarea `apps.landing`; implicit aplicația `home`, Forumul);
 * - **ordinea:** lista din ACP și itemii aplicațiilor din meniul principal (setarea `apps.order`);
 * - **licența:** aplicațiile premium se opresc când platforma-mamă declară licența invalidă de peste 30 de zile
 *   (`premiumBlocked`, vezi `GcsLicenseOnline`).
 */
export class GcsAppService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      bus: GcsEventBus;
      registry: GcsModuleRegistry;
      acp: GcsAcpRoleService;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      /** Licența declarată invalidă de platforma-mamă de peste 30 de zile: aplicațiile premium sunt oprite. */
      premiumBlocked?: () => Promise<boolean>;
    },
  ) {}

  private async disabled(): Promise<Set<string>> {
    const cached = await this.deps.cache.get<string[]>(CACHE_KEY);
    if (cached) return new Set(cached);
    const rows = await this.deps.db.app.findMany({ where: { enabled: false }, select: { key: true } });
    const keys = rows.map((r) => r.key);
    await this.deps.cache.set(CACHE_KEY, keys, { ttlSec: CACHE_TTL, tags: [CACHE_TAG] });
    return new Set(keys);
  }

  /**
   * O cheie de modul e activă dacă nu e o aplicație opțională dezactivată și toate aplicațiile de care depinde
   * (`app.requires`) sunt active (un modul necunoscut e inactiv).
   */
  async enabled(key: string): Promise<boolean> {
    return (await this.enabledFilter())(key);
  }

  /** Funcția de filtrare pentru mai multe chei (o singură citire). */
  async enabledFilter(): Promise<(key: string) => boolean> {
    const [off, premiumBlocked] = await Promise.all([this.disabled(), this.deps.premiumBlocked?.() ?? Promise.resolve(false)]);
    const registry = this.deps.registry;
    const active = (key: string, seen: Set<string>): boolean => {
      const m = registry.module(key);
      if (!m || seen.has(key)) return false;
      if (m.app?.optional && off.has(key)) return false;
      if (premiumBlocked && m.app?.premium) return false;
      seen.add(key);
      return (m.app?.requires ?? []).every((dep) => active(dep, seen));
    };
    return (key) => active(key, new Set());
  }

  async list(): Promise<GcsAppView[]> {
    const off = await this.disabled();
    return this.deps.registry
      .all()
      .filter((m) => m.app?.optional)
      .map((m) => ({ key: m.key, labelKey: m.app!.labelKey, icon: m.app!.icon, enabled: !off.has(m.key) }));
  }

  async setEnabled(actor: GcsActor, key: string, enabled: boolean): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, APPS_ACP_SECTION, "edit");
    const m = this.deps.registry.module(key);
    if (!m?.app?.optional) throw new GcsNotFound();
    // Pornirea cere dependențele pornite (ex. Chat Pro → Chat); oprirea unei dependențe oprește singură aplicația.
    if (enabled) {
      const missing = (m.app.requires ?? []).filter((dep) => !this.deps.registry.module(dep));
      const filter = await this.enabledFilter();
      const off = (m.app.requires ?? []).filter((dep) => !filter(dep));
      if (missing.length > 0 || off.length > 0) throw new GcsValidationError({ app: "requires" }, { requires: [...missing, ...off].join(",") });
    }
    await db.$transaction(async (tx) => {
      await tx.app.upsert({ where: { key }, create: { key, enabled }, update: { enabled } });
      await writeAudit(tx, { actorId: actor.userId, action: "app.toggle", targetType: "app", targetId: key, after: { enabled }, ip: actor.ip });
    });
    // Meniul, layout-urile și statisticile depind de aplicațiile active.
    await bus.emit({ name: "app.toggled", payload: { key, enabled }, tags: [CACHE_TAG, "nav", "layout", "stats"] });
  }

  // ─── Catalogul și ordinea ─────────────────────────────────────────────────

  /** Modulele-aplicații (cu `app`), fără pluginuri, în ordinea înregistrării. */
  private appModules(): GcsModule[] {
    return this.deps.registry.all().filter((m) => m.app && !m.key.startsWith(PLUGIN_PREFIX));
  }

  /** Ordinea salvată (cheile modulelor, inclusiv `plugin.<cheie>`); poate conține aplicații care acum lipsesc. */
  async order(): Promise<string[]> {
    const raw = await this.deps.settings.get<unknown>(APPS_ORDER_SETTING);
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
  }

  /** Sortează după ordinea salvată; cele care nu sunt în ea rămân după, în ordinea lor. */
  static sortByOrder<T>(items: readonly T[], key: (item: T) => string, order: readonly string[]): T[] {
    const rank = (item: T) => {
      const at = order.indexOf(key(item));
      return at === -1 ? order.length : at;
    };
    return [...items].sort((a, b) => rank(a) - rank(b));
  }

  /** Ordinea aplicațiilor în meniul principal: itemii de pe primul nivel legați de o aplicație. */
  private async navOrder(): Promise<string[]> {
    const rows = await this.deps.db.navItem.findMany({ where: { parentId: null, appKey: { not: null } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { appKey: true } });
    return [...new Set(rows.map((r) => r.appKey!))];
  }

  /**
   * Aplicațiile (fără pluginuri), în ordinea salvată, cu starea, accesul, secțiunile și pornirea. Fără ordine salvată,
   * urmează ordinea din meniul principal: prima reordonare din ACP mută atunci doar aplicația mutată, și în meniu.
   */
  async catalog(): Promise<GcsAppInfo[]> {
    const [off, saved] = await Promise.all([this.disabled(), this.order()]);
    // Implicit: aplicațiile de bază (blocate) întâi, apoi cele din meniul principal, în ordinea lor de acolo.
    const order = saved.length > 0 ? saved : [...this.appModules().filter((m) => m.app!.locked).map((m) => m.key), ...(await this.navOrder())];
    const list = this.appModules().map((m): GcsAppInfo => {
      const app = m.app!;
      return {
        key: m.key,
        labelKey: app.labelKey,
        icon: app.icon,
        descriptionKey: app.descriptionKey ?? null,
        locked: app.locked === true,
        optional: app.optional,
        enabled: !app.optional || !off.has(m.key),
        access: app.locked ? null : appAccessKey(m.key),
        sections: app.sections ?? [],
        landing: app.landing ?? null,
        requires: app.requires ?? [],
        premium: app.premium === true,
      };
    });
    return GcsAppService.sortByOrder(list, (a) => a.key, order);
  }

  /** Salvează ordinea aplicațiilor (cheile modulelor, fără dubluri). */
  async setOrder(actor: GcsActor, keys: unknown): Promise<string[]> {
    await this.deps.acp.assert(actor, APPS_ACP_SECTION, "edit");
    if (!Array.isArray(keys) || keys.length > ORDER_MAX || !keys.every((k) => typeof k === "string" && /^[a-z0-9_.-]{1,100}$/.test(k))) {
      throw new GcsValidationError({ order: "invalid" });
    }
    const order = [...new Set(keys as string[])];
    await this.deps.settings.set(APPS_ORDER_SETTING, order, actor);
    return order;
  }

  // ─── Accesul pe grup ──────────────────────────────────────────────────────

  /** Permisiunile editabile din dialogul de acces: accesul fiecărei aplicații și permisiunile booleene ale secțiunilor. */
  private editablePermissions(): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of this.deps.registry.all()) {
      if (!m.app) continue;
      // O aplicație blocată nu are acces pe grup, dar secțiunile ei își pot avea permisiunile.
      if (!m.app.locked) out.set(appAccessKey(m.key), m.key);
      for (const s of m.app.sections ?? []) {
        const def = s.permission ? this.deps.registry.permissionDef(s.permission) : undefined;
        if (def?.scope === "group" && isBooleanPermission(def)) out.set(def.key, m.key);
      }
    }
    return out;
  }

  /** Valoarea efectivă a unei permisiuni de grup pentru fiecare grup (rândul salvat, valoarea implicită, `fallback`). */
  private async groupValues(keys: string[]): Promise<{ groups: { id: number; key: string }[]; value: (groupId: number, key: string) => boolean }> {
    const { db, registry } = this.deps;
    const [groups, rows] = await Promise.all([
      db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, key: true } }),
      keys.length > 0 ? db.groupSetting.findMany({ where: { key: { in: keys } }, select: { groupId: true, key: true, value: true } }) : Promise.resolve([]),
    ]);
    const stored = new Map(rows.map((r) => [`${r.groupId}:${r.key}`, r.value as unknown]));
    const byId = new Map(groups.map((g) => [g.id, g.key]));
    return {
      groups,
      value: (groupId, key) => {
        const def = registry.permissionDef(key);
        const k = `${groupId}:${key}`;
        const v = stored.has(k) ? stored.get(k) : (def?.default[byId.get(groupId) ?? ""] ?? def?.fallback);
        return v === true;
      },
    };
  }

  /**
   * Aplicațiile restricționate: măcar un grup (în afară de Root Admin și Banat) nu le poate accesa. Doar pentru ele se
   * verifică actorul; cache pe versiunea permisiunilor (orice schimbare de permisiuni o crește).
   */
  async restrictedApps(): Promise<Set<string>> {
    const { cache, permissions, registry } = this.deps;
    const cacheKey = `apps:restricted:${await permissions.currentVersion()}:${registry.permissionsFingerprint()}`;
    const cached = await cache.get<string[]>(cacheKey);
    if (cached) return new Set(cached);
    const apps = registry.all().filter((m) => m.app && !m.app.locked);
    const keys = apps.map((m) => appAccessKey(m.key));
    const { groups, value } = await this.groupValues(keys);
    const restricted = apps.filter((m) => groups.some((g) => !FIXED_GROUPS.has(g.key) && !value(g.id, appAccessKey(m.key)))).map((m) => m.key);
    await cache.set(cacheKey, restricted, { ttlSec: CACHE_TTL, tags: [CACHE_TAG, "permissions"] });
    return new Set(restricted);
  }

  /** Viewer-ul poate folosi aplicația: e pornită și, dacă e restricționată, are permisiunea de acces. */
  async canAccess(viewer: GcsAppViewer, key: string): Promise<boolean> {
    if (!(await this.enabled(key))) return false;
    const m = this.deps.registry.module(key);
    if (!m?.app || m.app.locked) return true;
    if (!(await this.restrictedApps()).has(key)) return true;
    return this.deps.permissions.can(asActor(viewer), appAccessKey(key));
  }

  /** Filtrul pentru mai multe aplicații (meniul principal, widget-urile): pornite și accesibile viewer-ului. */
  async accessFilter(viewer: GcsAppViewer): Promise<(key: string) => boolean> {
    const [enabled, restricted] = await Promise.all([this.enabledFilter(), this.restrictedApps()]);
    const denied = new Set<string>();
    for (const key of restricted) {
      if (!(await this.deps.permissions.can(asActor(viewer), appAccessKey(key)))) denied.add(key);
    }
    return (key) => enabled(key) && !denied.has(key);
  }

  /** Aplicația căreia îi aparține o cale (prefixele din `app.routes`), sau `null`. */
  routeApp(pathname: string): string | null {
    let best: { key: string; length: number } | null = null;
    for (const m of this.deps.registry.all()) {
      for (const prefix of m.app?.routes ?? []) {
        const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
        if (matches && (!best || prefix.length > best.length)) best = { key: m.key, length: prefix.length };
      }
    }
    return best?.key ?? null;
  }

  /** Grupurile care au o permisiune editabilă (dialogul de acces); Root Admin e mereu inclus. */
  async accessGroups(permission: string): Promise<number[]> {
    const { groups, value } = await this.groupValues([permission]);
    return groups.filter((g) => g.key === "root_admin" || (g.key !== "banned" && value(g.id, permission))).map((g) => g.id);
  }

  /**
   * Accesul pe grup la o aplicație (sau la o secțiune a ei): grupurile din listă primesc permisiunea, celelalte o pierd.
   * Root Admin și Banat nu se ating. Totul într-o tranzacție, cu jurnal; apoi versiunea permisiunilor crește.
   */
  async setAccess(actor: GcsActor, permission: string, allowedGroupIds: unknown): Promise<void> {
    const { db, acp, bus, permissions } = this.deps;
    await acp.assert(actor, APPS_ACP_SECTION, "edit");
    if (!this.editablePermissions().has(permission)) throw new GcsValidationError({ permission: "invalid" });
    const groups = await db.group.findMany({ select: { id: true, key: true } });
    const ids = new Set(groups.map((g) => g.id));
    if (!Array.isArray(allowedGroupIds) || !allowedGroupIds.every((id) => Number.isInteger(id) && ids.has(id as number))) {
      throw new GcsValidationError({ groups: "invalid" });
    }
    const allow = new Set(allowedGroupIds as number[]);
    const before = await this.accessGroups(permission);
    await db.$transaction(async (tx) => {
      for (const g of groups) {
        if (FIXED_GROUPS.has(g.key)) continue;
        const value = allow.has(g.id) as Prisma.InputJsonValue;
        await tx.groupSetting.upsert({ where: { groupId_key: { groupId: g.id, key: permission } }, create: { groupId: g.id, key: permission, value }, update: { value } });
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "app.access",
        targetType: "permission",
        targetId: permission,
        before: { groups: before },
        after: { groups: [...allow].sort((a, b) => a - b) },
        ip: actor.ip,
      });
    });
    await permissions.bumpVersion();
    await bus.emit({ name: "app.access", payload: { permission }, tags: [CACHE_TAG, "nav", "layout"] });
  }

  // ─── Pornirea ─────────────────────────────────────────────────────────────

  /** Aplicația „acasă”: cea care randează chiar `/` (`landing.home`, Forumul). */
  private homeKey(): string | null {
    return this.deps.registry.all().find((m) => m.app?.landing?.home)?.key ?? null;
  }

  /** Aplicația de pornire aleasă (o cheie validă: un modul cu pagină de pornire), altfel aplicația „acasă”. */
  async landingKey(): Promise<string> {
    const key = await this.deps.settings.get<unknown>(APPS_LANDING_SETTING).catch(() => null);
    if (typeof key === "string" && this.deps.registry.module(key)?.app?.landing) return key;
    return this.homeKey() ?? (typeof key === "string" ? key : "");
  }

  async setLanding(actor: GcsActor, key: string): Promise<void> {
    await this.deps.acp.assert(actor, APPS_ACP_SECTION, "edit");
    if (typeof key !== "string" || !this.deps.registry.module(key)?.app?.landing) throw new GcsValidationError({ landing: "invalid" });
    await this.deps.settings.set(APPS_LANDING_SETTING, key, actor);
  }

  /**
   * Pagina de pornire efectivă (ce se vede pe `/`): aplicația aleasă, dacă e pornită și (cu un viewer) accesibilă lui;
   * `null` = aplicația „acasă” (`/` randează Forumul, fără rescriere). Fără viewer: doar starea aplicației contează.
   */
  async landingFor(viewer: GcsAppViewer | null): Promise<{ key: string; href: string } | null> {
    const key = await this.landingKey();
    const landing = this.deps.registry.module(key)?.app?.landing;
    if (!landing || landing.home) return null;
    if (!(await this.enabled(key))) return null;
    if (viewer && !(await this.canAccess(viewer, key))) return null;
    return { key, href: landing.href };
  }
}

/** O permisiune booleană: valorile ei implicite (și `fallback`) sunt booleene. */
function isBooleanPermission(def: { default: Partial<Record<string, unknown>>; fallback?: unknown }): boolean {
  return [...Object.values(def.default), ...(def.fallback === undefined ? [] : [def.fallback])].every((v) => v === undefined || typeof v === "boolean");
}
