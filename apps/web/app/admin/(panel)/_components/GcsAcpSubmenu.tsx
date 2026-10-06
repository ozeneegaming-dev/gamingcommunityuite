"use client";

import { cx, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { activeItem, type GcsAcpIconDef, type GcsAcpNavSection } from "./types";

type Props = {
  title: string;
  /** Iconița aplicației curente, afișată lângă titlu. */
  icon?: GcsAcpIconDef | undefined;
  navLabel: string;
  sections: GcsAcpNavSection[];
  allSections: GcsAcpNavSection[];
  pathname: string;
};

/** Submeniul aplicației curente (236px), grupat pe secțiuni, ca în macheta Admin; fiecare intrare are iconița ei. */
export function GcsAcpSubmenu({ title, icon, navLabel, sections, allSections, pathname }: Props) {
  const active = activeItem(allSections, pathname);
  return (
    <nav aria-label={navLabel} className="gcs-acpSub">
      <span className="gcs-display gcs-acpSub__app" style={{ fontSize: 18, fontWeight: 700, padding: "0 12px 4px" }}>
        {icon && <GcsIconSvg icon={icon} className="gcs-acpSub__appIcon" />}
        {title}
      </span>
      {sections.map((section) => (
        <div key={section.title} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span className="gcs-acpSub__title">
            {section.icon && <GcsIconSvg icon={section.icon} className="gcs-acpSub__titleIcon" />}
            {section.title}
          </span>
          {section.items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={cx("gcs-acpSub__link", item.key === active && "gcs-acpSub__link--active")}
              aria-current={item.key === active ? "page" : undefined}
            >
              {item.icon && <GcsIconSvg icon={item.icon} className="gcs-acpSub__icon" />}
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
