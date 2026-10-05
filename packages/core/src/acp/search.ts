import type { PrismaClient } from "@gcs/db";
import { normalizeUsername } from "../auth/usernames";
import type { GcsModuleRegistry } from "../modules/registry";
import type { GcsActor } from "../permissions/types";
import type { GcsAcpRoleService } from "./roles";

export type GcsAcpSearchResult = { group: "settings" | "members" | "groups" | "forums"; label: string; href: string };

const MAX_PER_GROUP = 8;

/** Secțiunea ACP (dreptul de acces) și pagina unei setări din secțiunea `section` a modulului. */
export const settingsAcpSection = (section: string) => `system.settings_${section}`;
export const settingsHref = (section: string) => `/admin/settings/${section}`;

/**
 * Căutarea live din header-ul ACP (spec §12): setări după eticheta tradusă, membri după prefixul
 * numelui normalizat (fără diacritice) și grupuri după nume. Fiecare grupă apare doar dacă adminul
 * are dreptul `view` pe secțiunea ei.
 */
export class GcsAcpSearch {
  constructor(private readonly deps: { db: PrismaClient; registry: GcsModuleRegistry; acp: GcsAcpRoleService }) {}

  async search(q: string, actor: GcsActor, translate: (key: string) => string): Promise<GcsAcpSearchResult[]> {
    const query = q.trim();
    if (query.length < 1) return [];
    const { db, registry, acp } = this.deps;
    const needle = normalizeUsername(query);
    const results: GcsAcpSearchResult[] = [];

    // Setări: potrivire pe eticheta tradusă sau pe cheie, fără diacritice și fără majuscule.
    const settings: GcsAcpSearchResult[] = [];
    for (const def of registry.settingDefs()) {
      if (settings.length >= MAX_PER_GROUP) break;
      const label = translate(def.labelKey);
      const haystack = `${normalizeUsername(label)} ${def.key}`;
      if (!haystack.includes(needle)) continue;
      if (!(await acp.can(actor, settingsAcpSection(def.section), "view"))) continue;
      settings.push({ group: "settings", label, href: `${settingsHref(def.section)}#${def.key}` });
    }
    results.push(...settings);

    if (await acp.can(actor, "members.members", "view")) {
      const members = await db.user.findMany({
        where: { nameNormalized: { startsWith: needle } },
        select: { id: true, name: true },
        orderBy: { nameNormalized: "asc" },
        take: MAX_PER_GROUP,
      });
      results.push(...members.map((m) => ({ group: "members" as const, label: m.name, href: `/admin/members/${m.id}` })));
    }

    if (await acp.can(actor, "members.groups", "view")) {
      const groups = await db.group.findMany({
        where: { name: { contains: query, mode: "insensitive" } },
        select: { id: true, name: true },
        orderBy: { position: "asc" },
        take: MAX_PER_GROUP,
      });
      results.push(...groups.map((g) => ({ group: "groups" as const, label: g.name, href: `/admin/groups/${g.id}` })));
    }

    if (await acp.can(actor, "community.forums", "view")) {
      // Fără diacritice: numele forumurilor sunt comparate cu `unaccent` (extensia din migrația forumului).
      const forums = await db.$queryRaw<{ id: number; name: string }[]>`
        SELECT id, name FROM forums
        WHERE unaccent(lower(name)) LIKE '%' || unaccent(lower(${query})) || '%'
        ORDER BY "parentId" NULLS FIRST, position
        LIMIT ${MAX_PER_GROUP}`;
      results.push(...forums.map((f) => ({ group: "forums" as const, label: f.name, href: `/admin/community/forums/${f.id}` })));
    }

    return results;
  }
}
