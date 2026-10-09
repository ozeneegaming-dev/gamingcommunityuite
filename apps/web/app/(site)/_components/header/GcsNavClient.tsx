"use client";

import {
  faBars,
  faBell,
  faCheck,
  faChevronDown,
  faEllipsis,
  faEnvelope,
  faGear,
  faHouse,
  faLanguage,
  faMagnifyingGlass,
  faPaintbrush,
  faRightFromBracket,
  faScrewdriverWrench,
  faShieldHalved,
  faTableColumns,
  faUser,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { gcsToast, GcsDropdown, GcsIconSvg, type GcsDropdownItem } from "@gcs/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { fitCount, navActive, withoutDuplicateChildren } from "@/lib/nav-match";
import { useErrorMessage } from "@/lib/use-error-message";
import { setLocale } from "../../actions";
import { openPageEditor } from "../../edit-actions";

/** Un item de meniu gata de afișat (iconița vine randată de pe server). */
export type GcsNavEntry = { id: number; label: string; href: string; icon: ReactNode; newTab: boolean; children: GcsNavEntry[] };

/** Header-ul devine compact și estompat (blur) după primii pixeli de derulare. */
export function GcsHeaderScroll() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".gcs-siteHeader");
    if (!header) return;
    const onScroll = () => header.classList.toggle("gcs-siteHeader--scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return null;
}

/**
 * `home`: pagina aplicației de pornire (specul 2026-10-09-acp-navigatie-aplicatii §2.3), dacă nu e Forumul; pe `/`,
 * itemul ei din meniu e cel activ.
 */
type NavProps = { items: GcsNavEntry[]; label: string; moreLabel: string; home?: string | undefined };

/** Calea după care se alege linkul activ: pe `/`, pagina aplicației de pornire. */
const activePath = (pathname: string, home: string | undefined) => (pathname === "/" && home ? home : pathname);

/** `useSearchParams` cere un Suspense; rezerva (fără parametri) e aceeași componentă. */
function withSearch<P extends object>(Inner: (props: P & { search: string }) => ReactNode) {
  function WithParams(props: P) {
    const params = useSearchParams();
    return <Inner {...props} search={params.toString()} />;
  }
  return function WithSearch(props: P) {
    return (
      <Suspense fallback={<Inner {...props} search="" />}>
        <WithParams {...props} />
      </Suspense>
    );
  };
}

/**
 * Meniul principal (desktop): itemii cu submeniu devin dropdown-uri, iar butoanele care nu încap (de la coadă) trec în
 * „Mai mult” (priority+). Lățimile se măsoară pe butoanele reale: cele mutate rămân în DOM, scoase din flux și inerte.
 * Până la hidratare bara taie ce nu încape (`overflow: hidden`), deci nu acoperă uneltele din dreapta.
 */
function NavBar({ items, label, moreLabel, home, search }: NavProps & { search: string }) {
  const pathname = usePathname();
  const { isActive } = navActive(items, activePath(pathname, home), search);
  const nav = useRef<HTMLElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const shown = fit ?? items.length;

  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => {
      const width = (n: Element | null) => n?.getBoundingClientRect().width ?? 0;
      const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
      setFit(fitCount([...el.querySelectorAll(":scope > [data-nav-item]")].map(width), width(el.querySelector(":scope > [data-nav-more]")), gap, el.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Fonturile temei se încarcă după prima randare și schimbă lățimea butoanelor.
    let alive = true;
    void document.fonts?.ready.then(() => alive && measure());
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [items]);

  const link = (c: GcsNavEntry): GcsDropdownItem => ({ kind: "link", label: c.label, href: c.href, icon: c.icon, active: isActive(c) });
  const overflow = items.slice(shown);
  // În „Mai mult”, un subitem care repetă un item mutat tot acolo (ex. Clasament sub Membri) nu se mai afișează.
  const moreItems = withoutDuplicateChildren(overflow).flatMap<GcsDropdownItem>((item) => (item.children.length > 0 ? [{ kind: "heading", label: item.label }, ...item.children.map(link)] : [link(item)]));
  const slot = (hidden: boolean) => ({ className: `gcs-navbar__item${hidden ? " gcs-navbar__item--hidden" : ""}`, "aria-hidden": hidden || undefined, inert: hidden || undefined });

  return (
    <nav ref={nav} aria-label={label} className="gcs-navbar__menu" data-ready={fit === null ? undefined : ""}>
      {items.map((item, i) => (
        <div key={item.id} data-nav-item="" {...slot(i >= shown)}>
          {item.children.length > 0 ? (
            <GcsDropdown
              label={item.label}
              align="start"
              triggerClassName={`gcs-nav__link${isActive(item) ? " gcs-nav__link--active" : ""}`}
              trigger={
                <>
                  {item.icon}
                  <span>{item.label}</span>
                  <GcsIconSvg icon={faChevronDown} className="gcs-navbar__caret" />
                </>
              }
              items={item.children.map(link)}
              testId={`gcs-nav-menu-${item.id}`}
            />
          ) : (
            <Link
              href={item.href}
              className={`gcs-nav__link${isActive(item) ? " gcs-nav__link--active" : ""}`}
              aria-current={isActive(item) ? "page" : undefined}
              {...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          )}
        </div>
      ))}
      <div data-nav-more="" {...slot(overflow.length === 0)}>
        <GcsDropdown
          label={moreLabel}
          align="end"
          triggerClassName={`gcs-nav__link${overflow.some((i) => isActive(i)) ? " gcs-nav__link--active" : ""}`}
          trigger={
            <>
              <GcsIconSvg icon={faEllipsis} />
              <span>{moreLabel}</span>
            </>
          }
          items={moreItems}
          testId="gcs-nav-more"
        />
      </div>
    </nav>
  );
}

export const GcsNavLinks = withSearch<NavProps>(NavBar);

type TrailProps = { items: GcsNavEntry[]; home?: string | undefined; labels: { home: string; trail: string } };

/**
 * Breadcrumb-ul generic din rândul de sub antet (designul Nova): Acasă › secțiunea activă din meniul principal
 * (› subitemul activ). Paginile cu un breadcrumb propriu (forum, topic, servere…) îl pun peste acesta, din CSS.
 */
function CrumbTrail({ items, home, labels, search }: TrailProps & { search: string }) {
  const pathname = usePathname();
  const { href } = navActive(items, activePath(pathname, home), search);
  const parent = href ? items.find((i) => i.children.some((c) => c.href === href) && !items.some((t) => t.children.length === 0 && t.href === href)) : undefined;
  const leaf = href ? (parent?.children.find((c) => c.href === href) ?? items.find((i) => i.children.length === 0 && i.href === href)) : undefined;
  const atHome = pathname === "/" && (!leaf || leaf.href === (home ?? "/"));
  return (
    <nav aria-label={labels.trail} className="gcs-breadcrumb gcs-crumbBar__trail" data-testid="gcs-crumb-trail">
      <ol>
        <li>
          <Link href="/" aria-current={atHome ? "page" : undefined}>
            <GcsIconSvg icon={faHouse} className="gcs-breadcrumb__home" />
            {labels.home}
          </Link>
        </li>
        {!atHome && parent && (
          <li>
            <span>{parent.label}</span>
          </li>
        )}
        {!atHome && leaf && (
          <li>
            <Link href={leaf.href} aria-current={pathname === leaf.href.split("?")[0] ? "page" : undefined}>
              {leaf.label}
            </Link>
          </li>
        )}
      </ol>
    </nav>
  );
}

export const GcsCrumbTrail = withSearch<TrailProps>(CrumbTrail);

/** Căutarea din header: o iconiță care se deschide într-un câmp (pe ecranele mici). */
export function GcsHeaderSearch({ label, placeholder }: { label: string; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  return (
    <form action="/search" method="get" role="search" className={`gcs-headerSearch${open ? " gcs-headerSearch--open" : ""}`}>
      <label htmlFor="gcs-site-search" className="gcs-srOnly">
        {label}
      </label>
      <input
        ref={input}
        id="gcs-site-search"
        name="q"
        type="search"
        placeholder={placeholder}
        className="gcs-headerSearch__input"
        onBlur={(e) => {
          if (!e.currentTarget.value) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <button type={open ? "submit" : "button"} className="gcs-headerIcon gcs-headerSearch__button" aria-label={label} onClick={() => !open && setOpen(true)}>
        <GcsIconSvg icon={faMagnifyingGlass} />
      </button>
    </form>
  );
}

export type GcsUserMenuLabels = {
  menu: string;
  profile: string;
  messages: string;
  notifications: string;
  settings: string;
  acp: string;
  themeEditor: string;
  pageEditor: string;
  moderation: string;
  logout: string;
};

const submit = (action: (fd: FormData) => Promise<void>, name: string, value: string) => {
  const fd = new FormData();
  fd.set(name, value);
  return action(fd);
};

/** Paginile cu zone de widget-uri: indexul, forumurile și topicurile. */
const WIDGET_PATHS = /^\/(?:$|forum\/|topic\/)/;

export type GcsUserMenuLinks = {
  profile: string;
  acp: boolean;
  moderation: boolean;
  /** Editorul vizual al temei afișate (doar cu drept pe teme). */
  themeEditor: string | null;
  /** Modul „Editează pagina” (doar cu drept pe widget-uri). */
  pageEditor: boolean;
};

/**
 * Meniul userului (dropdown): linkurile de bază, apoi uneltele staff-ului (editorul de temă, editorul de pagină,
 * moderarea, ACP), fiecare doar cu dreptul lui, și ieșirea. Tema și limba se schimbă din footer (pentru toată lumea).
 */
export function GcsUserMenu({
  trigger,
  links,
  labels,
  extra = [],
}: {
  trigger: ReactNode;
  links: GcsUserMenuLinks;
  labels: GcsUserMenuLabels;
  /** Intrările pluginurilor (etapa 6), după linkurile de bază; iconițele vin randate de pe server. */
  extra?: { key: string; label: string; href: string; icon: ReactNode }[];
}) {
  const [, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const errorMessage = useErrorMessage();
  const icon = (def: Parameters<typeof GcsIconSvg>[0]["icon"]) => <GcsIconSvg icon={def} />;
  /** Pornește „Editează pagina” aici sau, pe o pagină fără widget-uri, pe pagina principală. */
  const editPage = () =>
    start(async () => {
      const res = await openPageEditor({});
      // Fără sesiune ACP proaspătă (2FA), adminul se reautentifică întâi.
      if (!res.ok && res.error.params?.reason === "acp_gate") return router.push("/admin/reauth");
      if (!res.ok) {
        gcsToast({ title: errorMessage(res.error), icon: icon(faTableColumns) });
        return;
      }
      if (WIDGET_PATHS.test(pathname)) router.refresh();
      else router.push("/");
    });
  const staff = Boolean(links.themeEditor) || links.pageEditor || links.moderation || links.acp;
  const items: GcsDropdownItem[] = [
    { kind: "link", label: labels.profile, href: links.profile, icon: icon(faUser), testId: "gcs-menu-profile" },
    { kind: "link", label: labels.messages, href: "/messages", icon: icon(faEnvelope) },
    { kind: "link", label: labels.notifications, href: "/notifications", icon: icon(faBell) },
    { kind: "link", label: labels.settings, href: "/settings/profile", icon: icon(faGear), testId: "gcs-menu-settings" },
    ...extra.map((e) => ({ kind: "link", label: e.label, href: e.href, icon: e.icon, testId: `gcs-menu-plugin-${e.key}` }) as const),
    ...(staff ? [{ kind: "separator" } as const] : []),
    ...(links.themeEditor ? [{ kind: "link", label: labels.themeEditor, href: links.themeEditor, icon: icon(faPaintbrush), testId: "gcs-menu-theme-editor" } as const] : []),
    ...(links.pageEditor ? [{ kind: "action", label: labels.pageEditor, onSelect: editPage, icon: icon(faTableColumns), testId: "gcs-menu-page-editor" } as const] : []),
    ...(links.moderation ? [{ kind: "link", label: labels.moderation, href: "/admin/members/moderation/queue", icon: icon(faShieldHalved), testId: "gcs-menu-moderation" } as const] : []),
    ...(links.acp ? [{ kind: "link", label: labels.acp, href: "/admin", icon: icon(faScrewdriverWrench), testId: "gcs-menu-acp" } as const] : []),
    { kind: "separator" },
    {
      kind: "action",
      label: labels.logout,
      icon: icon(faRightFromBracket),
      onSelect: () =>
        start(async () => {
          await authClient.signOut();
          window.location.assign("/");
        }),
      testId: "gcs-menu-logout",
    },
  ];
  return <GcsDropdown label={labels.menu} trigger={trigger} items={items} triggerClassName="gcs-userMenu__trigger" testId="gcs-user-menu" />;
}

/** Selectorul de limbă și temă pentru vizitatori (în header și în footer). */
export function GcsGuestPrefs({ locales, currentLocale, labels }: { locales: { code: string; label: string }[]; currentLocale: string; labels: { language: string } }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <GcsDropdown
      // Numele accesibil conține și textul vizibil (codul limbii), cum cer cititoarele de ecran și comenzile vocale.
      label={`${labels.language}: ${currentLocale.toUpperCase()}`}
      trigger={
        <span className="gcs-guestLocale">
          <GcsIconSvg icon={faLanguage} />
          {currentLocale.toUpperCase()}
        </span>
      }
      items={locales.map((l) => ({
        kind: "action",
        label: l.label,
        icon: currentLocale === l.code ? <GcsIconSvg icon={faCheck} /> : <GcsIconSvg icon={faLanguage} />,
        onSelect: () =>
          start(async () => {
            await submit(setLocale, "locale", l.code);
            router.refresh();
          }),
        testId: `gcs-guest-locale-${l.code}`,
      }))}
      testId="gcs-guest-locale"
    />
  );
}

type MobileNavProps = {
  items: GcsNavEntry[];
  extra: { href: string; label: string; icon?: ReactNode }[];
  labels: { open: string; close: string; menu: string };
  home?: string | undefined;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Meniul de pe mobil: un sertar lateral (dialog modal) cu meniul principal și linkurile contului. Un item cu submeniu e un
 * buton-dezvăluire (deschis din start dacă pagina curentă e în el); subitemii care repetă un link de pe primul nivel nu
 * se mai afișează. Tab rămâne în sertar; Escape, butonul de închidere sau un click în afară readuc focusul pe ☰.
 */
function MobileNav({ items, extra, labels, home, search }: MobileNavProps & { search: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const tree = withoutDuplicateChildren(items);
  const { isActive } = navActive(tree, activePath(pathname, home), search);
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  useEffect(() => setOpen(false), [pathname, search]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(".gcs-drawer__nav a, .gcs-drawer__nav button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        opener.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const list = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const linkProps = (i: GcsNavEntry, className: string) => ({
    href: i.href,
    className: `${className}${isActive(i) ? " gcs-drawer__link--active" : ""}`,
    "aria-current": isActive(i) ? ("page" as const) : undefined,
    ...(i.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {}),
  });
  return (
    <>
      <button ref={opener} type="button" className="gcs-headerIcon gcs-mobileNav__open" aria-label={labels.open} aria-expanded={open} onClick={() => setOpen(true)} data-testid="gcs-mobile-nav">
        <GcsIconSvg icon={faBars} />
      </button>
      {open && (
        <div className="gcs-drawer" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div ref={panel} className="gcs-drawer__panel" role="dialog" aria-modal="true" aria-label={labels.menu}>
            <button type="button" className="gcs-headerIcon gcs-drawer__close" aria-label={labels.close} onClick={close}>
              <GcsIconSvg icon={faXmark} />
            </button>
            <nav aria-label={labels.menu} className="gcs-drawer__nav">
              {tree.map((i) =>
                i.children.length > 0 ? (
                  <GcsDrawerGroup key={i.id} item={i} active={isActive(i)}>
                    {i.children.map((c) => (
                      <Link key={c.id} {...linkProps(c, "gcs-drawer__link gcs-drawer__link--sub")}>
                        {c.icon}
                        <span>{c.label}</span>
                      </Link>
                    ))}
                  </GcsDrawerGroup>
                ) : (
                  <Link key={i.id} {...linkProps(i, "gcs-drawer__link")}>
                    {i.icon}
                    <span>{i.label}</span>
                  </Link>
                ),
              )}
              {extra.length > 0 && <hr className="gcs-drawer__sep" />}
              {extra.map((e) => (
                <Link key={e.href} href={e.href} className="gcs-drawer__link">
                  {e.icon}
                  <span>{e.label}</span>
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

/** Un submeniu în sertar: butonul (cu `aria-expanded`) și subitemii, indentați pe o linie verticală. */
function GcsDrawerGroup({ item, active, children }: { item: GcsNavEntry; active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(active);
  const id = useId();
  return (
    <div className="gcs-drawer__group">
      <button
        type="button"
        className={`gcs-drawer__link gcs-drawer__toggle${active ? " gcs-drawer__link--active" : ""}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        data-testid={`gcs-drawer-group-${item.id}`}
      >
        {item.icon}
        <span>{item.label}</span>
        <GcsIconSvg icon={faChevronDown} className="gcs-drawer__caret" />
      </button>
      <div id={id} className="gcs-drawer__sub" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

export const GcsMobileNav = withSearch<MobileNavProps>(MobileNav);
