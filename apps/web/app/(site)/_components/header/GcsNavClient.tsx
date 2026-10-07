"use client";

import {
  faBars,
  faBell,
  faCheck,
  faChevronDown,
  faEnvelope,
  faGear,
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
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { useErrorMessage } from "@/lib/use-error-message";
import { setLocale } from "../../actions";
import { openPageEditor } from "../../edit-actions";

/** Un item de meniu gata de afișat (iconița vine randată de pe server). */
export type GcsNavEntry = { id: number; label: string; href: string; icon: ReactNode; newTab: boolean; children: GcsNavEntry[] };

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

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

/** Meniul principal (desktop): itemii cu submeniu devin dropdown-uri. */
export function GcsNavLinks({ items, label }: { items: GcsNavEntry[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="gcs-navbar__menu">
      {items.map((item) =>
        item.children.length > 0 ? (
          <GcsDropdown
            key={item.id}
            label={item.label}
            align="start"
            triggerClassName="gcs-nav__link"
            trigger={
              <>
                {item.icon}
                <span>{item.label}</span>
                <GcsIconSvg icon={faChevronDown} className="gcs-navbar__caret" />
              </>
            }
            items={item.children.map<GcsDropdownItem>((c) => ({ kind: "link", label: c.label, href: c.href, icon: c.icon }))}
          />
        ) : (
          <Link
            key={item.id}
            href={item.href}
            className={`gcs-nav__link${isActive(pathname, item.href) ? " gcs-nav__link--active" : ""}`}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
            {...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ),
      )}
    </nav>
  );
}

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

/** Meniul de pe mobil: un sertar lateral cu meniul principal și linkurile contului. */
export function GcsMobileNav({
  items,
  extra,
  labels,
}: {
  items: GcsNavEntry[];
  extra: { href: string; label: string; icon?: ReactNode }[];
  labels: { open: string; close: string; menu: string };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const flat = items.flatMap((i) => (i.children.length > 0 ? i.children : [i]));
  return (
    <>
      <button type="button" className="gcs-headerIcon gcs-mobileNav__open" aria-label={labels.open} aria-expanded={open} onClick={() => setOpen(true)} data-testid="gcs-mobile-nav">
        <GcsIconSvg icon={faBars} />
      </button>
      {open && (
        <div className="gcs-drawer" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div ref={panel} className="gcs-drawer__panel" role="dialog" aria-modal="true" aria-label={labels.menu}>
            <button type="button" className="gcs-headerIcon gcs-drawer__close" aria-label={labels.close} onClick={() => setOpen(false)}>
              <GcsIconSvg icon={faXmark} />
            </button>
            <nav aria-label={labels.menu} className="gcs-drawer__nav">
              {flat.map((i) => (
                <Link key={i.id} href={i.href} className={`gcs-drawer__link${isActive(pathname, i.href) ? " gcs-drawer__link--active" : ""}`}>
                  {i.icon}
                  <span>{i.label}</span>
                </Link>
              ))}
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
