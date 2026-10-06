"use client";

import { faChevronRight, faHouse } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { activeItem, type GcsAcpNavGroup } from "./types";

/** Meniul ACP pentru componentele din pagină (breadcrumb-ul din antet), pus la dispoziție de shell. */
export type GcsAcpNavValue = { groups: GcsAcpNavGroup[]; home: { href: string; label: string }; labels: { breadcrumb: string } };

const GcsAcpNavContext = createContext<GcsAcpNavValue | null>(null);

export function GcsAcpNavProvider({ value, children }: { value: GcsAcpNavValue; children: ReactNode }) {
  return <GcsAcpNavContext.Provider value={value}>{children}</GcsAcpNavContext.Provider>;
}

type Crumb = { label: string; href?: string };

/**
 * Breadcrumb-ul antetului de pagină: Dashboard › grupul › intrarea din meniu (› titlul paginii, dacă e o pagină
 * de detaliu, ex. un membru). Se deduce din cale și din meniul ACP; în afara panoului nu randează nimic.
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
    const key = activeItem(
      nav.groups.flatMap((g) => g.sections),
      pathname,
    );
    const group = key ? nav.groups.find((g) => g.sections.some((s) => s.items.some((i) => i.key === key))) : undefined;
    const item = group?.sections.flatMap((s) => s.items).find((i) => i.key === key);
    if (group && item) {
      const first = group.sections[0]?.items[0];
      crumbs.push({ label: group.label, ...(first && first.href !== item.href ? { href: first.href } : {}) });
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
