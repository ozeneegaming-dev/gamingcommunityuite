"use client";

import { faChevronRight, faHouse } from "@fortawesome/free-solid-svg-icons";
import { acpAreaForPath } from "@gcs/core/acp-areas";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import type { GcsAcpNavArea } from "./types";

/** Meniul ACP pentru componentele din pagină (breadcrumb-ul din antet), pus la dispoziție de shell. */
export type GcsAcpNavValue = { areas: GcsAcpNavArea[]; home: { href: string; label: string }; labels: { breadcrumb: string } };

const GcsAcpNavContext = createContext<GcsAcpNavValue | null>(null);

export function GcsAcpNavProvider({ value, children }: { value: GcsAcpNavValue; children: ReactNode }) {
  return <GcsAcpNavContext.Provider value={value}>{children}</GcsAcpNavContext.Provider>;
}

type Crumb = { label: string; href?: string };

/**
 * Breadcrumb-ul antetului de pagină: Dashboard › zona › intrarea din meniu (› titlul paginii, dacă e o pagină de detaliu,
 * ex. un membru). Se deduce din cale și din navigația ACP; în afara panoului nu randează nimic.
 */
export function GcsAcpBreadcrumb({ current, items }: { current?: string | undefined; items?: Crumb[] | undefined }) {
  const nav = useContext(GcsAcpNavContext);
  const pathname = usePathname();
  if (!nav) return null;

  let crumbs: Crumb[];
  if (items) {
    crumbs = [{ label: nav.home.label, href: nav.home.href }, ...items];
  } else {
    crumbs = [{ label: nav.home.label, href: nav.home.href }];
    const found = acpAreaForPath(nav.areas, pathname);
    const area = found ? nav.areas.find((a) => a.key === found.area) : undefined;
    const areaItems = area?.groups.flatMap((g) => g.items) ?? [];
    const item = areaItems.find((i) => i.key === found?.item);
    if (area && item) {
      const first = areaItems.find((i) => !i.alias);
      crumbs.push({ label: area.label, ...(first && first.href !== item.href ? { href: first.href } : {}) });
      crumbs.push({ label: item.label, href: item.href });
      if (current && current !== item.label && pathname !== item.href) crumbs.push({ label: current });
    } else if (current && pathname !== nav.home.href) {
      crumbs.push({ label: current });
    }
  }
  // Ultimul element e pagina curentă: fără link.
  const last = crumbs.length - 1;

  return (
    <nav aria-label={nav.labels.breadcrumb} className="gcs-acpCrumbs" data-testid="gcs-acp-breadcrumb">
      <ol>
        {crumbs.map((c, i) => (
          <li key={`${i}:${c.label}`}>
            {i > 0 && <GcsIconSvg icon={faChevronRight} className="gcs-acpCrumbs__sep" />}
            {i === last ? (
              <span aria-current="page">
                {i === 0 && <GcsIconSvg icon={faHouse} className="gcs-acpCrumbs__home" />}
                {c.label}
              </span>
            ) : c.href ? (
              <Link href={c.href}>
                {i === 0 && <GcsIconSvg icon={faHouse} className="gcs-acpCrumbs__home" />}
                {c.label}
              </Link>
            ) : (
              <span>{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
