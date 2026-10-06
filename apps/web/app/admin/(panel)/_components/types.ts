import type { GcsIconSvgProps } from "@gcs/ui";

/**
 * Iconița unei intrări din meniu, rezolvată pe server din numele Font Awesome (`resolveIcon`): doar date simple
 * (prefix, nume, path-ul SVG), ca pachetele complete de iconițe să nu ajungă în browser.
 */
export type GcsAcpIconDef = GcsIconSvgProps["icon"];

/** Meniul ACP cu etichetele deja traduse pe server (componentele client nu conțin texte proprii). */
export type GcsAcpNavApp = { app: string; label: string; href: string };
export type GcsAcpNavSection = {
  app: string;
  title: string;
  icon?: GcsAcpIconDef;
  items: { key: string; label: string; href: string; icon?: GcsAcpIconDef }[];
};

/** Aplicația ACP a unei căi: intrarea cu cel mai lung `href` care se potrivește. */
export function activeApp(sections: GcsAcpNavSection[], pathname: string): string | null {
  let best: { app: string; length: number } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.length)) best = { app: section.app, length: item.href.length };
    }
  }
  return best?.app ?? null;
}

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
