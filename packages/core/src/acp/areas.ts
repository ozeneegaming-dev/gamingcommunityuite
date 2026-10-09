import type { GcsAcpApp, GcsAcpArea, GcsAcpMenuSection } from "../modules/registry";

/** Adresa Dashboard-ului: are linkul lui în bara de iconițe, nu stă într-o zonă. */
export const ACP_DASHBOARD_HREF = "/admin";

/** Ordinea zonelor din bara de iconițe (specul 2026-10-09-acp-navigatie-aplicatii §1.2). */
export const GCS_ACP_AREAS = ["system", "community", "members", "appearance", "gaming", "vip", "stats", "apps"] as const satisfies readonly GcsAcpArea[];

/** Zona implicită a secțiunilor fără `area`, după aplicația lor ACP. */
export const ACP_APP_AREA: Record<GcsAcpApp, GcsAcpArea> = {
  system: "system",
  community: "community",
  members: "members",
  vip: "vip",
  gaming: "gaming",
  pages: "apps",
  stats: "stats",
  appearance: "appearance",
};

/**
 * Ordinea cunoscută a grupurilor (titlurile lor) din fiecare zonă. Grupurile care nu sunt aici (ex. cele ale
 * pluginurilor) urmează, în ordinea înregistrării modulelor.
 */
export const GCS_ACP_GROUP_ORDER: Record<GcsAcpArea, readonly string[]> = {
  system: [
    "acp.menu.system.overview",
    "acp.menu.system.site_features",
    "acp.menu.system.settings",
    "acp.menu.system.discovery",
    "acp.menu.system.promotion",
    "acp.menu.system.support",
    "acp.menu.system.conversions",
  ],
  community: ["acp.menu.community.forums_group", "acp.menu.community.chat_group", "acp.menu.members.moderation"],
  members: ["acp.menu.members.members", "acp.menu.members.staff", "acp.menu.members.member_settings", "acp.menu.members.achievements", "acp.menu.members.communication"],
  appearance: ["acp.menu.appearance.style", "acp.menu.appearance.layout"],
  gaming: ["acp.menu.gaming.servers_group", "acp.menu.gaming.clans_group"],
  vip: ["acp.menu.vip.vip_group"],
  stats: ["acp.menu.stats.overview_group", "acp.menu.stats.activity", "acp.menu.stats.apps"],
  apps: ["acp.menu.system.apps_manage", "acp.menu.system.apps_dev"],
};

export type GcsAcpAreaItem = { key: string; labelKey: string; href: string; icon?: string; alias: boolean };
/** Un grup din coloana a doua: titlul (cheie de traducere), iconița opțională și paginile, în ordinea declarării. */
export type GcsAcpAreaGroup = { title: string; icon?: string; items: GcsAcpAreaItem[] };
export type GcsAcpAreaView = { key: GcsAcpArea; groups: GcsAcpAreaGroup[] };

/**
 * Zonele navigației ACP din meniul deja filtrat pe drepturi (`buildAcpMenu`): fiecare intrare ajunge în zona și grupul
 * ei (`item.area ?? section.area ?? zona aplicației`, `item.group ?? section.group ?? section.title`); secțiunile cu
 * același grup se unesc. Dashboard-ul nu intră în zone; o zonă fără pagini lipsește.
 */
export function acpAreas(menu: GcsAcpMenuSection[]): GcsAcpAreaView[] {
  const byArea = new Map<GcsAcpArea, Map<string, GcsAcpAreaGroup>>();
  for (const section of menu) {
    for (const it of section.items) {
      if (it.href === ACP_DASHBOARD_HREF) continue;
      const area = it.area ?? section.area ?? ACP_APP_AREA[section.app];
      const title = it.group ?? section.group ?? section.title;
      const groups = byArea.get(area) ?? new Map<string, GcsAcpAreaGroup>();
      byArea.set(area, groups);
      let group = groups.get(title);
      if (!group) {
        group = { title, ...(section.icon && !it.group ? { icon: section.icon } : {}), items: [] };
        groups.set(title, group);
      }
      if (group.items.some((i) => i.key === it.key)) continue;
      group.items.push({ key: it.key, labelKey: it.labelKey, href: it.href, ...(it.icon ? { icon: it.icon } : {}), alias: it.alias === true });
    }
  }

  const out: GcsAcpAreaView[] = [];
  for (const key of GCS_ACP_AREAS) {
    const groups = byArea.get(key);
    if (!groups || groups.size === 0) continue;
    const known = GCS_ACP_GROUP_ORDER[key];
    const rank = (title: string) => {
      const at = known.indexOf(title);
      return at === -1 ? known.length : at;
    };
    // Sortarea e stabilă: grupurile necunoscute își păstrează ordinea înregistrării.
    out.push({ key, groups: [...groups.values()].sort((a, b) => rank(a.title) - rank(b.title)) });
  }
  return out;
}

/** Forma minimă a unei zone pentru căutarea paginii curente (zonele din `acpAreas` sau cele traduse, din web). */
type GcsAcpAreaLike<K extends string> = { key: K; groups: readonly { items: readonly { key: string; href: string; alias?: boolean }[] }[] };

/**
 * Zona și intrarea paginii curente: potrivirea exactă sau cea mai lungă cale-părinte (ex. `/admin/members/5` → Membri).
 * Scurtăturile nu contează; Dashboard-ul și căile necunoscute întorc `null`.
 */
export function acpAreaForPath<K extends string>(areas: readonly GcsAcpAreaLike<K>[], pathname: string): { area: K; item: string } | null {
  let best: { area: K; item: string; length: number } | null = null;
  for (const area of areas) {
    for (const group of area.groups) {
      for (const it of group.items) {
        if (it.alias) continue;
        const matches = pathname === it.href || pathname.startsWith(`${it.href}/`);
        if (matches && (!best || it.href.length > best.length)) best = { area: area.key, item: it.key, length: it.href.length };
      }
    }
  }
  return best ? { area: best.area, item: best.item } : null;
}
