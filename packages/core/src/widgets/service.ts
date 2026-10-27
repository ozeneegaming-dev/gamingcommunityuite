import { jsonInts, type Prisma, type PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import type { GcsAppService, GcsAppViewer } from "../apps/service";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import {
  extensionFields,
  fieldsListSlots,
  fieldsStyle,
  mergeSlotStyles,
  sanitizeSlotItems,
  sanitizeSlotStyle,
  validateExtensionValues,
  withExtensionDefaults,
  type GcsSlotItem,
  type GcsSlotStyleResult,
  type GcsWidgetEditTab,
  type GcsWidgetExtension,
} from "../modules/forumSlots";
import { GCS_WIDGET_PAGES, GCS_WIDGET_ZONES, type GcsModuleRegistry, type GcsWidgetPage, type GcsWidgetZone } from "../modules/registry";
import { pluginCssScope } from "../plugins/catalog";
import type { GcsActor } from "../permissions/types";

export const WIDGETS_ACP_SECTION = "appearance.widgets";
const CACHE_TAG = "layout";
const CACHE_TTL = 3600;
const MAX_PER_ZONE = 30;

export type GcsWidgetPlacementInput = { zone: GcsWidgetZone; type: string; config?: unknown; groups?: number[] };
export type GcsWidgetPlacementView = { id: number; zone: GcsWidgetZone; position: number; type: string; config: Record<string, unknown>; groups: number[] };
export type GcsPageLayout = Record<GcsWidgetZone, GcsWidgetPlacementView[]>;

/** Cheia din configurarea unei amplasări unde stau valorile extensiilor (Aspect forumuri): `{ "<extensie>": { … } }`. */
export const WIDGET_EXT_KEY = "$ext";

/** Un tab contribuit în pagina de aspect a unui widget, cu extensia lui și valorile salvate. */
export type GcsWidgetTabView = { extension: string; module: string; plugin: string | null; tab: GcsWidgetEditTab; values: Record<string, unknown> };
/** Ce primește banda de titlu a unui widget din extensii: stilul, pastilele și pluginurile (foile lor de stil). */
export type GcsWidgetDecor = { style: GcsSlotStyleResult; title: GcsSlotItem[]; plugins: string[] };
export type GcsWidgetExtOptions = { plugins: boolean };

const isPage = (v: unknown): v is GcsWidgetPage => GCS_WIDGET_PAGES.includes(v as GcsWidgetPage);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Valorile extensiilor din configurarea unei amplasări. */
export function widgetExtValues(config: Record<string, unknown> | null | undefined): Record<string, Record<string, unknown>> {
  const raw = config?.[WIDGET_EXT_KEY];
  if (!isRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, Record<string, unknown>] => isRecord(e[1])));
}
const isZone = (v: unknown): v is GcsWidgetZone => GCS_WIDGET_ZONES.includes(v as GcsWidgetZone);
const emptyLayout = (): GcsPageLayout => ({ top: [], bottom: [], sidebar: [] });

/** Layout-ul implicit al unei pagini, din modulele înregistrate (în ordinea lor); tipurile necunoscute se sar. */
export function defaultWidgetLayout(registry: GcsModuleRegistry, page: GcsWidgetPage): GcsWidgetPlacementInput[] {
  return registry
    .all()
    .flatMap((m) => m.widgetLayout?.[page] ?? [])
    .filter((p) => registry.widgetDef(p.type)?.def.zones.includes(p.zone));
}

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
      .map((r) => ({ id: r.id, zone: r.zone as GcsWidgetZone, position: r.position, type: r.type, config: (r.config ?? {}) as Record<string, unknown>, groups: jsonInts(r.groups) }));
    await this.deps.cache.set(key, list, { ttlSec: CACHE_TTL, tags: [CACHE_TAG] });
    return list;
  }

  /**
   * Layout-ul văzut de viewer: doar widget-urile cunoscute, ale aplicațiilor active (și accesibile lui) și vizibile pentru
   * grupurile lui.
   * Cu `all: true` (modul de editare) se întorc toate, indiferent de grupuri.
   */
  async layout(page: GcsWidgetPage, viewer: GcsAppViewer, opts: { all?: boolean } = {}): Promise<GcsPageLayout> {
    // Aplicațiile oprite lipsesc mereu; cele restricționate pe grup, doar în afara modului de editare.
    const enabled = opts.all ? await this.deps.apps.enabledFilter() : await this.deps.apps.accessFilter(viewer);
    const out = emptyLayout();
    for (const p of await this.stored(page)) {
      const def = this.deps.registry.widgetDef(p.type);
      if (!def || !enabled(def.module)) continue;
      if (!opts.all && p.groups.length > 0 && !p.groups.some((g) => viewer.groupIds.includes(g))) continue;
      out[p.zone].push(p);
    }
    return out;
  }

  /** Catalogul widget-urilor disponibile pe o pagină (aplicațiile dezactivate lipsesc), cu modulul fiecăruia (categoria). */
  async catalog(page: GcsWidgetPage) {
    const enabled = await this.deps.apps.enabledFilter();
    return this.deps.registry
      .widgetDefs()
      .filter((w) => enabled(w.module) && (!w.def.pages || w.def.pages.includes(page)))
      .map((w) => ({
        key: w.def.key,
        module: w.module,
        labelKey: w.def.labelKey,
        descriptionKey: w.def.descriptionKey ?? null,
        icon: w.def.icon,
        zones: [...w.def.zones],
        defaultConfig: w.def.defaultConfig,
      }));
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
      // Aspectul (valorile extensiilor) rămâne la reordonarea din editorul paginii, după ce trece din nou validarea.
      const ext = this.cleanExt(isRecord(p.config) ? p.config : null);
      if (Object.keys(ext).length > 0) (config as Record<string, unknown>)[WIDGET_EXT_KEY] = ext;
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

  /** Valorile extensiilor înregistrate, validate din nou (o extensie necunoscută sau o valoare greșită se pierd). */
  private cleanExt(config: Record<string, unknown> | null): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    const stored = widgetExtValues(config);
    for (const { def } of this.deps.registry.widgetExtensions()) {
      if (!stored[def.key]) continue;
      const result = validateExtensionValues(extensionFields(def), stored[def.key]!);
      if (result.ok) out[def.key] = result.values;
    }
    return out;
  }

  /** Extensiile widget-urilor active: ale modulelor cu aplicația pornită și (fără modul sigur) ale pluginurilor încărcate. */
  async activeExtensions(opts: GcsWidgetExtOptions): Promise<{ module: string; def: GcsWidgetExtension }[]> {
    const all = this.deps.registry.widgetExtensions();
    if (all.length === 0) return [];
    const enabled = await this.deps.apps.enabledFilter();
    return all.filter((e) => (e.def.plugin ? opts.plugins : enabled(e.module)));
  }

  /** O amplasare după id (pagina de aspect a widget-ului), sau `null`. */
  async placement(id: number): Promise<(GcsWidgetPlacementView & { page: GcsWidgetPage }) | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const row = await this.deps.db.widgetPlacement.findUnique({ where: { id } });
    if (!row || !isPage(row.page) || !isZone(row.zone)) return null;
    return { id: row.id, page: row.page, zone: row.zone, position: row.position, type: row.type, config: (row.config ?? {}) as Record<string, unknown>, groups: jsonInts(row.groups) };
  }

  /** Taburile contribuite în pagina de aspect a unui widget, cu valorile salvate (și cele implicite). */
  async editTabs(config: Record<string, unknown>, opts: GcsWidgetExtOptions): Promise<GcsWidgetTabView[]> {
    const stored = widgetExtValues(config);
    return (await this.activeExtensions(opts))
      .flatMap(({ module, def }) => def.tabs.map((tab) => ({ extension: def.key, module, plugin: def.plugin ?? null, tab, values: withExtensionDefaults(extensionFields(def), stored[def.key]) })))
      .sort((a, b) => (a.tab.position ?? 100) - (b.tab.position ?? 100));
  }

  /**
   * Salvează un tab de aspect al unui widget: câmpurile validate, unite cu valorile celorlalte taburi ale extensiei, în
   * configurarea amplasării (fără să schimbe ordinea sau id-ul). Cere dreptul ACP pe widget-uri; intră în jurnal.
   */
  async saveExtension(
    actor: GcsActor,
    input: { placementId: number; extension: string; tab: string; values: Record<string, unknown>; options?: Record<string, readonly string[]> },
    opts: GcsWidgetExtOptions,
  ): Promise<Record<string, unknown>> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, WIDGETS_ACP_SECTION, "edit");
    const placement = await this.placement(input.placementId);
    if (!placement) throw new GcsNotFound();
    const ext = (await this.activeExtensions(opts)).find((e) => e.def.key === input.extension)?.def;
    const tab = ext?.tabs.find((t) => t.key === input.tab);
    if (!ext || !tab) throw new GcsNotFound();
    const result = validateExtensionValues(tab.fields ?? [], input.values, input.options ?? {});
    if (!result.ok) throw new GcsValidationError(result.errors);
    const stored = widgetExtValues(placement.config);
    const merged = { ...withExtensionDefaults(extensionFields(ext), stored[ext.key]), ...result.values };
    const config = { ...placement.config, [WIDGET_EXT_KEY]: { ...stored, [ext.key]: merged } };
    await db.$transaction(async (tx) => {
      await tx.widgetPlacement.update({ where: { id: placement.id }, data: { config: config as Prisma.InputJsonValue } });
      await writeAudit(tx, { actorId: actor.userId, action: "widget.aspect.update", targetType: "widget", targetId: String(placement.id), before: { key: ext.key, data: stored[ext.key] ?? null }, after: { key: ext.key, tab: tab.key, data: merged }, ip: actor.ip });
    });
    await bus.emit({ name: "layout.updated", payload: { page: placement.page }, tags: [CACHE_TAG] });
    return merged;
  }

  /**
   * Stilul și pastilele benzii de titlu a unui widget, din valorile extensiilor active (curățate ca stilul rândurilor de
   * forum). Banda primește și containerul pluginului care a stilizat-o.
   */
  async decor(config: Record<string, unknown>, opts: GcsWidgetExtOptions): Promise<GcsWidgetDecor> {
    const stored = widgetExtValues(config);
    const out: GcsWidgetDecor = { style: { classes: [], vars: {} }, title: [], plugins: [] };
    if (Object.keys(stored).length === 0) return out;
    const styles: GcsSlotStyleResult[] = [];
    for (const { def } of await this.activeExtensions(opts)) {
      if (!stored[def.key]) continue;
      const fields = extensionFields(def);
      const data = withExtensionDefaults(fields, stored[def.key]);
      const scope = def.plugin ? pluginCssScope(def.plugin) : undefined;
      const style = sanitizeSlotStyle(fieldsStyle(fields, data), scope ? { pluginScope: scope } : {});
      if (scope && (style.classes.length > 0 || Object.keys(style.vars).length > 0)) {
        style.classes.push(scope);
        if (!out.plugins.includes(def.plugin!)) out.plugins.push(def.plugin!);
      }
      styles.push(style);
      out.title.push(...sanitizeSlotItems("forum.row.title", fieldsListSlots(fields, data).title ?? []));
    }
    out.style = mergeSlotStyles(styles);
    return out;
  }

  /** Readuce pagina la layout-ul implicit al modulelor (butonul „Restabilește implicit” din editor). */
  async reset(actor: GcsActor, page: unknown): Promise<void> {
    if (!isPage(page)) throw new GcsValidationError({ page: "invalid" });
    await this.save(actor, page, defaultWidgetLayout(this.deps.registry, page));
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
