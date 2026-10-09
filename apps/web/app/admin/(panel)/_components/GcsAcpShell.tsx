"use client";

import { faBars } from "@fortawesome/free-solid-svg-icons";
import { acpAreaForPath } from "@gcs/core/acp-areas";
import { cx, GcsIconSvg } from "@gcs/ui";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACP_AREA_COOKIE, ACP_COLUMN_COOKIE, ACP_NAV_COOKIE_MAX_AGE } from "./acp-nav";
import { GcsAcpNavProvider } from "./GcsAcpBreadcrumb";
import { GcsAcpColumn } from "./GcsAcpColumn";
import { GcsAcpRail } from "./GcsAcpRail";
import type { GcsAcpNavArea, GcsAcpNavItem } from "./types";

const MOBILE_QUERY = "(max-width: 900px)";
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  areas: GcsAcpNavArea[];
  dashboard: GcsAcpNavItem | null;
  /** Din cookie-uri: ultima zonă afișată și coloana restrânsă (prima randare e deja cea corectă). */
  initialArea: string | null;
  initialCollapsed: boolean;
  brand: ReactNode;
  siteName: string;
  adminCard: ReactNode;
  /** Bara de sus, în dreapta hamburgerului: căutarea, „Vezi site-ul”, notificările, tema, contul. */
  topbar: ReactNode;
  labels: { rail: string; menu: string; closeMenu: string; collapse: string; drawer: string; breadcrumb: string; home: string; skip: string };
  children: ReactNode;
};

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/admin; max-age=${ACP_NAV_COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * Structura ACP (specul 2026-10-09-acp-navigatie-aplicatii §1): bara de iconițe cu zonele, coloana a doua cu paginile
 * zonei, bara de sus și conținutul. Coloana arată zona paginii curente (pe Dashboard, ultima zonă folosită); se
 * restrânge din hamburger sau din antetul ei. Pe ecrane înguste, bara și coloana devin un sertar (dialog modal), cu
 * focus captiv și Escape pentru închidere.
 */
export function GcsAcpShell({ areas, dashboard, initialArea, initialCollapsed, brand, siteName, adminCard, topbar, labels, children }: Props) {
  const pathname = usePathname();
  const side = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobile, setMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const current = useMemo(() => acpAreaForPath(areas, pathname), [areas, pathname]);
  const known = (key: string | null) => (key && areas.some((a) => a.key === key) ? key : null);
  const [selected, setSelected] = useState<string | null>(() => current?.area ?? known(initialArea) ?? areas[0]?.key ?? null);
  const dashboardActive = dashboard !== null && pathname === dashboard.href;

  // Lățimea ecranului se citește doar în browser (după hidratare).
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // La navigare: coloana arată zona paginii noi (ținută minte), iar sertarul se închide.
  useEffect(() => {
    if (current) {
      setSelected(current.area);
      writeCookie(ACP_AREA_COOKIE, current.area);
    }
    setDrawerOpen(false);
  }, [pathname, current]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    toggle.current?.focus();
  }, []);

  // Sertarul deschis: focusul intră în el, rămâne captiv (Tab / Shift+Tab), Escape îl închide.
  useEffect(() => {
    if (!mobile || !drawerOpen) return;
    const root = side.current;
    root?.querySelector<HTMLElement>('[data-rail-item][tabindex="0"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDrawer();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobile, drawerOpen, closeDrawer]);

  function setColumn(next: boolean) {
    setCollapsed(next);
    writeCookie(ACP_COLUMN_COOKIE, next ? "collapsed" : "expanded");
  }

  function onMenuButton() {
    if (mobile) setDrawerOpen((v) => !v);
    else setColumn(!collapsed);
  }

  function onSelect(area: string) {
    setSelected(area);
    writeCookie(ACP_AREA_COOKIE, area);
    // Restrânsă, coloana se redeschide cu zona aleasă.
    if (collapsed && !mobile) setColumn(false);
  }

  function onHideColumn() {
    if (mobile) closeDrawer();
    else {
      setColumn(true);
      toggle.current?.focus();
    }
  }

  const nav = useMemo(
    () => ({ areas, home: { href: dashboard?.href ?? "/admin", label: labels.home }, labels: { breadcrumb: labels.breadcrumb } }),
    [areas, dashboard, labels.home, labels.breadcrumb],
  );
  // Fără nicio zonă (ex. un admin cu drept doar pe Dashboard), coloana lipsește.
  const columnOpen = areas.length > 0 && (mobile || !collapsed);
  const modal = mobile && drawerOpen;
  const area = areas.find((a) => a.key === selected) ?? null;

  return (
    <GcsAcpNavProvider value={nav}>
      <a href="#gcs-acp-content" className="gcs-skipLink" data-testid="gcs-acp-skip">
        {labels.skip}
      </a>
      <div className={cx("gcs-acpShell", !columnOpen && "gcs-acpShell--collapsed")}>
        <div
          className={cx("gcs-acpShell__backdrop", modal && "gcs-acpShell__backdrop--open")}
          aria-hidden="true"
          data-testid="gcs-acp-backdrop"
          onClick={closeDrawer}
        />
        <aside
          ref={side}
          id="gcs-acp-sidebar"
          className={cx("gcs-acpSide", modal && "gcs-acpSide--open")}
          data-testid="gcs-acp-sidebar"
          data-collapsed={columnOpen ? "false" : "true"}
          {...(modal ? { role: "dialog", "aria-modal": true, "aria-label": labels.drawer } : {})}
          inert={mobile && !drawerOpen}
        >
          <GcsAcpRail
            areas={areas}
            dashboard={dashboard}
            selected={selected}
            current={current?.area ?? null}
            dashboardActive={dashboardActive}
            columnOpen={columnOpen}
            onSelect={onSelect}
            brand={brand}
            labels={{ rail: labels.rail }}
          />
          <div className="gcs-acpSide__column" hidden={!columnOpen}>
            <GcsAcpColumn
              area={area}
              activeKey={current?.item ?? null}
              siteName={siteName}
              mobile={mobile}
              onHide={onHideColumn}
              adminCard={adminCard}
              labels={{ collapse: labels.collapse, closeMenu: labels.closeMenu }}
            />
          </div>
        </aside>
        <div className="gcs-acpMain">
          <header className="gcs-acpTop">
            <button
              ref={toggle}
              type="button"
              className="gcs-acpTop__menu"
              aria-label={labels.menu}
              aria-controls="gcs-acp-sidebar"
              aria-expanded={mobile ? drawerOpen : !collapsed}
              data-testid="gcs-acp-menu-toggle"
              onClick={onMenuButton}
            >
              <GcsIconSvg icon={faBars} />
            </button>
            {topbar}
          </header>
          <main id="gcs-acp-content" tabIndex={-1} className="gcs-acpContent">
            {children}
          </main>
        </div>
      </div>
    </GcsAcpNavProvider>
  );
}
