"use client";

import { faChevronDown, faEllipsis, faLink } from "@fortawesome/free-solid-svg-icons";
import { headerNavHalves } from "@gcs/core/themes";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { isMegaSeparator, megaColumns, megaGridColumns, megaPlacement, megaStep } from "@/lib/mega-menu";
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
  /** „Link scurt” (ACP › Meniu): subitemul stă în coloana din dreapta a mega meniului, ca plăcuță. */
  shortLink: boolean;
  /** Insigna (fixă din Manager meniu sau live dintr-o aplicație): textul și tonul. */
  badge: { text: string; tone: "live" | "soft" | "new" } | null;
  /** Rândul de jos al mega meniului (doar itemii cu submeniu): o linie live și un îndemn. */
  footer: { line: string; cta: { label: string; href: string } } | null;
  children: GcsMegaEntry[];
};

/** `quickLabel`: numele coloanei din dreapta (linkurile scurte), pentru cititoarele de ecran. */
type Props = { items: GcsMegaEntry[]; label: string; moreLabel: string; quickLabel: string; home?: string | undefined; testId?: string };

const linkProps = (i: { href: string; newTab: boolean }) => (i.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {});

/** Iconița unui item de pe bară, în pătratul de 40 px (ascuns de setarea temei „Iconițe în meniul principal”). */
function NavIcon({ icon }: { icon: ReactNode }) {
  return icon ? (
    <span className="gcs-hb__navIcon" aria-hidden="true">
      {icon}
    </span>
  ) : null;
}

/** Ordinea itemului în panou (intrarea pe rând, câte 40 ms). */
const step = (n: number) => ({ "--n": n }) as CSSProperties;

function Badge({ badge }: { badge: GcsMegaEntry["badge"] }) {
  return badge ? (
    <span className={`gcs-mega__badge gcs-mega__badge--${badge.tone}`} data-testid="gcs-mega-badge">
      {badge.text}
    </span>
  ) : null;
}

/** Un item din grila mega meniului: iconița în căsuța de 44 px, titlul (cu insigna) și descrierea de un rând. */
function MegaCard({ item, n, active, onPick }: { item: GcsMegaEntry; n: number; active: boolean; onPick: () => void }) {
  return (
    <Link
      href={item.href}
      role="menuitem"
      className={`gcs-mega__item${active ? " gcs-mega__item--active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onPick}
      style={step(n)}
      data-testid="gcs-mega-item"
      {...linkProps(item)}
    >
      <span className="gcs-mega__icon" aria-hidden="true">
        {item.icon ?? <GcsIconSvg icon={faLink} />}
      </span>
      <span className="gcs-mega__text">
        <span className="gcs-mega__title">
          <span className="gcs-mega__name">{item.label}</span>
          <Badge badge={item.badge} />
        </span>
        {item.description && (
          <span className="gcs-mega__desc" data-testid="gcs-mega-desc">
            {item.description}
          </span>
        )}
      </span>
    </Link>
  );
}

/** Un link scurt din coloana din dreapta: plăcuța cu iconița deasupra și titlul dedesubt. */
function MegaTile({ item, n, active, onPick }: { item: GcsMegaEntry; n: number; active: boolean; onPick: () => void }) {
  return (
    <Link
      href={item.href}
      role="menuitem"
      className={`gcs-mega__tile${active ? " gcs-mega__tile--active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onPick}
      style={step(n)}
      data-testid="gcs-mega-short"
      {...linkProps(item)}
    >
      <span className="gcs-mega__tileIcon" aria-hidden="true">
        {item.icon ?? <GcsIconSvg icon={faLink} />}
      </span>
      <span className="gcs-mega__tileLabel">{item.label}</span>
      <Badge badge={item.badge} />
    </Link>
  );
}

/**
 * Un item cu submeniu: butonul (iconița în pătrat, eticheta, săgeata care se rotește) și panoul. Mega meniul: o grilă pe
 * 1–3 coloane (după câți itemi sunt), coloana opțională a linkurilor scurte, rândul de jos (linia live și îndemnul) și
 * săgeata de sus, care arată butonul; panoul se așază în ecran la deschidere. Fără mega meniuri (setarea temei): o listă
 * simplă. Tastatura: Enter / Space / ↓ îl deschid pe primul item, săgețile mută între itemi, Escape îl închide și
 * readuce focusul pe buton.
 */
function MegaItem({ item, active, activeHref, quickLabel }: { item: GcsMegaEntry; active: boolean; activeHref: string | null; quickLabel: string }) {
  const { dropdowns, mega, preset, device } = useHeaderState();
  const pop = useHeaderPopover({ mode: dropdowns, menu: true });
  const pathname = usePathname();
  useEffect(() => pop.close(false), [pathname]);
  // Panoul lateral (desktop): meniul e vertical, panoul se deschide în dreapta lui (din CSS).
  const vertical = preset === "side" && device === "desktop";
  const { items, short } = useMemo(() => megaColumns(item.children), [item.children]);
  const cols = megaGridColumns(items.filter((c) => !isMegaSeparator(c)).length);

  // Deschis din tastatură (și în modul „la hover”): focusul pe primul item.
  const fromKeyboard = useRef(false);
  const { open } = pop;
  const panelRef = pop.panelProps.ref;
  useEffect(() => {
    if (!open || !fromKeyboard.current) return;
    fromKeyboard.current = false;
    const t = setTimeout(() => panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, panelRef]);

  // Așezarea panoului în ecran și săgeata deasupra butonului (la deschidere și la redimensionarea ferestrei).
  const rootRef = pop.rootProps.ref;
  const triggerRef = pop.triggerProps.ref;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !mega || !panel) return;
    if (vertical) {
      panel.style.removeProperty("left");
      panel.style.removeProperty("right");
      panel.style.removeProperty("--gcs-mega-arrow");
      return;
    }
    const place = () => {
      const root = rootRef.current;
      const trigger = triggerRef.current;
      if (!root || !trigger) return;
      const t = trigger.getBoundingClientRect();
      const at = megaPlacement({
        triggerLeft: t.left,
        triggerWidth: t.width,
        originLeft: root.getBoundingClientRect().left,
        panelWidth: panel.offsetWidth,
        viewportWidth: document.documentElement.clientWidth,
      });
      panel.style.left = `${at.left}px`;
      panel.style.right = "auto";
      panel.style.setProperty("--gcs-mega-arrow", `${at.arrow}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, mega, vertical, panelRef, rootRef, triggerRef, items.length, short.length]);

  const onRootKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // ← / → mută și ele între itemi (grila are mai multe coloane); ↑ / ↓, Home / End, Escape și Tab: comportamentul comun.
    const panel = panelRef.current;
    if (open && panel && (e.key === "ArrowRight" || e.key === "ArrowLeft") && panel.contains(document.activeElement)) {
      const list = [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      const next = list[megaStep(list.length, list.indexOf(document.activeElement as HTMLElement), e.key === "ArrowRight" ? 1 : -1)];
      if (next) {
        e.preventDefault();
        next.focus();
      }
      return;
    }
    pop.rootProps.onKeyDown(e);
  };
  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) fromKeyboard.current = true;
    pop.triggerProps.onKeyDown(e);
  };
  const pick = () => pop.close(false);

  return (
    <div className="gcs-hb__pop gcs-mega" {...pop.rootProps} onKeyDown={onRootKeyDown}>
      <button
        {...pop.triggerProps}
        onKeyDown={onTriggerKeyDown}
        className={`gcs-hb__nav${active ? " gcs-hb__nav--active" : ""}`}
        aria-haspopup="menu"
        data-testid={`gcs-nav-menu-${item.id}`}
      >
        <NavIcon icon={item.icon} />
        <span className="gcs-hb__navLabel">{item.label}</span>
        <GcsIconSvg icon={faChevronDown} className="gcs-hb__caret" />
      </button>
      {pop.mounted &&
        (mega ? (
          <div
            {...pop.panelProps}
            role="menu"
            aria-label={item.label}
            className="gcs-hb__panel gcs-mega__panel"
            data-cols={cols}
            data-side={short.length > 0 ? "" : undefined}
            data-testid={`gcs-mega-${item.id}`}
          >
            <span className="gcs-mega__arrow" aria-hidden="true" data-testid="gcs-mega-arrow" />
            <div className="gcs-mega__in" role="none">
              <div className="gcs-mega__body" role="none">
                <div className="gcs-mega__grid" role="none">
                  {items.map((c, n) =>
                    isMegaSeparator(c) ? <span key={c.id} role="separator" className="gcs-mega__sep" /> : <MegaCard key={c.id} item={c} n={n} active={c.href === activeHref} onPick={pick} />,
                  )}
                </div>
                {short.length > 0 && (
                  <div role="group" aria-label={quickLabel} className="gcs-mega__side" data-testid="gcs-mega-side">
                    {short.map((c, n) => (
                      <MegaTile key={c.id} item={c} n={items.length + n} active={c.href === activeHref} onPick={pick} />
                    ))}
                  </div>
                )}
              </div>
              {item.footer && (
                <div className="gcs-mega__foot" role="none">
                  <span className="gcs-mega__line">{item.footer.line}</span>
                  <Link href={item.footer.cta.href} className="gcs-btn gcs-btn--primary gcs-btn--sm" onClick={pick} data-testid="gcs-mega-cta">
                    {item.footer.cta.label}
                  </Link>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div {...pop.panelProps} role="menu" aria-label={item.label} className="gcs-hb__panel gcs-hb__menu" data-testid={`gcs-mega-${item.id}`}>
            <div className="gcs-mega__list" role="none">
              {item.children.map((c) =>
                isMegaSeparator(c) ? (
                  <span key={c.id} role="separator" className="gcs-mega__sep" />
                ) : (
                  <Link
                    key={c.id}
                    href={c.href}
                    role="menuitem"
                    className={`gcs-hb__menuItem${c.href === activeHref ? " gcs-mega__item--active" : ""}`}
                    aria-current={c.href === activeHref ? "page" : undefined}
                    onClick={pick}
                    data-testid="gcs-mega-item"
                    {...linkProps(c)}
                  >
                    <span className="gcs-hb__menuIcon" aria-hidden="true">
                      {c.icon}
                    </span>
                    <span className="gcs-mega__title">
                      {c.label}
                      <Badge badge={c.badge} />
                    </span>
                  </Link>
                ),
              )}
            </div>
          </div>
        ))}
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
        <NavIcon icon={<GcsIconSvg icon={faEllipsis} />} />
        <span className="gcs-hb__navLabel">{label}</span>
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

function Bar({ items, label, moreLabel, quickLabel, home, testId }: Props) {
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
            <MegaItem item={item} active={isActive(item)} activeHref={href} quickLabel={quickLabel} />
          ) : (
            <Link href={item.href} className={`gcs-hb__nav${isActive(item) ? " gcs-hb__nav--active" : ""}`} aria-current={isActive(item) ? "page" : undefined} {...linkProps(item)}>
              <NavIcon icon={item.icon} />
              <span className="gcs-hb__navLabel">{item.label}</span>
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
 * Meniul principal al antetului construit (desktop): itemii cu submeniu devin mega meniuri (grila cu iconița, titlul,
 * descrierea de un rând și insigna live; coloana linkurilor scurte; jos, o linie live și un îndemn) sau liste simple;
 * ce nu încape trece în „Mai mult”. Meniul împărțit (Esports) folosește două instanțe, stânga și dreapta logo-ului;
 * jumătățile se calculează la client din aspectul curent, ca în previzualizarea editorului „Navigație (dreapta)” și
 * itemii aleși să apară live, fără să se publice întâi. Partea dreaptă e doar pe desktop (pe ecranele mici, sertarul
 * are tot meniul).
 */
export function GcsSplitNav({ side, items, ...props }: Props & { side: "left" | "right" }) {
  const { layout, device } = useHeaderState();
  const halves = useMemo(() => (layout ? headerNavHalves(layout, items) : { left: items, right: [] }), [layout, items]);
  const part = halves[side];
  if (side === "right" && (device !== "desktop" || part.length === 0)) return null;
  return <Bar items={part} {...props} />;
}
