import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import type { GcsAppService } from "../apps/service";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsModuleRegistry, GcsNavDefault, GcsNavDefaultChild } from "../modules/registry";
import type { GcsActor } from "../permissions/types";

export const MENUS_ACP_SECTION = "system.menu_manager";
const CACHE_KEY = "nav:items";
const CACHE_TAG = "nav";
const CACHE_TTL = 3600;
const MAX_ITEMS = 60;
const MAX_DEPTH = 2;
const LABEL_LOCALES = ["ro", "en", "de", "es", "fr", "ru"];

/**
 * Versiunile meniului implicit, în ordine (marcajele din `system_state.seedMarks`): `nav:v2` (Activitate, Clasament,
 * VIP, Reguli, submeniul Membri), `nav:v3` (Servere), `nav:v4` (Clanuri). O instalare nouă le primește pe toate; una existentă își
 * actualizează meniul o dată pentru fiecare marcaj lipsă (`GcsNavService.upgradeDefaults`).
 */
export const NAV_MARKS: readonly string[] = ["nav:v2", "nav:v3", "nav:v4", "nav:v5"];

/** Eticheta unui item: cheie de traducere (itemii impliciți) sau text pe limbi (itemii adăugați de admin). */
export type GcsNavLabel = { key: string } | Partial<Record<string, string>>;
export type GcsNavItemInput = { label: GcsNavLabel; icon?: string | null; href?: string | null; appKey?: string | null; groups?: number[]; newTab?: boolean; enabled?: boolean; children?: GcsNavItemInput[] };
export type GcsNavItemView = { id: number; label: { key: string } | { text: string }; icon: string | null; href: string; newTab: boolean; children: GcsNavItemView[] };
export type GcsNavItemEdit = Omit<GcsNavItemInput, "children" | "label"> & { id: number; label: GcsNavLabel; children: GcsNavItemEdit[] };

type Row = { id: number; parentId: number | null; position: number; label: Prisma.JsonValue; icon: string | null; href: string | null; appKey: string | null; groups: number[]; newTab: boolean; enabled: boolean };

/** Linkurile permise: căi interne (`/…`, fără `//`) sau adrese http(s). */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length === 0 || href.length > 500) return false;
  if (href.startsWith("/")) return !href.startsWith("//") && !href.includes("\\");
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Meniul principal (specul etapei 5): un arbore pe două niveluri, cu iconițe, vizibilitate pe grup, linkuri externe și
 * itemi legați de o aplicație (ascunși când aplicația e dezactivată). `isIcon` validează iconițele (din `@gcs/ui/icons`).
 */
export class GcsNavService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      bus: GcsEventBus;
      registry: GcsModuleRegistry;
      acp: GcsAcpRoleService;
      apps: GcsAppService;
      isIcon: (name: string) => boolean;
    },
  ) {}

  private async rows(): Promise<Row[]> {
    const cached = await this.deps.cache.get<Row[]>(CACHE_KEY);
    if (cached) return cached;
    const rows = await this.deps.db.navItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    await this.deps.cache.set(CACHE_KEY, rows, { ttlSec: CACHE_TTL, tags: [CACHE_TAG] });
    return rows;
  }

  private static label(raw: Prisma.JsonValue, locale: string, fallback: string): GcsNavItemView["label"] | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.key === "string") return { key: obj.key };
    const text = [obj[locale], obj[fallback], ...Object.values(obj)].find((v): v is string => typeof v === "string" && v.trim() !== "");
    return text ? { text } : null;
  }

  /** Meniul văzut de viewer, în limba lui (textele fără traducere cad pe limba site-ului, apoi pe oricare). */
  async tree(viewer: { groupIds: number[] }, locale: string, siteLocale = "ro"): Promise<GcsNavItemView[]> {
    const enabled = await this.deps.apps.enabledFilter();
    const rows = (await this.rows()).filter(
      (r) => r.enabled && (!r.appKey || enabled(r.appKey)) && (r.groups.length === 0 || r.groups.some((g) => viewer.groupIds.includes(g))),
    );
    const build = (parentId: number | null): GcsNavItemView[] =>
      rows
        .filter((r) => r.parentId === parentId)
        .flatMap((r) => {
          const label = GcsNavService.label(r.label, locale, siteLocale);
          if (!label) return [];
          return [{ id: r.id, label, icon: r.icon, href: r.href ?? "#", newTab: r.newTab, children: parentId === null ? build(r.id) : [] }];
        });
    return build(null);
  }

  /** Arborele complet, pentru editor (cu itemii ascunși și dezactivați). */
  async editable(): Promise<GcsNavItemEdit[]> {
    const rows = await this.rows();
    const build = (parentId: number | null): GcsNavItemEdit[] =>
      rows
        .filter((r) => r.parentId === parentId)
        .map((r) => ({
          id: r.id,
          label: (r.label ?? {}) as GcsNavLabel,
          icon: r.icon,
          href: r.href,
          appKey: r.appKey,
          groups: r.groups,
          newTab: r.newTab,
          enabled: r.enabled,
          children: build(r.id),
        }));
    return build(null);
  }

  private validate(items: GcsNavItemInput[], groupIds: Set<number>, depth = 1, path = "items"): number {
    if (!Array.isArray(items)) throw new GcsValidationError({ [path]: "invalid" });
    let count = 0;
    items.forEach((it, i) => {
      const at = `${path}.${i}`;
      const label = it?.label as Record<string, unknown> | undefined;
      if (!label || typeof label !== "object") throw new GcsValidationError({ [`${at}.label`]: "required" });
      if ("key" in label) {
        if (typeof label.key !== "string" || !/^[a-zA-Z0-9_.]{1,80}$/.test(label.key)) throw new GcsValidationError({ [`${at}.label`]: "invalid" });
      } else {
        const texts = Object.entries(label);
        if (texts.length === 0 || !texts.every(([l, t]) => LABEL_LOCALES.includes(l) && typeof t === "string" && t.trim().length > 0 && t.length <= 40)) {
          throw new GcsValidationError({ [`${at}.label`]: "invalid" });
        }
      }
      if (it.icon != null && !this.deps.isIcon(it.icon)) throw new GcsValidationError({ [`${at}.icon`]: "invalid" });
      const children = it.children ?? [];
      if (children.length === 0 && !isSafeHref(it.href)) throw new GcsValidationError({ [`${at}.href`]: "invalid" });
      if (it.href != null && !isSafeHref(it.href)) throw new GcsValidationError({ [`${at}.href`]: "invalid" });
      if (it.appKey != null && !this.deps.registry.module(it.appKey)) throw new GcsValidationError({ [`${at}.appKey`]: "invalid" });
      if (!(it.groups ?? []).every((g) => groupIds.has(g))) throw new GcsValidationError({ [`${at}.groups`]: "invalid" });
      if (children.length > 0 && depth >= MAX_DEPTH) throw new GcsValidationError({ [`${at}.children`]: "too_deep" });
      count += 1 + this.validate(children, groupIds, depth + 1, `${at}.children`);
    });
    return count;
  }

  /** Înlocuiește meniul (ordinea din liste = ordinea afișată). */
  async save(actor: GcsActor, items: GcsNavItemInput[]): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, MENUS_ACP_SECTION, "edit");
    const groupIds = new Set((await db.group.findMany({ select: { id: true } })).map((g) => g.id));
    if (this.validate(items, groupIds) > MAX_ITEMS) throw new GcsValidationError({ items: "too_many" });
    const before = await this.editable();
    await db.$transaction(async (tx) => {
      await tx.navItem.deleteMany({});
      const create = async (list: GcsNavItemInput[], parentId: number | null) => {
        for (const [position, it] of list.entries()) {
          const row = await tx.navItem.create({
            data: {
              parentId,
              position,
              label: it.label as Prisma.InputJsonValue,
              icon: it.icon ?? null,
              href: it.href ?? null,
              appKey: it.appKey ?? null,
              groups: [...new Set(it.groups ?? [])],
              newTab: it.newTab ?? false,
              enabled: it.enabled ?? true,
            },
          });
          await create(it.children ?? [], row.id);
        }
      };
      await create(items, null);
      await writeAudit(tx, { actorId: actor.userId, action: "nav.save", targetType: "settings", targetId: "nav", before, after: items, ip: actor.ip });
    });
    await bus.emit({ name: "nav.updated", payload: {}, tags: [CACHE_TAG] });
  }

  /** Meniul implicit din itemii declarați de module, dacă meniul e gol (seed; idempotent). */
  static async seedDefaults(tx: Prisma.TransactionClient, registry: GcsModuleRegistry): Promise<void> {
    if ((await tx.navItem.count()) > 0) return;
    await createDefaults(tx, navDefaults(registry, "current"), 0, true);
  }

  /**
   * Actualizarea meniului unei instalări existente la meniul implicit curent (o singură dată pe marcaj: `nav:v2`,
   * `nav:v3`…):
   * - meniul nemodificat (identic cu meniul implicit dinaintea marcajului) e înlocuit cu cel nou;
   * - un meniu modificat de admin rămâne cum e; itemii noi de pe primul nivel, cu un link care nu există încă în meniu,
   *   se adaugă la coadă **activi** (decizia proprietarului, 2026-10-08: o aplicație nouă apare singură în meniu; adminul
   *   o poate ascunde din Manager meniu).
   *
   * Meniul dinaintea lui `nav:v2` e cel din `navPrevious`; dinaintea unui marcaj mai nou, e meniul curent fără itemii
   * aduși de el sau de marcajele de după (`since`).
   */
  static async upgradeDefaults(tx: Prisma.TransactionClient, registry: GcsModuleRegistry, mark: string = NAV_MARKS[0]!): Promise<"replaced" | "appended" | "unchanged"> {
    const rows = await tx.navItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    const current = navDefaults(registry, "current");
    const index = Math.max(0, NAV_MARKS.indexOf(mark));
    const previous = index === 0 ? navDefaults(registry, "previous") : current.filter((n) => NAV_MARKS.indexOf(n.since ?? NAV_MARKS[0]!) < index);
    if (matchesDefaults(rows, previous)) {
      await tx.navItem.deleteMany({});
      await createDefaults(tx, current, 0, true);
      return "replaced";
    }
    const hrefs = new Set(rows.map((r) => r.href).filter((h): h is string => h !== null));
    const missing = current.filter((n) => !hrefs.has(n.href));
    if (missing.length === 0) return "unchanged";
    const start = rows.filter((r) => r.parentId === null).reduce((max, r) => Math.max(max, r.position + 1), 0);
    await createDefaults(tx, missing, start, true);
    return "appended";
  }

  /**
   * Marcajul `nav:v5` (o singură dată): pornește itemii impliciți adăugați **dezactivați** de actualizările dinainte
   * (`nav:v2`–`nav:v4`) și completează submeniul implicit al unui item de pe primul nivel care nu are copii (ex. Membri).
   * Se ating doar itemii identici cu cei impliciți (aceeași etichetă-cheie, link și aplicație); itemii proprii ai adminului
   * rămân neschimbați. Un copil implicit al cărui link adminul l-a pus singur pe primul nivel (ex. Staff) nu se mai adaugă.
   */
  static async enableDefaults(tx: Prisma.TransactionClient, registry: GcsModuleRegistry): Promise<{ enabled: number; children: number }> {
    const rows = await tx.navItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    const top = rows.filter((r) => r.parentId === null);
    const topHrefs = new Set(top.map((r) => r.href).filter((h): h is string => h !== null));
    const defaults = navDefaults(registry, "current");
    const defaultHrefs = new Set(defaults.map((d) => d.href));
    let enabled = 0;
    let children = 0;
    for (const d of defaults) {
      const row = top.find((r) => r.href === d.href && labelKeyOf(r.label) === d.labelKey && r.appKey === d.appKey);
      if (!row) continue;
      if (!row.enabled) {
        await tx.navItem.update({ where: { id: row.id }, data: { enabled: true } });
        enabled++;
      }
      const kids = d.children ?? [];
      if (kids.length === 0 || rows.some((r) => r.parentId === row.id)) continue;
      let position = 0;
      for (const c of kids) {
        if (topHrefs.has(c.href) && !defaultHrefs.has(c.href)) continue;
        await tx.navItem.create({ data: { parentId: row.id, position: position++, label: { key: c.labelKey }, icon: c.icon, href: c.href, groups: [] } });
        children++;
      }
    }
    return { enabled, children };
  }
}

type NavDefaultItem = GcsNavDefault & { appKey: string | null };

/** Itemii impliciți (curenți sau anteriori) ai tuturor modulelor, în ordinea pozițiilor. */
function navDefaults(registry: GcsModuleRegistry, which: "current" | "previous"): NavDefaultItem[] {
  return registry
    .all()
    .flatMap((m) => ((which === "previous" ? (m.navPrevious ?? m.nav) : m.nav) ?? []).map((n) => ({ ...n, appKey: m.app?.optional ? m.key : null })))
    .sort((a, b) => a.position - b.position);
}

async function createDefaults(tx: Prisma.TransactionClient, items: NavDefaultItem[], start: number, enabled: boolean): Promise<void> {
  for (const [i, n] of items.entries()) {
    const row = await tx.navItem.create({ data: { position: start + i, label: { key: n.labelKey }, icon: n.icon, href: n.href, appKey: n.appKey, groups: [], enabled } });
    for (const [position, c] of (n.children ?? []).entries()) {
      await tx.navItem.create({ data: { parentId: row.id, position, label: { key: c.labelKey }, icon: c.icon, href: c.href, groups: [] } });
    }
  }
}

/** Cheia etichetei unui item (`{ key }`), sau `null` pentru o etichetă scrisă de admin. */
function labelKeyOf(label: Prisma.JsonValue): string | null {
  return label && typeof label === "object" && !Array.isArray(label) && Object.keys(label).length === 1 && typeof (label as Record<string, unknown>).key === "string"
    ? ((label as Record<string, unknown>).key as string)
    : null;
}

/** `true` dacă rândurile sunt exact meniul implicit dat: aceiași itemi, în aceeași ordine, cu valorile implicite. */
function matchesDefaults(rows: Row[], defaults: NavDefaultItem[]): boolean {
  const same = (r: Row, d: GcsNavDefaultChild, appKey: string | null) => {
    const label = r.label as Record<string, unknown> | null;
    return (
      !!label &&
      Object.keys(label).length === 1 &&
      label.key === d.labelKey &&
      r.icon === d.icon &&
      r.href === d.href &&
      r.appKey === appKey &&
      r.groups.length === 0 &&
      !r.newTab &&
      r.enabled
    );
  };
  const top = rows.filter((r) => r.parentId === null);
  if (top.length !== defaults.length || rows.length !== defaults.reduce((n, d) => n + 1 + (d.children?.length ?? 0), 0)) return false;
  return top.every((r, i) => {
    const d = defaults[i]!;
    const children = rows.filter((c) => c.parentId === r.id);
    const expected = d.children ?? [];
    return same(r, d, d.appKey) && children.length === expected.length && children.every((c, j) => same(c, expected[j]!, null));
  });
}
