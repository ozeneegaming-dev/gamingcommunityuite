import type { GcsAcpApp, GcsAcpMenuSection, GcsModuleRegistry } from "../modules/registry";
import type { GcsAcpRights } from "./roles";

/** Ordinea implicită a aplicațiilor în bara ACP (spec §12.1). */
export const GCS_ACP_APP_ORDER: GcsAcpApp[] = ["system", "community", "members", "vip", "gaming", "pages", "stats", "appearance"];

/**
 * Meniul ACP vizibil pentru un admin: doar intrările a căror secțiune are dreptul `view`.
 * Secțiunile (și deci aplicațiile) rămase fără intrări sunt ascunse.
 */
export function buildAcpMenu(registry: GcsModuleRegistry, rights: GcsAcpRights): GcsAcpMenuSection[] {
  const menu: GcsAcpMenuSection[] = [];
  for (const section of registry.acpMenu()) {
    const items = section.items.filter((item) => rights[item.section]?.view === true);
    if (items.length > 0) menu.push({ ...section, items });
  }
  return menu;
}

export type GcsAcpAppEntry = { app: GcsAcpApp; href: string };

/**
 * Aplicațiile din bara laterală, fiecare cu linkul primei intrări. `appOrder` e ordinea salvată de admin;
 * aplicațiile pe care nu le conține urmează în ordinea implicită.
 */
export function acpAppEntries(menu: GcsAcpMenuSection[], appOrder: string[] = []): GcsAcpAppEntry[] {
  const first = new Map<GcsAcpApp, string>();
  for (const section of menu) {
    const href = section.items[0]?.href;
    if (href && !first.has(section.app)) first.set(section.app, href);
  }
  const order = [...appOrder.filter((a): a is GcsAcpApp => first.has(a as GcsAcpApp)), ...GCS_ACP_APP_ORDER];
  const seen = new Set<GcsAcpApp>();
  const entries: GcsAcpAppEntry[] = [];
  for (const app of order) {
    const href = first.get(app);
    if (href && !seen.has(app)) {
      seen.add(app);
      entries.push({ app, href });
    }
  }
  return entries;
}

/** Aplicația ACP căreia îi aparține o cale (cea mai lungă potrivire de `href`), sau `null`. */
export function acpAppForPath(menu: GcsAcpMenuSection[], pathname: string): GcsAcpApp | null {
  let best: { app: GcsAcpApp; length: number } | null = null;
  for (const section of menu) {
    for (const item of section.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.length)) best = { app: section.app, length: item.href.length };
    }
  }
  return best?.app ?? null;
}
