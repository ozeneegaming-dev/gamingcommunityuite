import type { GcsIconSvgProps } from "@gcs/ui";

/**
 * Iconița unei intrări din meniu, rezolvată pe server din numele Font Awesome (`resolveIcon`): doar date simple
 * (prefix, nume, path-ul SVG), ca pachetele complete de iconițe să nu ajungă în browser.
 */
export type GcsAcpIconDef = GcsIconSvgProps["icon"];

/** Meniul ACP cu etichetele deja traduse pe server (componentele client nu conțin texte proprii). */
export type GcsAcpNavItem = { key: string; label: string; href: string; icon?: GcsAcpIconDef };
export type GcsAcpNavSection = {
  app: string;
  title: string;
  icon?: GcsAcpIconDef;
  items: GcsAcpNavItem[];
};

/**
 * Un grup din sidebar (etapa 6 §1.3): de obicei o aplicație ACP (Sistem, Comunitate, Membri…), plus grupurile
 * scoase separat din meniu (ex. Conversii). `sections` păstrează titlurile secțiunilor din definițiile modulelor.
 */
export type GcsAcpNavGroup = { id: string; label: string; sections: GcsAcpNavSection[] };

/** Intrarea activă: potrivirea exactă sau cea mai lungă cale-părinte (ex. `/admin/members/5` → Membri). */
export function activeItem(sections: GcsAcpNavSection[], pathname: string): string | null {
  let best: { key: string; length: number } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const matches = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
      if (matches && (!best || item.href.length > best.length)) best = { key: item.key, length: item.href.length };
    }
  }
  return best?.key ?? null;
}

/** Grupul din sidebar care conține intrarea activă a căii, sau `null`. */
export function activeGroup(groups: GcsAcpNavGroup[], pathname: string): string | null {
  const key = activeItem(
    groups.flatMap((g) => g.sections),
    pathname,
  );
  if (!key) return null;
  return groups.find((g) => g.sections.some((s) => s.items.some((i) => i.key === key)))?.id ?? null;
}
