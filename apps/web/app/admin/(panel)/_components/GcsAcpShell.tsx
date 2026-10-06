"use client";

import { faBars } from "@fortawesome/free-solid-svg-icons";
import { cx, GcsIconSvg } from "@gcs/ui";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GcsAcpNavProvider } from "./GcsAcpBreadcrumb";
import { GcsAcpSidebar } from "./GcsAcpSidebar";
import { activeGroup, activeItem, type GcsAcpNavGroup, type GcsAcpNavItem } from "./types";

/** Cheia din localStorage pentru sidebar-ul restrâns (o preferință a browserului, nu a contului). */
const COLLAPSED_KEY = "gcs-acp-sidebar";
const MOBILE_QUERY = "(max-width: 900px)";
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  groups: GcsAcpNavGroup[];
  dashboard: GcsAcpNavItem | null;
  brand: ReactNode;
  adminCard: ReactNode;
  /** Bara de sus, în dreapta hamburgerului: căutarea, „Vezi site-ul”, notificările, tema, contul. */
  topbar: ReactNode;
  labels: { nav: string; menu: string; closeMenu: string; drawer: string; breadcrumb: string; home: string };
  children: ReactNode;
};

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "collapsed";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    // Stocare indisponibilă (mod privat): alegerea ține doar până la reîncărcare.
  }
}

/**
 * Structura ACP (etapa 6 §1.1, după Nalika): sidebar-ul închis la culoare, bara de sus și conținutul. Pe desktop,
 * hamburgerul restrânge sidebar-ul la iconițe (ținut minte în localStorage; serverul randează mereu extins); pe
 * ecrane înguste deschide sertarul, cu fundal, focus captiv și Escape pentru închidere.
 */
export function GcsAcpShell({ groups, dashboard, brand, adminCard, topbar, labels, children }: Props) {
  const pathname = usePathname();
  const sidebar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeKey = activeItem([...groups.flatMap((g) => g.sections), ...(dashboard ? [{ app: "", title: "", items: [dashboard] }] : [])], pathname);
  const currentGroup = activeGroup(groups, pathname);
  const [open, setOpen] = useState<Set<string>>(() => new Set(currentGroup ? [currentGroup] : []));

  // Preferința salvată și lățimea ecranului se citesc doar în browser (după hidratare).
  useEffect(() => {
    setCollapsed(readCollapsed());
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // La navigare: grupul paginii curente se deschide, iar sertarul se închide.
  useEffect(() => {
    if (currentGroup) setOpen((prev) => (prev.has(currentGroup) ? prev : new Set(prev).add(currentGroup)));
    setDrawerOpen(false);
  }, [pathname, currentGroup]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    toggle.current?.focus();
  }, []);

  // Sertarul deschis: focusul intră în el, rămâne captiv (Tab / Shift+Tab), Escape îl închide.
  useEffect(() => {
    if (!mobile || !drawerOpen) return;
    const root = sidebar.current;
    root?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
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

  function onMenuButton() {
    if (mobile) {
      setDrawerOpen((v) => !v);
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(next);
  }

  function onToggleGroup(id: string) {
    // Restrâns: un click pe grup readuce sidebar-ul la lățimea întreagă, cu grupul deschis.
    if (collapsed && !mobile) {
      setCollapsed(false);
      writeCollapsed(false);
      setOpen((prev) => new Set(prev).add(id));
      return;
    }
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const nav = useMemo(
    () => ({ groups, home: { href: dashboard?.href ?? "/admin", label: labels.home }, labels: { breadcrumb: labels.breadcrumb } }),
    [groups, dashboard, labels.home, labels.breadcrumb],
  );
  const isCollapsed = collapsed && !mobile;

  return (
    <GcsAcpNavProvider value={nav}>
      <div className={cx("gcs-acpShell", isCollapsed && "gcs-acpShell--collapsed")}>
        <div
          className={cx("gcs-acpShell__backdrop", mobile && drawerOpen && "gcs-acpShell__backdrop--open")}
          aria-hidden="true"
          data-testid="gcs-acp-backdrop"
          onClick={closeDrawer}
        />
        <GcsAcpSidebar
          ref={sidebar}
          groups={groups}
          dashboard={dashboard}
          activeKey={activeKey}
          activeGroupId={currentGroup}
          open={open}
          onToggleGroup={onToggleGroup}
          collapsed={collapsed}
          drawer={{ mobile, open: drawerOpen, onClose: closeDrawer }}
          brand={brand}
          adminCard={adminCard}
          labels={{ nav: labels.nav, closeMenu: labels.closeMenu, drawer: labels.drawer }}
        />
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
          <main className="gcs-acpContent">{children}</main>
        </div>
      </div>
    </GcsAcpNavProvider>
  );
}
