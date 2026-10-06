"use client";

import { faChevronDown, faGaugeHigh, faXmark } from "@fortawesome/free-solid-svg-icons";
import { cx, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { forwardRef, type ReactNode } from "react";
import { ACP_APP_ICONS } from "./icons";
import type { GcsAcpNavGroup, GcsAcpNavItem } from "./types";

type Props = {
  groups: GcsAcpNavGroup[];
  /** Intrarea „Dashboard” (Panou), afișată separat, deasupra grupurilor; lipsește fără drept pe dashboard. */
  dashboard: GcsAcpNavItem | null;
  activeKey: string | null;
  activeGroupId: string | null;
  open: ReadonlySet<string>;
  onToggleGroup: (id: string) => void;
  collapsed: boolean;
  /** Pe ecrane înguste: sertarul e deschis (dialog modal). */
  drawer: { mobile: boolean; open: boolean; onClose: () => void };
  brand: ReactNode;
  adminCard: ReactNode;
  labels: { nav: string; closeMenu: string; drawer: string };
};

/**
 * Sidebar-ul ACP (etapa 6 §1.1): logo + numele site-ului, cardul adminului și un singur meniu vertical, pe grupuri
 * care se pliază (iconiță, titlu, săgeată). Grupul curent e deschis, intrarea curentă evidențiată. Restrâns, rămân
 * doar iconițele (cu tooltip-uri); pe mobil e un sertar.
 */
export const GcsAcpSidebar = forwardRef<HTMLElement, Props>(function GcsAcpSidebar(
  { groups, dashboard, activeKey, activeGroupId, open, onToggleGroup, collapsed, drawer, brand, adminCard, labels },
  ref,
) {
  const modal = drawer.mobile && drawer.open;
  const link = (item: GcsAcpNavItem, className: string, icon?: ReactNode) => {
    const active = item.key === activeKey;
    return (
      <Link
        href={item.href}
        className={cx(className, active && `${className}--active`)}
        aria-current={active ? "page" : undefined}
        data-tooltip={item.label}
      >
        {icon ?? (item.icon && <GcsIconSvg icon={item.icon} className="gcs-acpNav__itemIcon" />)}
        <span className="gcs-acpNav__label">{item.label}</span>
      </Link>
    );
  };

  return (
    <aside
      ref={ref}
      id="gcs-acp-sidebar"
      className={cx("gcs-acpSide", collapsed && !drawer.mobile && "gcs-acpSide--collapsed", modal && "gcs-acpSide--open")}
      data-testid="gcs-acp-sidebar"
      data-collapsed={collapsed && !drawer.mobile ? "true" : "false"}
      {...(modal ? { role: "dialog", "aria-modal": true, "aria-label": labels.drawer } : {})}
      inert={drawer.mobile && !drawer.open}
    >
      <div className="gcs-acpSide__brand">
        {brand}
        <button type="button" className="gcs-iconBtn gcs-acpSide__close" aria-label={labels.closeMenu} onClick={drawer.onClose}>
          <GcsIconSvg icon={faXmark} />
        </button>
      </div>
      {adminCard}
      <nav aria-label={labels.nav} className="gcs-acpNav">
        <ul className="gcs-acpNav__list">
          {dashboard && <li>{link(dashboard, "gcs-acpNav__top", <GcsIconSvg icon={faGaugeHigh} className="gcs-acpNav__icon" />)}</li>}
          {groups.map((g) => {
            const isOpen = open.has(g.id);
            const panelId = `gcs-acp-group-${g.id}`;
            return (
              <li key={g.id} className={cx("gcs-acpNav__group", g.id === activeGroupId && "gcs-acpNav__group--current")}>
                <button
                  type="button"
                  className="gcs-acpNav__toggle"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  data-tooltip={g.label}
                  data-testid={`gcs-acp-group-${g.id}`}
                  onClick={() => onToggleGroup(g.id)}
                >
                  <GcsIconSvg icon={ACP_APP_ICONS[g.id] ?? ACP_APP_ICONS.system!} className="gcs-acpNav__icon" />
                  <span className="gcs-acpNav__label">{g.label}</span>
                  <GcsIconSvg icon={faChevronDown} className="gcs-acpNav__chevron" />
                </button>
                <div id={panelId} className="gcs-acpNav__panel" hidden={!isOpen}>
                  {g.sections.map((s, i) => (
                    <div key={`${i}:${s.title}`} className="gcs-acpNav__section">
                      <span className="gcs-acpNav__sectionTitle">
                        {s.icon && <GcsIconSvg icon={s.icon} className="gcs-acpNav__sectionIcon" />}
                        {s.title}
                      </span>
                      <ul className="gcs-acpNav__items">
                        {s.items.map((item) => (
                          <li key={item.key}>{link(item, "gcs-acpNav__link")}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
});
