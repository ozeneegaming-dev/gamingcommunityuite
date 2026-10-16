"use client";

import { faChevronDown, faEllipsis } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fitCount, navActive } from "@/lib/nav-match";
import { useHeaderPopover } from "./GcsHeaderPopover";
import { useHeaderState } from "./header-context";

export type GcsMegaEntry = {
  id: number;
  label: string;
  href: string;
  newTab: boolean;
  icon: ReactNode;
  description: string | null;
  /** Insigna (fixă din Manager meniu sau live dintr-o aplicație): textul și tonul. */
  badge: { text: string; tone: "live" | "soft" | "new" } | null;
  /** Rândul de jos al mega meniului (doar itemii cu submeniu): o linie live și un îndemn. */
  footer: { line: string; cta: { label: string; href: string } } | null;
  children: GcsMegaEntry[];
};

type Props = { items: GcsMegaEntry[]; label: string; moreLabel: string; home?: string | undefined; testId?: string };

const linkProps = (i: { href: string; newTab: boolean }) => (i.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {});

/** Un item cu submeniu: butonul și panoul (mega meniu pe 2 coloane sau o listă simplă). */
function MegaItem({ item, active, activeHref }: { item: GcsMegaEntry; active: boolean; activeHref: string | null }) {
  const { dropdowns, mega } = useHeaderState();
  const pop = useHeaderPopover({ mode: dropdowns, menu: true });
  const pathname = usePathname();
  useEffect(() => pop.close(false), [pathname]);
  return (
    <div className="gcs-hb__pop gcs-mega" {...pop.rootProps}>
      <button {...pop.triggerProps} className={`gcs-hb__nav${active ? " gcs-hb__nav--active" : ""}`} aria-haspopup="menu" data-testid={`gcs-nav-menu-${item.id}`}>
        {item.icon}
        <span>{item.label}</span>
        <GcsIconSvg icon={faChevronDown} className="gcs-hb__caret" />
      </button>
      {pop.mounted && (
        <div {...pop.panelProps} role="menu" aria-label={item.label} className={`gcs-hb__panel ${mega ? "gcs-mega__panel" : "gcs-hb__menu"}`} data-testid={`gcs-mega-${item.id}`}>
          <div className={mega ? "gcs-mega__grid" : "gcs-mega__list"}>
            {item.children.map((c) => (
              <Link
                key={c.id}
                href={c.href}
                role="menuitem"
                className={`${mega ? "gcs-mega__item" : "gcs-hb__menuItem"}${c.href === activeHref ? " gcs-mega__item--active" : ""}`}
                aria-current={c.href === activeHref ? "page" : undefined}
                onClick={() => pop.close(false)}
                data-testid="gcs-mega-item"
                {...linkProps(c)}
              >
                <span className={mega ? "gcs-mega__icon" : "gcs-hb__menuIcon"} aria-hidden="true">
                  {c.icon}
                </span>
                <span className="gcs-mega__text">
                  <span className="gcs-mega__title">
                    {c.label}
                    {c.badge && (
                      <span className={`gcs-mega__badge gcs-mega__badge--${c.badge.tone}`} data-testid="gcs-mega-badge">
                        {c.badge.text}
                      </span>
                    )}
                  </span>
                  {mega && c.description && <span className="gcs-mega__desc">{c.description}</span>}
                </span>
              </Link>
            ))}
          </div>
          {mega && item.footer && (
            <div className="gcs-mega__foot">
              <span className="gcs-mega__line">{item.footer.line}</span>
              <Link href={item.footer.cta.href} className="gcs-btn gcs-btn--primary gcs-btn--sm" onClick={() => pop.close(false)} data-testid="gcs-mega-cta">
                {item.footer.cta.label}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** „Mai mult”: itemii care nu încap pe bară, într-o listă simplă. */
function MoreItem({ items, label, active, activeHref }: { items: GcsMegaEntry[]; label: string; active: boolean; activeHref: string | null }) {
  const { dropdowns } = useHeaderState();
  const pop = useHeaderPopover({ mode: dropdowns, menu: true });
  return (
    <div className="gcs-hb__pop" {...pop.rootProps}>
      <button {...pop.triggerProps} className={`gcs-hb__nav${active ? " gcs-hb__nav--active" : ""}`} aria-haspopup="menu" data-testid="gcs-nav-more">
        <GcsIconSvg icon={faEllipsis} />
        <span>{label}</span>
      </button>
      {pop.mounted && (
        <div {...pop.panelProps} role="menu" aria-label={label} className="gcs-hb__panel gcs-hb__menu">
          {items.flatMap((i) =>
            (i.children.length > 0 ? i.children : [i]).map((c) => (
              <Link
                key={`${i.id}-${c.id}`}
                href={c.href}
                role="menuitem"
                className="gcs-hb__menuItem"
                aria-current={c.href === activeHref ? "page" : undefined}
                onClick={() => pop.close(false)}
                {...linkProps(c)}
              >
                <span className="gcs-hb__menuIcon" aria-hidden="true">
                  {c.icon}
                </span>
                <span className="gcs-hb__menuLabel">{c.label}</span>
              </Link>
            )),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Parametrii adresei (pentru linkul activ cu parametri, ex. „Online acum”), citiți în browser după fiecare pagină.
 * Fără `useSearchParams`: acela cere un Suspense, iar rezerva randată pe server lăsa o copie ascunsă a meniului.
 */
function useLocationSearch(): string {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(window.location.search.replace(/^\?/, "")), [pathname]);
  return search;
}

function Bar({ items, label, moreLabel, home, testId }: Props) {
  const pathname = usePathname();
  const search = useLocationSearch();
  // Panoul lateral (desktop): meniul e vertical, deci toți itemii rămân (fără „Mai mult”).
  const { preset, device } = useHeaderState();
  const vertical = preset === "side" && device === "desktop";
  const { isActive, href } = navActive(items, pathname === "/" && home ? home : pathname, search);
  const nav = useRef<HTMLElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const shown = fit ?? items.length;

  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    if (vertical) {
      setFit(items.length);
      return;
    }
    const measure = () => {
      const width = (n: Element | null) => n?.getBoundingClientRect().width ?? 0;
      const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
      setFit(fitCount([...el.querySelectorAll(":scope > [data-nav-item]")].map(width), width(el.querySelector(":scope > [data-nav-more]")), gap, el.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    let alive = true;
    void document.fonts?.ready.then(() => alive && measure());
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [items, vertical]);

  const slot = (hidden: boolean) => ({ className: `gcs-hb__navSlot${hidden ? " gcs-hb__navSlot--hidden" : ""}`, "aria-hidden": hidden || undefined, inert: hidden || undefined });
  const overflow = items.slice(shown);
  return (
    <nav ref={nav} aria-label={label} className="gcs-hb__navBar" data-ready={fit === null ? undefined : ""} data-testid={testId}>
      {items.map((item, i) => (
        <div key={item.id} data-nav-item="" {...slot(i >= shown)}>
          {item.children.length > 0 ? (
            <MegaItem item={item} active={isActive(item)} activeHref={href} />
          ) : (
            <Link href={item.href} className={`gcs-hb__nav${isActive(item) ? " gcs-hb__nav--active" : ""}`} aria-current={isActive(item) ? "page" : undefined} {...linkProps(item)}>
              {item.icon}
              <span>{item.label}</span>
            </Link>
          )}
        </div>
      ))}
      <div data-nav-more="" {...slot(overflow.length === 0)}>
        {/* Pagina curentă e în „Mai mult”: butonul lui e activ. */}
        <MoreItem items={overflow} label={moreLabel} active={overflow.some((i) => isActive(i))} activeHref={href} />
      </div>
    </nav>
  );
}

/**
 * Meniul principal al antetului construit (desktop): itemii cu submeniu devin mega meniuri (2 coloane: iconița, titlul,
 * descrierea de un rând, insigna live; jos, o linie live și un îndemn) sau liste simple; ce nu încape trece în
 * „Mai mult”. Meniul împărțit (Esports) folosește două instanțe, stânga și dreapta logo-ului.
 */
export function GcsMegaNav(props: Props) {
  return <Bar {...props} />;
}
