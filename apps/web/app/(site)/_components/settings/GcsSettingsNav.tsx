"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Meniul din stânga al setărilor contului. */
export function GcsSettingsNav({ items, label }: { items: { href: string; label: string; icon?: ReactNode }[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="gcs-settingsNav">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={`gcs-settingsNav__link${pathname === i.href ? " gcs-settingsNav__link--active" : ""}`}
          aria-current={pathname === i.href ? "page" : undefined}
        >
          {i.icon}
          <span>{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}
