import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import type { GcsAppService } from "../apps/service";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import { GCS_WIDGET_PAGES, GCS_WIDGET_ZONES, type GcsModuleRegistry, type GcsWidgetPage, type GcsWidgetZone } from "../modules/registry";
import type { GcsActor } from "../permissions/types";

export const WIDGETS_ACP_SECTION = "appearance.widgets";
const CACHE_TAG = "layout";
const CACHE_TTL = 3600;
const MAX_PER_ZONE = 30;

export type GcsWidgetPlacementInput = { zone: GcsWidgetZone; type: string; config?: unknown; groups?: number[] };
export type GcsWidgetPlacementView = { id: number; zone: GcsWidgetZone; position: number; type: string; config: Record<string, unknown>; groups: number[] };
export type GcsPageLayout = Record<GcsWidgetZone, GcsWidgetPlacementView[]>;

const isPage = (v: unknown): v is GcsWidgetPage => GCS_WIDGET_PAGES.includes(v as GcsWidgetPage);
const isZone = (v: unknown): v is GcsWidgetZone => GCS_WIDGET_ZONES.includes(v as GcsWidgetZone);
const emptyLayout = (): GcsPageLayout => ({ top: [], bottom: [], sidebar: [] });

/**
 * Widget-urile paginilor (specul etapei 5): fiecare pagină (`index`, `forum`, `topic`) are trei zone. Adminii le aranjează
 * direct pe site; aici sunt layout-ul (cu vizibilitatea pe grup și aplicațiile dezactivate filtrate) și salvarea.
 */
export class GcsWidgetService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      bus: GcsEventBus;
      registry: GcsModuleRegistry;
      acp: GcsAcpRoleService;
      apps: GcsAppService;
    },
  ) {}

  /** Toate plasările paginii (cache), fără filtre. */
  private async stored(page: GcsWidgetPage): Promise<GcsWidgetPlacementView[]> {
    const key = `layout:${page}`;
    const cached = await this.deps.cache.get<GcsWidgetPlacementView[]>(key);
    if (cached) return cached;
    const rows = await this.deps.db.widgetPlacement.findMany({ where: { page }, orderBy: [{ zone: "asc" }, { position: "asc" }, { id: "asc" }] });
    const list = rows
      .filter((r) => isZone(r.zone))
      .map((r) => ({ id: r.id, zone: r.zone as GcsWidgetZone, position: r.position, type: r.type, config: (r.config ?? {}) as Record<string, unknown>, groups: r.groups }));
    await this.deps.cache.set(key, list, { ttlSec: CACHE_TTL, tags: [CACHE_TAG] });
    return list;
  }

  /**
   * Layout-ul văzut de viewer: doar widget-urile cunoscute, ale aplicațiilor active și vizibile pentru grupurile lui.
   * Cu `all: true` (modul de editare) se întorc toate, indiferent de grupuri.
   */
  async layout(page: GcsWidgetPage, viewer: { groupIds: number[] }, opts: { all?: boolean } = {}): Promise<GcsPageLayout> {
    const enabled = await this.deps.apps.enabledFilter();
    const out = emptyLayout();
    for (const p of await this.stored(page)) {
      const def = this.deps.registry.widgetDef(p.type);
      if (!def || !enabled(def.module)) continue;
      if (!opts.all && p.groups.length > 0 && !p.groups.some((g) => viewer.groupIds.includes(g))) continue;
      out[p.zone].push(p);
    }
    return out;
  }

  /** Catalogul widget-urilor disponibile pe o pagină (aplicațiile dezactivate lipsesc). */
  async catalog(page: GcsWidgetPage) {
    const enabled = await this.deps.apps.enabledFilter();
    return this.deps.registry
      .widgetDefs()
      .filter((w) => enabled(w.module) && (!w.def.pages || w.def.pages.includes(page)))
      .map((w) => ({ key: w.def.key, labelKey: w.def.labelKey, icon: w.def.icon, zones: [...w.def.zones], defaultConfig: w.def.defaultConfig }));
  }

  /** Înlocuiește layout-ul unei pagini (ordinea din listă = ordinea din zonă). */
  async save(actor: GcsActor, page: unknown, placements: GcsWidgetPlacementInput[]): Promise<void> {
    const { db, acp, bus, registry } = this.deps;
    await acp.assert(actor, WIDGETS_ACP_SECTION, "edit");
    if (!isPage(page)) throw new GcsValidationError({ page: "invalid" });
    if (!Array.isArray(placements)) throw new GcsValidationError({ placements: "invalid" });
    const groupIds = new Set((await db.group.findMany({ select: { id: true } })).map((g) => g.id));
    const counts: Record<string, number> = {};
    const rows: Prisma.WidgetPlacementCreateManyInput[] = [];
    placements.forEach((p, i) => {
      const def = registry.widgetDef(p?.type)?.def;
      if (!def) throw new GcsValidationError({ [`placements.${i}.type`]: "unknown" });
      if (!isZone(p.zone) || !def.zones.includes(p.zone)) throw new GcsValidationError({ [`placements.${i}.zone`]: "invalid" });
      if (def.pages && !def.pages.includes(page)) throw new GcsValidationError({ [`placements.${i}.type`]: "not_on_page" });
      const config = def.config(p.config ?? def.defaultConfig);
      if (!config) throw new GcsValidationError({ [`placements.${i}.config`]: "invalid" });
      const groups = [...new Set(p.groups ?? [])];
      if (!groups.every((g) => Number.isInteger(g) && groupIds.has(g))) throw new GcsValidationError({ [`placements.${i}.groups`]: "invalid" });
      counts[p.zone] = (counts[p.zone] ?? 0) + 1;
      if (counts[p.zone]! > MAX_PER_ZONE) throw new GcsValidationError({ [p.zone]: "too_many" });
      rows.push({ page, zone: p.zone, position: counts[p.zone]! - 1, type: def.key, config: config as Prisma.InputJsonValue, groups });
    });
    const before = await this.stored(page);
    await db.$transaction(async (tx) => {
      await tx.widgetPlacement.deleteMany({ where: { page } });
      if (rows.length > 0) await tx.widgetPlacement.createMany({ data: rows });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "layout.save",
        targetType: "page",
        targetId: page,
        before: before.map(({ zone, type, config, groups }) => ({ zone, type, config, groups })),
        after: rows.map(({ zone, type, config, groups }) => ({ zone, type, config, groups })),
        ip: actor.ip,
      });
    });
    await bus.emit({ name: "layout.updated", payload: { page }, tags: [CACHE_TAG] });
  }

  /** Layout-ul implicit al unei pagini, dacă pagina nu are încă niciun widget (seed; idempotent). */
  static async seedDefaults(tx: Prisma.TransactionClient, defaults: Partial<Record<GcsWidgetPage, GcsWidgetPlacementInput[]>>): Promise<void> {
    for (const [page, list] of Object.entries(defaults) as [GcsWidgetPage, GcsWidgetPlacementInput[]][]) {
      if ((await tx.widgetPlacement.count({ where: { page } })) > 0) continue;
      const counts: Record<string, number> = {};
      await tx.widgetPlacement.createMany({
        data: list.map((p) => {
          counts[p.zone] = (counts[p.zone] ?? 0) + 1;
          return { page, zone: p.zone, position: counts[p.zone]! - 1, type: p.type, config: (p.config ?? {}) as Prisma.InputJsonValue, groups: p.groups ?? [] };
        }),
      });
    }
  }
}
