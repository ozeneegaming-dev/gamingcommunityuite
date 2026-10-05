"use client";

import { cx } from "@gcs/ui";
import Link from "next/link";
import { activeItem, type GcsAcpNavSection } from "./types";

type Props = {
  title: string;
  navLabel: string;
  sections: GcsAcpNavSection[];
  allSections: GcsAcpNavSection[];
  pathname: string;
};

/** Submeniul aplicației curente (236px), grupat pe secțiuni, ca în macheta Admin. */
export function GcsAcpSubmenu({ title, navLabel, sections, allSections, pathname }: Props) {
  const active = activeItem(allSections, pathname);
  return (
    <nav aria-label={navLabel} className="gcs-acpSub">
      <span className="gcs-display" style={{ fontSize: 18, fontWeight: 700, padding: "0 12px 4px" }}>
        {title}
      </span>
      {sections.map((section) => (
        <div key={section.title} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span className="gcs-acpSub__title">{section.title}</span>
          {section.items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={cx("gcs-acpSub__link", item.key === active && "gcs-acpSub__link--active")}
              aria-current={item.key === active ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
