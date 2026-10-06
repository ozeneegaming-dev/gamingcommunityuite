import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import type { GcsAppService } from "../apps/service";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsModuleRegistry } from "../modules/registry";
import type { GcsActor } from "../permissions/types";

export const MENUS_ACP_SECTION = "system.menu_manager";
const CACHE_KEY = "nav:items";
const CACHE_TAG = "nav";
const CACHE_TTL = 3600;
const MAX_ITEMS = 60;
const MAX_DEPTH = 2;
const LABEL_LOCALES = ["ro", "en", "de", "es", "fr", "ru"];

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
    const items = registry
      .all()
      .flatMap((m) => (m.nav ?? []).map((n) => ({ ...n, appKey: m.app?.optional ? m.key : null })))
      .sort((a, b) => a.position - b.position);
    for (const [position, n] of items.entries()) {
      await tx.navItem.create({ data: { position, label: { key: n.labelKey }, icon: n.icon, href: n.href, appKey: n.appKey, groups: [] } });
    }
  }
}
