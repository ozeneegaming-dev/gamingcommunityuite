import { GcsNotFound, GcsValidationError, writeAudit, type GcsActor, type GcsCache, type GcsEventBus, type GcsSettingsService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { byDisplayPriority, type GcsGroupCount, type GcsGroupDirectory, type GcsGroupRef } from "../profile/groupDirectory";
import { nameKeyOf, nameKeySelect } from "../profile/nameKeys";
import {
  DEFAULT_LEGEND_CATEGORIES,
  defaultLegendCategory,
  LEGEND_CATEGORIES_SETTING,
  LEGEND_CATEGORY_KEY,
  LEGEND_PARENT_KEY,
  validLegendCategories,
  type GcsLegendCategory,
} from "./index";

const ZERO: GcsGroupCount = { members: 0, secondary: 0, online: 0, onlineSecondary: 0 };
/** „Online” pe pagina grupurilor: ca numărătorile directorului (15 minute, statusul vizibil). */
const ONLINE_MS = 15 * 60_000;
/** Câți membri arată un grup deschis pe pagina grupurilor (restul: „Toți membrii grupului →”). */
export const GROUPS_PAGE_MEMBERS = 12;

/** Locul unui grup în legendă: categoria (`""` = nu apare) și grupul sub care apare (dropdown-ul lui), dacă există. */
export type GcsGroupLegendPlace = { category: string; parentId: number | null };

/** Un grup în legenda Pro: datele pastilei, numărătorile și grupurile legate de el (dropdown-ul). */
export type GcsLegendProGroup = Pick<GcsGroupRef, "id" | "key" | "name" | "color" | "icon" | "public" | "description"> & {
  count: GcsGroupCount;
  children: (Pick<GcsGroupRef, "id" | "key" | "name" | "color" | "icon" | "public" | "description"> & { count: GcsGroupCount })[];
  /** Membrii grupurilor legate, adunați (antetul dropdown-ului). */
  childMembers: number;
};

export type GcsLegendProCategory = GcsLegendCategory & { members: number; groups: GcsLegendProGroup[] };

/** Filtrul paginii grupurilor: toți membrii, doar cei cu grupul principal sau doar cei cu grupul secundar. */
export type GcsGroupsScope = "all" | "primary" | "secondary";

export type GcsGroupsPageMember = { id: string; name: string; image: string | null; nameKey: string; online: boolean; secondary: boolean };
export type GcsGroupsPageGroup = Pick<GcsGroupRef, "id" | "key" | "name" | "color" | "icon" | "description"> & {
  /** Numărătorile după filtru: membri, câți ca secundar, câți online. */
  members: number;
  secondary: number;
  online: number;
  /** Numele grupurilor legate (descrierea „include …”). */
  children: string[];
  /** Primii membri (după filtru și căutare), cei activi recent întâi. */
  list: GcsGroupsPageMember[];
  /** Câți membri se potrivesc filtrului și căutării (pentru „N afișați din M”). */
  matched: number;
};
export type GcsGroupsPage = {
  categories: (GcsLegendCategory & { groups: GcsGroupsPageGroup[] })[];
  totals: { groups: number; members: number };
};

/**
 * Grupuri Pro (aplicația premium): categoriile legendei (definite de admin), locul fiecărui grup în legendă, legenda pe
 * categorii cu numărători și pagina `/members/groups`. Datele grupurilor și numărătorile vin din `GcsGroupDirectory`
 * (același cache ca pastilele), deci legenda nu adaugă interogări la fiecare afișare.
 */
export class GcsGroupsProService {
  constructor(
    private readonly deps: { db: PrismaClient; cache: GcsCache; bus: GcsEventBus; settings: GcsSettingsService; groups: GcsGroupDirectory },
  ) {}

  /** Categoriile legendei, în ordine (o valoare stricată din bază → cele implicite). */
  async categories(): Promise<GcsLegendCategory[]> {
    const v = await this.deps.settings.get<unknown>(LEGEND_CATEGORIES_SETTING).catch(() => null);
    return validLegendCategories(v) ? v : DEFAULT_LEGEND_CATEGORIES.map((c) => ({ ...c }));
  }

  /** Locul fiecărui grup în legendă: setarea lui sau, pentru grupurile fără ea (create după instalare), cea implicită. */
  async places(): Promise<Map<number, GcsGroupLegendPlace>> {
    const cached = await this.deps.cache.get<[number, GcsGroupLegendPlace][]>("groups-pro:places");
    if (cached) return new Map(cached);
    const [groups, rows] = await Promise.all([
      this.deps.db.group.findMany({ select: { id: true, key: true, isVip: true } }),
      this.deps.db.groupSetting.findMany({ where: { key: { in: [LEGEND_CATEGORY_KEY, LEGEND_PARENT_KEY] } }, select: { groupId: true, key: true, value: true } }),
    ]);
    const stored = new Map<string, unknown>(rows.map((r) => [`${r.groupId}:${r.key}`, r.value]));
    const out = new Map<number, GcsGroupLegendPlace>();
    for (const g of groups) {
      const category = stored.get(`${g.id}:${LEGEND_CATEGORY_KEY}`);
      const parent = stored.get(`${g.id}:${LEGEND_PARENT_KEY}`);
      out.set(g.id, {
        category: typeof category === "string" ? category : defaultLegendCategory(g),
        parentId: Number.isInteger(parent) && parent !== g.id ? (parent as number) : null,
      });
    }
    await this.deps.cache.set("groups-pro:places", [...out], { ttlSec: 600, tags: ["name-styles"] });
    return out;
  }

  /**
   * Legenda pe categorii: grupurile „în legendă” cu o categorie existentă, după „Prioritate afișare”; un grup cu un
   * părinte valid (în aceeași categorie, el însuși fără părinte) apare în dropdown-ul părintelui. Categoriile goale lipsesc.
   */
  async legend(): Promise<GcsLegendProCategory[]> {
    const [categories, places, all, counts] = await Promise.all([this.categories(), this.places(), this.deps.groups.groups(), this.deps.groups.counts()]);
    const known = new Set(categories.map((c) => c.key));
    const shown = all.filter((g) => g.inLegend && known.has(places.get(g.id)?.category ?? ""));
    const byId = new Map(shown.map((g) => [g.id, g]));
    const categoryOf = (g: GcsGroupRef) => places.get(g.id)?.category ?? "";
    const parentOf = (g: GcsGroupRef): number | null => {
      const p = places.get(g.id)?.parentId ?? null;
      const parent = p === null ? undefined : byId.get(p);
      if (!parent || categoryOf(parent) !== categoryOf(g) || (places.get(parent.id)?.parentId ?? null) !== null) return null;
      return parent.id;
    };
    const pick = (g: GcsGroupRef) => ({ id: g.id, key: g.key, name: g.name, color: g.color, icon: g.icon, public: g.public, description: g.description, count: counts.get(g.id) ?? ZERO });
    return categories
      .map((c) => {
        const groups = shown
          .filter((g) => categoryOf(g) === c.key && parentOf(g) === null)
          .sort(byDisplayPriority)
          .map((g) => {
            const children = shown.filter((x) => parentOf(x) === g.id).sort(byDisplayPriority).map(pick);
            return { ...pick(g), children, childMembers: children.reduce((s, x) => s + x.count.members, 0) };
          });
        return { ...c, members: groups.reduce((s, g) => s + g.count.members, 0), groups };
      })
      .filter((c) => c.groups.length > 0);
  }

  /** ACP → Grupuri → un grup: categoria în legendă (`""` = nu apare) și grupul sub care apare (`null` = rând propriu). */
  async setPlace(groupId: number, input: GcsGroupLegendPlace, actor: GcsActor): Promise<void> {
    const { db } = this.deps;
    const group = await db.group.findUnique({ where: { id: groupId }, select: { id: true } });
    if (!group) throw new GcsNotFound({ entity: "group" });
    const errors: Record<string, string> = {};
    if (input.category !== "" && !(await this.categories()).some((c) => c.key === input.category)) errors.category = "invalid_choice";
    if (input.parentId !== null) {
      if (input.parentId === groupId) errors.parent = "invalid_choice";
      else {
        const parent = await db.group.findUnique({ where: { id: input.parentId }, select: { id: true } });
        const parentPlace = (await this.places()).get(input.parentId);
        // Un singur nivel: părintele nu poate fi el însuși sub alt grup.
        if (!parent || parentPlace?.parentId != null) errors.parent = "invalid_choice";
      }
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const values: [string, Prisma.InputJsonValue | null][] = [
      [LEGEND_CATEGORY_KEY, input.category],
      [LEGEND_PARENT_KEY, input.parentId],
    ];
    const before = await db.groupSetting.findMany({ where: { groupId, key: { in: values.map(([k]) => k) } }, select: { key: true, value: true } });
    await db.$transaction(async (tx) => {
      for (const [key, value] of values) {
        if (value === null) await tx.groupSetting.deleteMany({ where: { groupId, key } });
        else await tx.groupSetting.upsert({ where: { groupId_key: { groupId, key } }, create: { groupId, key, value }, update: { value } });
      }
      // Grupurile care stăteau sub acesta nu mai pot avea un părinte care e el însuși sub altul.
      if (input.parentId !== null) await tx.groupSetting.deleteMany({ where: { key: LEGEND_PARENT_KEY, value: { equals: groupId } } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "group.legend",
        targetType: "group",
        targetId: String(groupId),
        before: Object.fromEntries(before.map((r) => [r.key, r.value])),
        after: Object.fromEntries(values),
        ip: actor.ip,
      });
    });
    await this.deps.cache.invalidateTags(["name-styles"]);
    await this.deps.bus.emit({ name: "group.updated", payload: { groupIds: [groupId] }, tags: [`group:${groupId}`, "name-styles"] });
  }

  /**
   * Pagina „Grupurile comunității”: grupurile publice pe categorii (după „Prioritate afișare”), cu numărătorile după
   * filtru și primii membri. Căutarea: un grup al cărui nume se potrivește arată toți membrii lui; altfel, doar membrii
   * al căror nume se potrivește (grupurile fără niciun rezultat lipsesc). Un grup „doar principal” nu are membri secundari.
   */
  async page(query: { q?: string; scope?: GcsGroupsScope; category?: string | null }, now = Date.now()): Promise<GcsGroupsPage> {
    const scope = query.scope ?? "all";
    const q = (query.q ?? "").trim().toLowerCase().slice(0, 40);
    const [categories, places, all, counts] = await Promise.all([this.categories(), this.places(), this.deps.groups.groups(), this.deps.groups.counts(now)]);
    const since = new Date(now - ONLINE_MS);
    const known = new Set(categories.map((c) => c.key));
    const visible = all.filter((g) => g.public && known.has(places.get(g.id)?.category ?? "") && (!query.category || places.get(g.id)?.category === query.category));
    const parentNames = new Map<number, string[]>();
    for (const g of visible) {
      const p = places.get(g.id)?.parentId ?? null;
      if (p !== null) parentNames.set(p, [...(parentNames.get(p) ?? []), g.name]);
    }

    const memberWhere = (g: GcsGroupRef): Prisma.UserWhereInput => {
      const primary = { primaryGroupId: g.id };
      const secondary = { groups: { some: { groupId: g.id } }, primaryGroupId: { not: g.id } };
      if (g.primaryOnly || scope === "primary") return primary;
      if (scope === "secondary") return secondary;
      return { OR: [primary, secondary] };
    };
    const rows = await Promise.all(
      visible.map(async (g) => {
        const groupMatch = q !== "" && g.name.toLowerCase().includes(q);
        const where: Prisma.UserWhereInput = q && !groupMatch ? { AND: [memberWhere(g), { name: { contains: q, mode: "insensitive" } }] } : memberWhere(g);
        const [matched, list] = await Promise.all([
          this.deps.db.user.count({ where }),
          this.deps.db.user.findMany({
            where,
            orderBy: [{ lastActiveAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
            take: GROUPS_PAGE_MEMBERS,
            select: { id: true, name: true, image: true, primaryGroupId: true, lastActiveAt: true, privacy: true, ...nameKeySelect },
          }),
        ]);
        if (q && !groupMatch && matched === 0) return null;
        const c = counts.get(g.id) ?? ZERO;
        const byScope =
          scope === "primary" || g.primaryOnly
            ? { members: c.members - c.secondary, secondary: 0, online: c.online - c.onlineSecondary }
            : scope === "secondary"
              ? { members: c.secondary, secondary: c.secondary, online: c.onlineSecondary }
              : { members: c.members, secondary: c.secondary, online: c.online };
        return {
          id: g.id,
          key: g.key,
          name: g.name,
          color: g.color,
          icon: g.icon,
          description: g.description,
          ...byScope,
          children: parentNames.get(g.id) ?? [],
          matched,
          list: list.map((u) => ({
            id: u.id,
            name: u.name,
            image: u.image,
            nameKey: nameKeyOf(u),
            online: !!u.lastActiveAt && u.lastActiveAt >= since && (u.privacy as { showOnline?: boolean } | null)?.showOnline !== false,
            secondary: u.primaryGroupId !== g.id,
          })),
          priority: g.priority,
          position: g.position,
          category: places.get(g.id)?.category ?? "",
        };
      }),
    );
    const found = rows.filter((r) => r !== null);
    const members = await this.deps.db.user.count({ where: { primaryGroup: { key: { notIn: ["guest"] } } } });
    return {
      categories: categories
        .map((c) => ({
          ...c,
          groups: found
            .filter((g) => g.category === c.key)
            .sort(byDisplayPriority)
            .map(({ priority: _p, position: _o, category: _c, ...g }) => g),
        }))
        .filter((c) => c.groups.length > 0),
      totals: { groups: found.length, members },
    };
  }
}
