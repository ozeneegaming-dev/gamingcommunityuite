"use client";

import { faBars } from "@fortawesome/free-solid-svg-icons";
import { cx, GcsIconSvg } from "@gcs/ui";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { GcsAcpAppRail } from "./GcsAcpAppRail";
import { GcsAcpSubmenu } from "./GcsAcpSubmenu";
import { ACP_APP_ICONS } from "./icons";
import { activeApp, type GcsAcpNavApp, type GcsAcpNavSection } from "./types";

type Props = {
  apps: GcsAcpNavApp[];
  sections: GcsAcpNavSection[];
  labels: {
    appsNav: string;
    submenuNav: Record<string, string>;
    home: string;
    reorderApps: string;
    reorderDone: string;
    moveUp: Record<string, string>;
    moveDown: Record<string, string>;
    openMenu: string;
    closeMenu: string;
  };
  header: ReactNode;
  children: ReactNode;
};

/** Structura ACP: bara de aplicații + submeniul (off-canvas pe ecrane înguste), header și conținut. */
export function GcsAcpShell({ apps, sections, labels, header, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = activeApp(sections, pathname) ?? apps[0]?.app ?? null;
  const currentSections = sections.filter((s) => s.app === current);
  const currentLabel = apps.find((a) => a.app === current)?.label ?? "";

  return (
    <>
      <button
        type="button"
        className={cx("gcs-acpShell__backdrop", open && "gcs-acpShell__backdrop--open")}
        aria-label={labels.closeMenu}
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />
      <div className={cx("gcs-acpShell__nav", open && "gcs-acpShell__nav--open")} onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) setOpen(false);
      }}>
        <GcsAcpAppRail apps={apps} current={current} labels={labels} homeHref="/admin" />
        {currentSections.length > 0 && (
          <GcsAcpSubmenu
            title={currentLabel}
            icon={current ? ACP_APP_ICONS[current] : undefined}
            navLabel={current ? (labels.submenuNav[current] ?? currentLabel) : currentLabel}
            sections={currentSections}
            pathname={pathname}
            allSections={sections}
          />
        )}
      </div>
      <div className="gcs-acpMain">
        <div style={{ display: "flex", alignItems: "flex-start", background: "var(--gcs-chrome)" }}>
          <button
            type="button"
            className="gcs-acpShell__menuBtn gcs-btn gcs-btn--ghost"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            style={{ margin: "12px 0 12px 16px" }}
          >
            <GcsIconSvg icon={faBars} className="gcs-btn__icon" />
            {labels.openMenu}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>{header}</div>
        </div>
        <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>{children}</main>
      </div>
    </>
  );
}
