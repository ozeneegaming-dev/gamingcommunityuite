"use client";

import { cx, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ACP_AREA_ICONS } from "./icons";
import type { GcsAcpNavArea, GcsAcpNavItem } from "./types";

type Props = {
  areas: GcsAcpNavArea[];
  dashboard: GcsAcpNavItem | null;
  /** Zona afișată în coloană (butonul ei e „apăsat”). */
  selected: string | null;
  /** Zona paginii curente (`null` pe Dashboard). */
  current: string | null;
  dashboardActive: boolean;
  /** Coloana e deschisă: zona selectată se „lipește” de ea, ca un tab. */
  columnOpen: boolean;
  onSelect: (area: string) => void;
  brand: ReactNode;
  labels: { rail: string };
};

/**
 * Bara de iconițe a ACP-ului (specul 2026-10-09-acp-navigatie-aplicatii §1.1): Dashboard (link) și zonele (butoane care
 * aleg ce arată coloana a doua). O singură oprire Tab, apoi săgețile sus/jos, Home și End mută focusul („roving”).
 */
export function GcsAcpRail({ areas, dashboard, selected, current, dashboardActive, columnOpen, onSelect, brand, labels }: Props) {
  const list = useRef<HTMLUListElement>(null);
  const entries = [...(dashboard ? ["dashboard"] : []), ...areas.map((a) => a.key)];
  const start = Math.max(0, entries.indexOf(dashboardActive ? "dashboard" : (selected ?? "")));
  const [focusIndex, setFocusIndex] = useState(start);

  // Oprirea Tab urmează zona selectată (ex. după navigare), cât timp focusul nu e în bară.
  useEffect(() => {
    if (!list.current?.contains(document.activeElement)) setFocusIndex(start);
  }, [start]);

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[data-rail-item]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    const next = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const index = (next + items.length) % items.length;
    setFocusIndex(index);
    items[index]?.focus();
  }

  return (
    <div className="gcs-acpRail">
      <div className="gcs-acpRail__brand">{brand}</div>
      <nav aria-label={labels.rail} className="gcs-acpRail__nav">
        <ul ref={list} className="gcs-acpRail__list" onKeyDown={onKeyDown} data-testid="gcs-acp-rail">
          {dashboard && (
            <li>
              <Link
                href={dashboard.href}
                data-rail-item=""
                tabIndex={focusIndex === 0 ? 0 : -1}
                onFocus={() => setFocusIndex(0)}
                className={cx("gcs-acpRail__item", dashboardActive && "gcs-acpRail__item--current")}
                aria-current={dashboardActive ? "page" : undefined}
                data-testid="gcs-acp-rail-dashboard"
              >
                <span className="gcs-acpRail__mark" aria-hidden="true" />
                <GcsIconSvg icon={ACP_AREA_ICONS.dashboard!} className="gcs-acpRail__icon" />
                <span className="gcs-acpRail__label">{dashboard.label}</span>
              </Link>
            </li>
          )}
          {areas.map((area, i) => {
            const index = i + (dashboard ? 1 : 0);
            const isSelected = area.key === selected;
            return (
              <li key={area.key}>
                <button
                  type="button"
                  data-rail-item=""
                  tabIndex={focusIndex === index ? 0 : -1}
                  onFocus={() => setFocusIndex(index)}
                  className={cx(
                    "gcs-acpRail__item",
                    isSelected && "gcs-acpRail__item--selected",
                    isSelected && columnOpen && "gcs-acpRail__item--tab",
                    area.key === current && "gcs-acpRail__item--current",
                  )}
                  aria-pressed={isSelected}
                  aria-controls="gcs-acp-column"
                  aria-current={area.key === current ? "true" : undefined}
                  data-testid={`gcs-acp-area-${area.key}`}
                  onClick={() => onSelect(area.key)}
                >
                  <span className="gcs-acpRail__mark" aria-hidden="true" />
                  <GcsIconSvg icon={ACP_AREA_ICONS[area.key] ?? ACP_AREA_ICONS.apps!} className="gcs-acpRail__icon" />
                  <span className="gcs-acpRail__label">{area.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
