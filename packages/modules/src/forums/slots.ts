import {
  applyExtensionDraft,
  extensionFields,
  fieldsListSlots,
  fieldsStyle,
  GcsNotFound,
  GcsValidationError,
  mergeSlotStyles,
  pluginCssScope,
  sanitizeSlotItems,
  sanitizeSlotStyle,
  tabsForType,
  validateExtensionValues,
  withExtensionDefaults,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsAppService,
  type GcsCache,
  type GcsEventBus,
  type GcsForumEditTab,
  type GcsForumExtension,
  type GcsForumListSlots,
  type GcsForumSlot,
  type GcsForumSlotContext,
  type GcsForumSlotNode,
  type GcsModuleRegistry,
  type GcsSlotItem,
  type GcsSlotStyleResult,
} from "@gcs/core";
import type { ForumType, Prisma, PrismaClient } from "@gcs/db";
import { FORUMS_ACP_SECTION } from "./forums";

/**
 * Un nod al forumului, fără datele extensiilor (le adaugă serviciul). `parentType`: tipul părintelui, când părintele nu
 * e în listă (ex. forumul paginii, pentru subforumurile lui); `children`: subforumurile din lista rândului.
 */
export type GcsSlotNodeRef = {
  id: number;
  type: ForumType;
  parentId: number | null;
  name: string;
  slug: string;
  parentType?: ForumType;
  children?: { id: number; type: ForumType; name: string; slug: string }[];
};

/** Ce primește un rând de forum / o categorie din toate extensiile, gata de desenat. */
export type GcsForumSlotBundle = {
  title: GcsSlotItem[];
  meta: GcsSlotItem[];
  header: GcsSlotItem[];
  /** Insignele subforumurilor din lista rândului (`forum.row.sub`), după id-ul subforumului. */
  subs: Record<number, GcsSlotItem[]>;
  style: GcsSlotStyleResult;
  /** Pluginurile care au pus HTML sau stil (pagina le adaugă foile de stil). */
  plugins: string[];
};
export type GcsSlotItems = { items: GcsSlotItem[]; plugins: string[] };

/** Un tab contribuit, pentru formularul ACP: extensia, modulul ei, tabul și valorile salvate (cu cele implicite). */
export type GcsForumTabView = { extension: string; module: string; plugin: string | null; tab: GcsForumEditTab; values: Record<string, unknown> };

export type GcsForumSlotOptions = {
  /** `false` în modul sigur (pluginurile nu rulează). */
  plugins: boolean;
  /** Previzualizarea live din ACP: valorile nesalvate ale unei extensii pe un nod (nimic nu se scrie). */
  draft?: { extension: string; forumId: number; values: Record<string, unknown> };
};

type ActiveExtension = { module: string; def: GcsForumExtension };
type ExtData = Record<string, Record<number, Record<string, unknown>>>;

const DATA_KEY = "forums:ext-data";
const DATA_TTL = 3600;
/** Cât poate dura o extensie de modul pe o pagină (o extensie lentă nu ține pagina). */
const EXTENSION_TIMEOUT_MS = 3000;

const empty = (): GcsForumSlotBundle => ({ title: [], meta: [], header: [], subs: {}, style: { classes: [], vars: {} }, plugins: [] });

async function withTimeout<T>(p: Promise<T>, fallback: T, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.error(`[GCS] extensia de forum ${label}: timeout`);
          resolve(fallback);
        }, EXTENSION_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    console.error(`[GCS] extensia de forum ${label} a eșuat`, error);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Sloturile forumului (Forum v2, specul `2026-10-17-forum-v2-sloturi`): adună contribuțiile extensiilor active
 * (modulele cu aplicația pornită și pluginurile încărcate), le curăță (`sanitizeSlotItems`, `sanitizeSlotStyle`) și
 * salvează valorile taburilor contribuite în formularul ACP al forumului (`forum_extension_data`).
 */
export class GcsForumSlotService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      bus: GcsEventBus;
      registry: GcsModuleRegistry;
      apps: Pick<GcsAppService, "enabledFilter">;
      acp: GcsAcpRoleService;
    },
  ) {}

  /** Extensiile active: ale modulelor cu aplicația pornită și (fără modul sigur) ale pluginurilor încărcate. */
  async active(opts: GcsForumSlotOptions): Promise<ActiveExtension[]> {
    const all = this.deps.registry.forumExtensions();
    if (all.length === 0) return [];
    const enabled = await this.deps.apps.enabledFilter();
    return all.filter((e) => {
      if (e.def.plugin) return opts.plugins;
      const app = this.deps.registry.module(e.module)?.app;
      return !app || app.locked || enabled(e.module);
    });
  }

  /** Valorile salvate ale tuturor extensiilor (extensie → forum → valori), din cache (tag `forums-tree`). */
  async extensionData(): Promise<ExtData> {
    const cached = await this.deps.cache.get<ExtData>(DATA_KEY);
    if (cached) return cached;
    const rows = await this.deps.db.forumExtensionData.findMany({ select: { forumId: true, key: true, data: true } });
    const out: ExtData = {};
    for (const r of rows) (out[r.key] ??= {})[r.forumId] = r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : {};
    await this.deps.cache.set(DATA_KEY, out, { ttlSec: DATA_TTL, tags: ["forums-tree"] });
    return out;
  }

  /**
   * Nodurile pentru o extensie, cu valorile ei: ale nodului, ale părintelui (doar dacă părintele are valori salvate) și
   * ale subforumurilor din lista rândului.
   */
  private nodes(ext: GcsForumExtension, refs: GcsSlotNodeRef[], data: ExtData): GcsForumSlotNode[] {
    const fields = extensionFields(ext);
    const own = data[ext.key] ?? {};
    const types = new Map(refs.map((r) => [r.id, r.type]));
    return refs.map(({ parentType, children, ...r }) => {
      const parent = r.parentId !== null && own[r.parentId] ? { id: r.parentId, type: types.get(r.parentId) ?? parentType ?? "FORUM", data: withExtensionDefaults(fields, own[r.parentId]) } : null;
      return {
        ...r,
        data: withExtensionDefaults(fields, own[r.id]),
        parent,
        ...(children && children.length > 0 ? { children: children.map((c) => ({ ...c, data: withExtensionDefaults(fields, own[c.id]) })) } : {}),
      };
    });
  }

  private ctx(actor: GcsActor, locale: string, surface: GcsForumSlotContext["surface"]): GcsForumSlotContext {
    return { db: this.deps.db, cache: this.deps.cache, actor, locale, surface };
  }

  /**
   * Sloturile listei (indexul forumului și subforumurile unei pagini): pentru fiecare nod, pastilele de lângă titlu,
   * rândul de sub descriere, conținutul benzii categoriei și stilul. Fiecare extensie e apelată o singură dată.
   */
  async list(actor: GcsActor, locale: string, surface: "index" | "forum", refs: GcsSlotNodeRef[], opts: GcsForumSlotOptions): Promise<Map<number, GcsForumSlotBundle>> {
    const out = new Map<number, GcsForumSlotBundle>();
    if (refs.length === 0) return out;
    const active = await this.active(opts);
    if (active.length === 0) return out;
    const data = this.withDraft(await this.extensionData(), active, opts.draft);
    const ctx = this.ctx(actor, locale, surface);

    const contributions = await Promise.all(
      active.map(async ({ def }) => {
        const nodes = this.nodes(def, refs, data);
        const fields = extensionFields(def);
        const dynamic = def.list ? await withTimeout(def.list(ctx, nodes), {} as Record<number, GcsForumListSlots>, def.key) : {};
        return { def, nodes, fields, dynamic };
      }),
    );

    for (const ref of refs) {
      const bundle = empty();
      const styles: GcsSlotStyleResult[] = [];
      for (const { def, nodes, fields, dynamic } of contributions) {
        const node = nodes.find((n) => n.id === ref.id)!;
        const declared = fieldsListSlots(fields, node.data);
        const dyn = dynamic[ref.id] ?? {};
        const allowHtml = Boolean(def.plugin);
        const add = (slot: GcsForumSlot, target: "title" | "meta" | "header", items: GcsSlotItem[] | undefined) => {
          const clean = sanitizeSlotItems(slot, items ?? [], { allowHtml });
          if (clean.length > 0) {
            bundle[target].push(...clean);
            if (def.plugin && clean.some((i) => i.kind === "html") && !bundle.plugins.includes(def.plugin)) bundle.plugins.push(def.plugin);
          }
        };
        add("forum.row.title", "title", [...(declared.title ?? []), ...(dyn.title ?? [])]);
        add("forum.row.meta", "meta", [...(declared.meta ?? []), ...(dyn.meta ?? [])]);
        add("category.header", "header", [...(declared.header ?? []), ...(dyn.header ?? [])]);
        // Insignele subforumurilor: doar pentru subforumurile din lista acestui rând.
        for (const child of ref.children ?? []) {
          const clean = sanitizeSlotItems("forum.row.sub", dyn.subs?.[child.id] ?? [], { allowHtml });
          if (clean.length === 0) continue;
          (bundle.subs[child.id] ??= []).push(...clean);
          if (def.plugin && clean.some((i) => i.kind === "html") && !bundle.plugins.includes(def.plugin)) bundle.plugins.push(def.plugin);
        }

        const scope = def.plugin ? pluginCssScope(def.plugin) : undefined;
        let custom: unknown = null;
        try {
          custom = def.style?.(node) ?? null;
        } catch (error) {
          console.error(`[GCS] stilul extensiei de forum ${def.key} a eșuat`, error);
        }
        const style = mergeSlotStyles([
          sanitizeSlotStyle(fieldsStyle(fields, node.data), scope ? { pluginScope: scope } : {}),
          sanitizeSlotStyle(custom, scope ? { pluginScope: scope } : {}),
          sanitizeSlotStyle(dyn.style, scope ? { pluginScope: scope } : {}),
        ]);
        if (scope && (style.classes.length > 0 || Object.keys(style.vars).length > 0)) {
          // CSS-ul pluginului e închis în containerul lui: rândul stilizat de el devine container.
          if (!style.classes.includes(scope)) style.classes.push(scope);
          if (!bundle.plugins.includes(def.plugin!)) bundle.plugins.push(def.plugin!);
        }
        styles.push(style);
      }
      bundle.style = mergeSlotStyles(styles);
      if (bundle.title.length || bundle.meta.length || bundle.header.length || Object.keys(bundle.subs).length || bundle.style.classes.length || Object.keys(bundle.style.vars).length) out.set(ref.id, bundle);
    }
    return out;
  }

  /** Valorile salvate, cu schița previzualizării peste cele ale nodului ei (o copie; cache-ul rămâne neatins). */
  private withDraft(data: ExtData, active: ActiveExtension[], draft: GcsForumSlotOptions["draft"]): ExtData {
    const ext = draft ? active.find((e) => e.def.key === draft.extension)?.def : undefined;
    if (!draft || !ext) return data;
    return { ...data, [ext.key]: { ...(data[ext.key] ?? {}), [draft.forumId]: applyExtensionDraft(extensionFields(ext), data[ext.key]?.[draft.forumId], draft.values) } };
  }

  /** Cardurile de sus ale paginii unui forum (`forum.page.top`). */
  async forumPage(actor: GcsActor, locale: string, ref: GcsSlotNodeRef, opts: GcsForumSlotOptions): Promise<GcsSlotItems> {
    const active = (await this.active(opts)).filter((e) => e.def.forumPage);
    return this.collect(active, ref, "forum.page.top", (def, node) => def.forumPage!(this.ctx(actor, locale, "forum"), node));
  }

  /** Bara de pe pagina unui topic (`topic.bar`). */
  async topicBar(actor: GcsActor, locale: string, ref: GcsSlotNodeRef, topic: { id: number; title: string; authorId: string | null }, opts: GcsForumSlotOptions): Promise<GcsSlotItems> {
    const active = (await this.active(opts)).filter((e) => e.def.topicBar);
    return this.collect(active, ref, "topic.bar", (def, node) => def.topicBar!(this.ctx(actor, locale, "topic"), { node, topic }));
  }

  private async collect(
    active: ActiveExtension[],
    ref: GcsSlotNodeRef,
    slot: GcsForumSlot,
    call: (def: GcsForumExtension, node: GcsForumSlotNode) => Promise<GcsSlotItem[] | null>,
  ): Promise<GcsSlotItems> {
    if (active.length === 0) return { items: [], plugins: [] };
    const data = await this.extensionData();
    const parts = await Promise.all(
      active.map(async ({ def }) => {
        const [node] = this.nodes(def, [ref], data);
        const items = sanitizeSlotItems(slot, (await withTimeout(call(def, node!), null, def.key)) ?? [], { allowHtml: Boolean(def.plugin) });
        return { def, items };
      }),
    );
    const plugins = [...new Set(parts.filter((p) => p.def.plugin && p.items.some((i) => i.kind === "html")).map((p) => p.def.plugin!))];
    return { items: parts.flatMap((p) => p.items), plugins };
  }

  // ─── Formularul ACP ─────────────────────────────────────────────────────────────────────────────────

  /** Taburile contribuite pentru un nod (după tipul lui), în ordinea `position`, cu valorile salvate. */
  async editTabs(forum: { id: number; type: ForumType }, opts: GcsForumSlotOptions): Promise<GcsForumTabView[]> {
    const active = await this.active(opts);
    if (active.length === 0) return [];
    const data = await this.extensionData();
    return active
      .flatMap(({ module, def }) =>
        tabsForType(def, forum.type).map((tab) => ({
          extension: def.key,
          module,
          plugin: def.plugin ?? null,
          tab,
          values: withExtensionDefaults(extensionFields(def), data[def.key]?.[forum.id]),
        })),
      )
      .sort((a, b) => (a.tab.position ?? 100) - (b.tab.position ?? 100));
  }

  /**
   * Salvează câmpurile unui tab contribuit: validate după câmpurile tabului (și `validate` al extensiei, pe toate
   * valorile), unite cu valorile celorlalte taburi ale extensiei. Cere dreptul ACP `community.forums` (editare); intră
   * în jurnal și invalidează lista forumurilor. `options`: valorile permise ale câmpurilor `select` cu `optionsFrom`.
   */
  async saveTab(
    actor: GcsActor,
    input: { forumId: number; extension: string; tab: string; values: Record<string, unknown>; options?: Record<string, readonly string[]> },
    opts: GcsForumSlotOptions,
  ): Promise<Record<string, unknown>> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, FORUMS_ACP_SECTION, "edit");
    const forum = await db.forum.findUnique({ where: { id: input.forumId }, select: { id: true, type: true } });
    if (!forum) throw new GcsNotFound();
    const ext = (await this.active(opts)).find((e) => e.def.key === input.extension)?.def;
    const tab = ext ? tabsForType(ext, forum.type).find((t) => t.key === input.tab) : undefined;
    if (!ext || !tab) throw new GcsNotFound();

    const result = validateExtensionValues(tab.fields ?? [], input.values, input.options ?? {});
    if (!result.ok) throw new GcsValidationError(result.errors);
    const before = await db.forumExtensionData.findUnique({ where: { forumId_key: { forumId: forum.id, key: ext.key } } });
    const previous = before?.data && typeof before.data === "object" && !Array.isArray(before.data) ? (before.data as Record<string, unknown>) : {};
    const merged = { ...withExtensionDefaults(extensionFields(ext), previous), ...result.values };
    const crossErrors = ext.validate?.(merged, forum) ?? null;
    if (crossErrors && Object.keys(crossErrors).length > 0) throw new GcsValidationError(crossErrors);

    await db.$transaction(async (tx) => {
      const data = merged as Prisma.InputJsonObject;
      await tx.forumExtensionData.upsert({
        where: { forumId_key: { forumId: forum.id, key: ext.key } },
        create: { forumId: forum.id, key: ext.key, data, updatedById: actor.userId },
        update: { data, updatedById: actor.userId },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "forum.extension.update", targetType: "forum", targetId: String(forum.id), before: { key: ext.key, data: previous }, after: { key: ext.key, tab: tab.key, data: merged }, ip: actor.ip });
    });
    await bus.emit({ name: "forum.updated", payload: { forumIds: [forum.id], extension: ext.key }, tags: ["forums-tree", `forum:${forum.id}`] });
    return merged;
  }
}
