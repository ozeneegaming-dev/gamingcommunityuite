import type { GcsCache, GcsDisplayGroupInfo, GcsGroupDisplayService } from "@gcs/core";
import { type PrismaClient, sql } from "@gcs/db";

/** „Online” = activ în ultimele 15 minute, cu statusul vizibil (ca cardul unui grup). */
const ONLINE_MS = 15 * 60_000;
const COUNTS_KEY = "groups:counts";
const COUNTS_TTL_SEC = 60;
const GROUPS_KEY = "groups:directory";
const GROUPS_TTL_SEC = 600;
/** Grupurile fără pagină de membri (și fără link pe pastilă), orice ar fi în setări. */
const NEVER_PUBLIC = new Set(["guest", "bot"]);

/** Un grup așa cum îl arată pastilele: id, nume (titlul grupului, dacă are), culoare, iconiță, setările de afișare. */
export type GcsGroupRef = {
  id: number;
  key: string;
  name: string;
  /** Titlul grupului (ex. „Staff”), afișat în postbit în locul numelui, dacă există. */
  title: string | null;
  color: string | null;
  icon: string | null;
  /** Banner-ul grupului din postbit (culoare sau gradient validat). */
  banner: string | null;
  isVip: boolean;
  inLegend: boolean;
  position: number;
  /** Are pagina membrilor (`/members?group=<id>`) și link pe pastilă. */
  public: boolean;
  /** Descrierea scurtă (primul rând al tooltip-ului). */
  description: string;
  /** Prioritatea de afișare (ordinea în legendă și în pastile). */
  priority: number;
  /** Apare ca grup secundar (pastilele de lângă grupul afișat). */
  showSecondary: boolean;
  /** Pagina membrilor și @mențiunile: doar membrii cu el ca grup principal. */
  primaryOnly: boolean;
};

/** Câți membri are un grup (principal + secundar), câți îl au ca secundar, câți sunt online acum (și dintre ei, ca secundar). */
export type GcsGroupCount = { members: number; secondary: number; online: number; onlineSecondary: number };

/** Grupurile unui membru pentru pastile: cel afișat (stilul numelui) și cele secundare vizibile, după prioritate. */
export type GcsMemberGroups = { shown: GcsGroupRef; secondary: GcsGroupRef[] };

/**
 * Grupurile comunității pentru pastile, legendă și paginile de membri (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot):
 * lista lor cu setările de afișare, numărătorile din cache (fără o interogare la fiecare hover) și grupurile fiecărui
 * membru (cel afișat + cele secundare).
 */
export class GcsGroupDirectory {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; display: GcsGroupDisplayService }) {}

  /** Toate grupurile, în ordinea din ACP (cache invalidat de orice schimbare a grupurilor). */
  async groups(): Promise<GcsGroupRef[]> {
    const cached = await this.deps.cache.get<GcsGroupRef[]>(GROUPS_KEY);
    if (cached) return cached;
    const [rows, info] = await Promise.all([
      this.deps.db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, key: true, name: true, title: true, color: true, icon: true, banner: true, isVip: true, inLegend: true, position: true } }),
      this.deps.display.info(),
    ]);
    const list = rows.map((g) => {
      const s = info.get(g.id)?.settings;
      return {
        id: g.id,
        key: g.key,
        name: g.name,
        title: g.title,
        color: g.color,
        icon: g.icon,
        banner: g.banner,
        isVip: g.isVip,
        inLegend: g.inLegend,
        position: g.position,
        public: !NEVER_PUBLIC.has(g.key) && (s?.public ?? true),
        description: s?.description ?? "",
        priority: s?.priority ?? 10,
        showSecondary: s?.showSecondary ?? true,
        primaryOnly: s?.primaryOnly ?? false,
      } satisfies GcsGroupRef;
    });
    await this.deps.cache.set(GROUPS_KEY, list, { ttlSec: GROUPS_TTL_SEC, tags: ["name-styles"] });
    return list;
  }

  async group(id: number): Promise<GcsGroupRef | null> {
    return (await this.groups()).find((g) => g.id === id) ?? null;
  }

  /**
   * Numărătorile tuturor grupurilor, din cache (60 s): membri (principal + secundar, sau doar principal dacă grupul
   * cere), câți îl au ca grup secundar și câți sunt online acum (statusul vizibil). Un grup nou are zero.
   */
  async counts(now = Date.now()): Promise<Map<number, GcsGroupCount>> {
    const cached = await this.deps.cache.get<[number, GcsGroupCount][]>(COUNTS_KEY);
    if (cached) return new Map(cached);
    const since = new Date(now - ONLINE_MS).toISOString();
    const rows = await this.deps.db.$queryRaw<{ gid: number; total: number; secondary: number; online: number; ptotal: number; ponline: number }[]>(sql`
      WITH m AS (
        SELECT u."primaryGroupId" AS gid, false AS secondary,
               (u."lastActiveAt" >= ${since}::timestamp AND COALESCE((u.privacy->>'showOnline')::boolean, true)) AS online
        FROM users u
        WHERE NOT u."isBot"
        UNION ALL
        SELECT ug."groupId", true,
               (u."lastActiveAt" >= ${since}::timestamp AND COALESCE((u.privacy->>'showOnline')::boolean, true))
        FROM user_groups ug JOIN users u ON u.id = ug."userId"
        WHERE ug."groupId" <> u."primaryGroupId" AND NOT u."isBot"
      )
      SELECT gid, count(*)::int AS total, count(*) FILTER (WHERE secondary)::int AS secondary, count(*) FILTER (WHERE online)::int AS online,
             count(*) FILTER (WHERE NOT secondary)::int AS ptotal, count(*) FILTER (WHERE online AND NOT secondary)::int AS ponline
      FROM m GROUP BY gid`);
    const primaryOnly = new Set((await this.groups()).filter((g) => g.primaryOnly).map((g) => g.id));
    const out = new Map<number, GcsGroupCount>(
      rows.map((r) => [
        r.gid,
        primaryOnly.has(r.gid)
          ? { members: r.ptotal, secondary: 0, online: r.ponline, onlineSecondary: 0 }
          : { members: r.total, secondary: r.secondary, online: r.online, onlineSecondary: r.online - r.ponline },
      ]),
    );
    await this.deps.cache.set(COUNTS_KEY, [...out], { ttlSec: COUNTS_TTL_SEC, tags: ["name-styles"] });
    return out;
  }

  /**
   * Grupurile unor membri: grupul afișat (cel care dă stilul numelui: `nameGroupId`, altfel principalul) și grupurile
   * secundare vizibile (setarea „Afișează ca grup secundar”), inclusiv principalul când nu e cel afișat, după prioritate.
   */
  async memberGroups(userIds: readonly string[]): Promise<Map<string, GcsMemberGroups>> {
    const ids = [...new Set(userIds)].slice(0, 500);
    if (ids.length === 0) return new Map();
    const [users, groups] = await Promise.all([
      this.deps.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, primaryGroupId: true, nameGroupId: true, groups: { select: { groupId: true } } } }),
      this.groups(),
    ]);
    const byId = new Map(groups.map((g) => [g.id, g]));
    const out = new Map<string, GcsMemberGroups>();
    for (const u of users) {
      const shownId = u.nameGroupId ?? u.primaryGroupId;
      const shown = byId.get(shownId) ?? byId.get(u.primaryGroupId);
      if (!shown) continue;
      const others = [u.primaryGroupId, ...u.groups.map((g) => g.groupId)]
        .filter((id, i, all) => id !== shown.id && all.indexOf(id) === i)
        .map((id) => byId.get(id))
        .filter((g): g is GcsGroupRef => g !== undefined && g.showSecondary)
        .sort((a, b) => b.priority - a.priority || a.position - b.position || a.id - b.id);
      out.set(u.id, { shown, secondary: others });
    }
    return out;
  }
}

/** Ordinea grupurilor în legendă: prioritatea de afișare, apoi ordinea din ACP. */
export const byDisplayPriority = (a: Pick<GcsGroupRef, "priority" | "position" | "id">, b: Pick<GcsGroupRef, "priority" | "position" | "id">) =>
  b.priority - a.priority || a.position - b.position || a.id - b.id;

export type { GcsDisplayGroupInfo };
