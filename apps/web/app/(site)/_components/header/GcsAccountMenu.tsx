"use client";

import { faChevronDown, faChevronRight, faMoon, faRightFromBracket, faShieldHalved, faSun } from "@fortawesome/free-solid-svg-icons";
import { gcsToast, GcsAvatar, GcsIconSvg, GcsMemberName } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { GcsAccountItem, GcsAccountMenuData } from "@/lib/account-menu.server";
import { flyoutPlacement, panelMaxHeight } from "@/lib/account-menu-layout";
import type { GcsThemeToggle } from "@/lib/appearance";
import { authClient } from "@/lib/auth-client";
import { useErrorMessage } from "@/lib/use-error-message";
import { setLocale, setThemeMode } from "../../actions";
import { openPageEditor } from "../../edit-actions";
import { setPresenceStatus } from "../../header-actions";
import { GcsCountUp } from "./GcsCountUp";
import { useThemeSwitch } from "./GcsHeaderBits";
import { useHeaderPopover } from "./GcsHeaderPopover";
import { HEADER_EVENTS, useHeaderState } from "./header-context";

/** Paginile cu zone de widget-uri (ca în meniul userului clasic). */
const WIDGET_PATHS = /^\/(?:$|forum\/|topic\/)/;
const RING_R = 23;
/** Atributele `data-testid` ale itemilor (aceleași ca în meniul userului de dinainte, folosite de teste și de pluginuri). */
const ITEM_TEST_IDS: Record<string, string> = {
  profile: "gcs-menu-profile",
  account: "gcs-menu-settings",
  themeEditor: "gcs-menu-theme-editor",
  acp: "gcs-menu-acp",
  moderation: "gcs-menu-moderation",
};
const RING_C = 2 * Math.PI * RING_R;
/** Secțiunile afișate ca plăci pe 2 coloane; „Staff” e un singur rând care deschide submeniul. */
const TILE_SECTIONS = new Set(["content", "gaming", "settings"]);
/** Plăcile cu eticheta scurtă (`tiles.<cheie>`); textul întreg rămâne în tooltip. */
const SHORT_LABELS = new Set(["attachments", "privacy", "player"]);
/** Cât trebuie trasă în jos foaia de pe telefon (px) ca să se închidă; sub prag revine. */
const SWIPE_CLOSE = 80;
/** De la ce distanță (px) o apăsare pe antetul foii devine tragere (sub ea rămâne un click obișnuit). */
const SWIPE_START = 6;
const MENU_ITEM = '[role="menuitem"]';

const form = (name: string, value: string) => {
  const fd = new FormData();
  fd.set(name, value);
  return fd;
};

/** Inelul de XP din jurul avatarului (progresul spre nivelul următor) și insigna nivelului. */
export function GcsXpRing({ percent, level, children, size = 52 }: { percent: number; level: number; children: ReactNode; size?: number }) {
  const t = useTranslations("header.account");
  const dash = (RING_C * Math.max(0, Math.min(100, percent))) / 100;
  return (
    <span className="gcs-xpRing" style={{ width: size, height: size }}>
      <svg viewBox="0 0 52 52" aria-hidden="true" className="gcs-xpRing__svg">
        <circle cx="26" cy="26" r={RING_R} className="gcs-xpRing__track" />
        {dash > 0 && <circle cx="26" cy="26" r={RING_R} className="gcs-xpRing__fill" strokeDasharray={`${dash} ${RING_C}`} transform="rotate(-90 26 26)" />}
      </svg>
      <span className="gcs-xpRing__avatar">{children}</span>
      {level > 0 && <span className="gcs-xpRing__level">{t("levelShort", { level })}</span>}
    </span>
  );
}

/**
 * Meniul contului (specul 2026-10-10-hero-cockpit §3, varianta compactă aprobată pe 2026-11-03): avatarul cu inelul de
 * XP, insigna nivelului, numele stilizat și „x% până la Nv n”; la click, panoul: antetul pe 2 rânduri (avatarul cu
 * rama, numele cu culoarea grupului și pastilele grupurilor, statusul Online / Invizibil ca un comutator mic; nivelul,
 * bara subțire și cifrele ca text), secțiunile ca plăci pe 2 coloane (Conținutul meu, Gaming, Setări, Aplicații),
 * „Staff” strâns într-un rând cu submeniu și rândul de jos (tema, limba, ieșirea). Înălțimea maximă e ecranul de sub
 * antet, cu derulare internă; pe telefon se deschide ca foaie de jos (mânerul, fundalul estompat, tras în jos sau
 * atins fundalul = închis, focusul rămâne în foaie).
 */
export function GcsAccountMenu({
  data,
  mode,
  locales,
  locale,
  icons,
  compactTrigger = false,
  toggle = null,
  modeSwitch = true,
  extra = [],
}: {
  data: GcsAccountMenuData;
  /** Comutatorul lună / soare (perechea de teme); `null` = fără pereche. */
  toggle?: GcsThemeToggle | null;
  /** Fără pereche: tema permite comutarea întunecat / luminos a aceluiași aspect (setarea temei). */
  modeSwitch?: boolean;
  /** Intrările pluginurilor în meniul userului (`menus("user")`), cu iconița randată pe server. */
  extra?: { key: string; label: string; href: string; icon: ReactNode }[];
  /** Iconițele itemilor (randate pe server, după numele Font Awesome). */
  icons: Record<string, ReactNode>;
  mode: "dark" | "light" | "auto";
  locales: { code: string; label: string }[];
  locale: string;
  /** Esports: inelul mai mic și numele, fără linia de progres și săgeată (pe mobil, doar avatarul). */
  compactTrigger?: boolean;
}) {
  const t = useTranslations("header.account");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const errorMessage = useErrorMessage();
  const { dropdowns, device } = useHeaderState();
  const short = device === "mobile";
  /** Pe telefon, panoul e o foaie de jos (și se deschide doar la apăsare, fără hover). */
  const sheet = short;
  const [status, setStatus] = useState(data.status);
  const [theme, setTheme] = useState(mode);
  const [staffOpen, setStaffOpen] = useState(false);
  const [, start] = useTransition();
  const pop = useHeaderPopover({ mode: sheet ? "click" : dropdowns, trap: true });
  const pair = useThemeSwitch(toggle);
  const flyId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const staffRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  /** Deschis din tastatură: focusul intră în submeniu, pe primul item. */
  const focusFly = useRef(false);
  /** Tragerea foii în jos (pointerul, de unde a pornit, cât a coborât). */
  const drag = useRef<{ id: number; y: number; dy: number } | null>(null);
  const panelRef = pop.panelProps.ref;
  const rootRef = pop.rootProps.ref;
  const { setOpen } = pop;
  useEffect(() => setStatus(data.status), [data.status]);
  useEffect(() => pop.close(false), [pathname]);
  useEffect(() => {
    if (!pop.open) setStaffOpen(false);
  }, [pop.open]);

  // Bara de jos de pe telefon („Cont”) deschide meniul; evenimentul anulat îi spune barei că nu mai e nevoie de link.
  useEffect(() => {
    const onOpen = (e: Event) => {
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener(HEADER_EVENTS.account, onOpen);
    return () => window.removeEventListener(HEADER_EVENTS.account, onOpen);
  }, [setOpen]);

  // Înălțimea maximă: de la panou până jos în ecran (ecranul minus antetul), restul derulează înăuntru.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const root = rootRef.current;
    if (!pop.open || !panel || !root) return;
    if (sheet) {
      panel.style.removeProperty("--am-max");
      return;
    }
    const fit = () => panel.style.setProperty("--am-max", `${panelMaxHeight(root.getBoundingClientRect().top + panel.offsetTop, window.innerHeight)}px`);
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, { passive: true });
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit);
    };
  }, [pop.open, sheet, panelRef, rootRef]);

  // Submeniul „Staff”: lângă panou, spre interiorul ecranului, în dreptul rândului (și urmărindu-l la derulare); pe
  // telefon sau fără loc lateral, sub rând.
  useLayoutEffect(() => {
    const fly = flyRef.current;
    const row = rowRef.current;
    const wrap = staffRef.current;
    const panel = panelRef.current;
    if (!staffOpen || !fly || !row || !wrap || !panel) return;
    const place = () => {
      if (sheet) {
        wrap.dataset.side = "inline";
        return;
      }
      // Măsurat în așezarea laterală (lățimea și înălțimea lui reale), apoi partea aleasă.
      wrap.dataset.side = "left";
      const p = panel.getBoundingClientRect();
      const at = flyoutPlacement(
        { top: p.top + panel.clientTop, left: p.left, right: p.right, bottom: p.bottom },
        row.getBoundingClientRect(),
        { width: fly.offsetWidth, height: fly.offsetHeight },
        { width: document.documentElement.clientWidth, height: window.innerHeight },
      );
      wrap.dataset.side = at.side;
      fly.style.setProperty("--am-fly-top", `${at.top}px`);
    };
    place();
    if (focusFly.current) {
      focusFly.current = false;
      fly.querySelector<HTMLElement>(MENU_ITEM)?.focus();
    }
    const list = scrollRef.current;
    window.addEventListener("resize", place);
    list?.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      list?.removeEventListener("scroll", place);
    };
  }, [staffOpen, sheet, panelRef]);

  // Foaia de jos e modală: pagina de dedesubt nu derulează cât e deschisă.
  useEffect(() => {
    if (!sheet || !pop.open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [sheet, pop.open]);

  const { level, user } = data;
  const next = level.next;
  const slim = compactTrigger && !short;
  const staff = data.sections.find((s) => s.key === "staff") ?? null;
  const staffCount = staff?.items.reduce((n, it) => n + (it.count ?? 0), 0) ?? 0;

  const changeStatus = (s: "online" | "invisible") =>
    start(async () => {
      const prev = status;
      setStatus(s);
      const res = await setPresenceStatus({ status: s });
      if (!res.ok) {
        setStatus(prev);
        gcsToast({ title: errorMessage(res.error) });
      }
    });
  const changeTheme = (m: "dark" | "light") =>
    start(async () => {
      setTheme(m);
      document.documentElement.dataset.theme = m;
      await setThemeMode(form("mode", m));
      router.refresh();
    });
  const changeLocale = (code: string) =>
    start(async () => {
      await setLocale(form("locale", code));
      router.refresh();
    });
  const editPage = () =>
    start(async () => {
      // Meniul se închide, ca bara editorului și zonele paginii să rămână libere.
      pop.close(false);
      const res = await openPageEditor({});
      if (!res.ok && res.error.params?.reason === "acp_gate") return router.push("/admin/reauth");
      if (!res.ok) return void gcsToast({ title: errorMessage(res.error) });
      if (WIDGET_PATHS.test(pathname)) router.refresh();
      else router.push("/");
    });
  const logout = () =>
    start(async () => {
      await authClient.signOut();
      window.location.assign("/");
    });

  // „Staff”: Enter / → deschid submeniul (focusul pe primul item), Escape / ← îl închid și readuc focusul pe rând.
  const closeStaff = (focusRow: boolean) => {
    setStaffOpen(false);
    if (focusRow) rowRef.current?.focus();
  };
  const onRowKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      if (staffOpen) flyRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
      else {
        focusFly.current = true;
        setStaffOpen(true);
      }
    } else if (e.key === "ArrowLeft" && staffOpen) {
      e.preventDefault();
      closeStaff(true);
    }
  };
  const onFlyKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(flyRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM) ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "ArrowLeft") {
      e.preventDefault();
      closeStaff(true);
    }
  };
  // Escape închide întâi submeniul (meniul rămâne deschis); a doua oară, meniul (`useHeaderPopover`).
  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !staffOpen) return;
    e.preventDefault();
    e.stopPropagation();
    closeStaff(true);
  };
  // Un click în panou, în afara rândului „Staff” și a submeniului, închide submeniul; la fel focusul mutat în altă parte.
  const onPanelDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (staffOpen && !staffRef.current?.contains(e.target as Node)) setStaffOpen(false);
  };
  const onStaffBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (staffOpen && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setStaffOpen(false);
  };

  // Foaia de jos: trasă în jos de antet (mânerul) peste prag se închide; sub prag revine la loc.
  const onGrabDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!sheet || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag.current = { id: e.pointerId, y: e.clientY, dy: 0 };
  };
  const onGrabMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || d.id !== e.pointerId || !panel) return;
    d.dy = Math.max(0, e.clientY - d.y);
    if (d.dy < SWIPE_START && !panel.hasAttribute("data-dragging")) return;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
    panel.setAttribute("data-dragging", "");
    panel.style.transform = `translateY(${d.dy}px)`;
  };
  const onGrabEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const panel = panelRef.current;
    panel?.removeAttribute("data-dragging");
    if (panel) panel.style.transform = "";
    if (e.type === "pointerup" && d.dy > SWIPE_CLOSE) pop.close(true);
  };

  const ringLabel = next ? t("ring", { level: level.level, percent: level.percent, next: next.level }) : t("ringMax", { level: level.level });
  const remaining = next ? t(`remaining.${next.unit}`, { count: next.remaining, rank: next.name }) : t("maxLevel");
  const levelTip = next && next.need > 0 ? `${format.number(next.have)} / ${format.number(next.need)} ${t(`units.${next.unit}`)} · ${remaining}` : remaining;

  const tile = (it: GcsAccountItem) => {
    const full = t(`items.${it.key}`);
    const shortLabel = SHORT_LABELS.has(it.key);
    return (
      <Link
        key={it.key}
        href={it.href}
        className="gcs-am__tile"
        title={shortLabel ? full : undefined}
        onClick={() => pop.close(false)}
        data-testid={ITEM_TEST_IDS[it.key] ?? `gcs-account-${it.key}`}
      >
        <span className="gcs-am__icon" aria-hidden="true">
          {icons[it.icon]}
        </span>
        <span className="gcs-am__label">{shortLabel ? t(`tiles.${it.key}`) : full}</span>
        {it.count !== undefined && <span className="gcs-am__badge">{it.count > 99 ? "99+" : it.count}</span>}
        {it.note && <span className="gcs-am__hint">{it.note}</span>}
      </Link>
    );
  };
  const staffItem = (it: GcsAccountItem) => {
    const inner = (
      <>
        <span className="gcs-am__icon" aria-hidden="true">
          {icons[it.icon]}
        </span>
        <span className="gcs-am__label">{t(`items.${it.key}`)}</span>
        {it.count !== undefined && <span className="gcs-am__badge">{it.count > 99 ? "99+" : it.count}</span>}
      </>
    );
    return it.key === "pageEditor" ? (
      <button key={it.key} type="button" role="menuitem" className="gcs-am__row" onClick={editPage} data-testid="gcs-menu-page-editor">
        {inner}
      </button>
    ) : (
      <Link key={it.key} href={it.href} role="menuitem" className="gcs-am__row" onClick={() => pop.close(false)} data-testid={ITEM_TEST_IDS[it.key] ?? `gcs-account-${it.key}`}>
        {inner}
      </Link>
    );
  };

  return (
    <div className={`gcs-hb__pop gcs-am${short ? " gcs-am--short" : ""}${slim ? " gcs-am--slim" : ""}`} {...pop.rootProps}>
      <button {...pop.triggerProps} className="gcs-am__trigger" aria-label={ringLabel} aria-haspopup="dialog" data-testid="gcs-user-menu">
        <GcsXpRing percent={next ? level.percent : level.level > 0 ? 100 : 0} level={level.level} size={short ? 44 : slim ? 40 : 52}>
          <GcsAvatar name={user.name} size="m" userId={user.id} {...(user.image ? { src: user.image } : {})} />
        </GcsXpRing>
        {!short && (
          <span className="gcs-am__who">
            <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} size="full" className="gcs-am__name" data-testid="gcs-header-user" />
            {next && !slim && <span className="gcs-am__toNext">{t("toNext", { percent: level.percent, level: next.level })}</span>}
          </span>
        )}
        {!short && !slim && <GcsIconSvg icon={faChevronDown} className="gcs-am__chev" />}
      </button>
      {pop.mounted && sheet && (
        // Fundalul estompat al foii: atins, închide meniul.
        <div className="gcs-am__backdrop" data-open={pop.open ? "" : undefined} aria-hidden="true" onClick={() => pop.close(true)} data-testid="gcs-account-backdrop" />
      )}
      {pop.mounted && (
        <div
          {...pop.panelProps}
          role="dialog"
          aria-modal={sheet ? true : undefined}
          aria-label={t("menu")}
          className={`gcs-hb__panel gcs-am__panel${sheet ? " gcs-am__panel--sheet" : ""}`}
          data-variant={sheet ? "sheet" : "dropdown"}
          onKeyDown={onPanelKey}
          onMouseDown={onPanelDown}
          data-testid="gcs-account-menu"
        >
          <div className="gcs-am__head" onPointerDown={onGrabDown} onPointerMove={onGrabMove} onPointerUp={onGrabEnd} onPointerCancel={onGrabEnd}>
            {sheet && <span className="gcs-am__handle" aria-hidden="true" />}
            <div className="gcs-am__idRow">
              {/* Avatarul propriu nu deschide hover card-ul peste meniu. */}
              <span className="gcs-am__ava" data-gcs-card-off="" data-testid="gcs-account-avatar">
                <GcsAvatar name={user.name} size="m" userId={user.id} {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
              </span>
              <span className="gcs-am__idText">
                <span className="gcs-am__cardName">
                  <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} href={user.href} hoverCard={false} />
                </span>
                <span className="gcs-am__groups">
                  {data.groups.map((g) => (
                    <a
                      key={g.id}
                      href={`/members?group=${g.id}`}
                      className="gcs-groupMention gcs-am__group"
                      data-group-id={g.id}
                      style={g.color ? ({ "--g": g.color } as React.CSSProperties) : undefined}
                      title={g.name}
                      data-testid="gcs-account-group"
                    >
                      {/* Un nume lung se taie cu „…” (tot numele în tooltip), ca să nu intre sub comutatorul de status. */}
                      <span className="gcs-am__groupText">{g.name}</span>
                    </a>
                  ))}
                </span>
              </span>
              <div className="gcs-am__status" role="radiogroup" aria-label={t("status.label")}>
                {(["online", "invisible"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={status === s}
                    className={`gcs-am__statusBtn gcs-am__statusBtn--${s}`}
                    onClick={() => changeStatus(s)}
                    data-testid={`gcs-account-status-${s}`}
                  >
                    <span className="gcs-am__dot" aria-hidden="true" />
                    {t(`status.${s}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="gcs-am__level" title={levelTip}>
              <div className="gcs-am__levelLine">
                <span>
                  <b>{t("level", { level: level.level })}</b>
                  {level.rank && <> · {level.rank}</>}
                </span>
                <span className="gcs-am__statsLine">
                  <b>
                    <GcsCountUp value={data.stats.posts} format={(n) => format.number(n)} />
                  </b>{" "}
                  {t("line.posts", { count: data.stats.posts })} ·{" "}
                  <b>
                    <GcsCountUp value={data.stats.reputation} format={(n) => format.number(n)} />
                  </b>{" "}
                  {t("units.reputation")}
                  {data.stats.elo !== null && (
                    <span data-testid="gcs-account-elo">
                      {" "}
                      · <b>{format.number(data.stats.elo)}</b> {t("stats.elo")}
                    </span>
                  )}
                </span>
              </div>
              <span className="gcs-am__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={next ? level.percent : 100} aria-label={ringLabel}>
                <span style={{ width: `${next ? level.percent : 100}%` }} />
              </span>
              <span className="gcs-srOnly" data-testid="gcs-account-remaining">
                {remaining}
              </span>
            </div>
          </div>
          <div ref={scrollRef} className="gcs-am__scroll">
            {data.sections
              .filter((sec) => TILE_SECTIONS.has(sec.key))
              .map((sec) => (
                <nav key={sec.key} className="gcs-am__section" aria-label={t(`sections.${sec.key}`)} data-testid={`gcs-account-section-${sec.key}`}>
                  <span className="gcs-am__sectionTitle" aria-hidden="true">
                    {t(`sections.${sec.key}`)}
                  </span>
                  <div className="gcs-am__tiles">{sec.items.map(tile)}</div>
                </nav>
              ))}
            {extra.length > 0 && (
              <nav className="gcs-am__section" aria-label={t("sections.apps")} data-testid="gcs-account-section-apps">
                <span className="gcs-am__sectionTitle" aria-hidden="true">
                  {t("sections.apps")}
                </span>
                <div className="gcs-am__tiles">
                  {extra.map((it) => (
                    <Link key={it.key} href={it.href} className="gcs-am__tile" onClick={() => pop.close(false)} data-testid={`gcs-menu-plugin-${it.key}`}>
                      <span className="gcs-am__icon" aria-hidden="true">
                        {it.icon}
                      </span>
                      <span className="gcs-am__label">{it.label}</span>
                    </Link>
                  ))}
                </div>
              </nav>
            )}
            {staff && (
              <div ref={staffRef} className="gcs-am__staff" onBlur={onStaffBlur} data-testid="gcs-account-section-staff">
                <button
                  ref={rowRef}
                  type="button"
                  className="gcs-am__row gcs-am__staffRow"
                  aria-haspopup="menu"
                  aria-expanded={staffOpen}
                  aria-controls={flyId}
                  onClick={() => setStaffOpen((o) => !o)}
                  onKeyDown={onRowKey}
                  data-testid="gcs-account-staff"
                >
                  <span className="gcs-am__icon" aria-hidden="true">
                    <GcsIconSvg icon={faShieldHalved} />
                  </span>
                  <span className="gcs-am__label">{t("sections.staff")}</span>
                  {staffCount > 0 && <span className="gcs-am__badge">{staffCount > 99 ? "99+" : staffCount}</span>}
                  <GcsIconSvg icon={faChevronRight} className="gcs-am__go" />
                </button>
                <div ref={flyRef} id={flyId} role="menu" aria-label={t("sections.staff")} className="gcs-am__fly" hidden={!staffOpen} onKeyDown={onFlyKey} data-testid="gcs-account-staff-menu">
                  {staff.items.map(staffItem)}
                </div>
              </div>
            )}
          </div>
          <div className="gcs-am__foot">
            {toggle ? (
              // Perechea de teme (GCS Dark ↔ GCS White sau cea aleasă în ACP): butonul celeilalte teme o deschide.
              <span className="gcs-am__seg" role="group" aria-label={t("theme.label")}>
                <button
                  type="button"
                  aria-label={t("theme.dark")}
                  aria-pressed={toggle.side === "dark"}
                  disabled={pair.pending}
                  onClick={() => toggle.side !== "dark" && pair.go()}
                  data-testid="gcs-account-theme-dark"
                >
                  <GcsIconSvg icon={faMoon} />
                </button>
                <button
                  type="button"
                  aria-label={t("theme.light")}
                  aria-pressed={toggle.side === "light"}
                  disabled={pair.pending}
                  onClick={() => toggle.side !== "light" && pair.go()}
                  data-testid="gcs-account-theme-light"
                >
                  <GcsIconSvg icon={faSun} />
                </button>
              </span>
            ) : modeSwitch ? (
              <span className="gcs-am__seg" role="group" aria-label={t("theme.label")}>
                <button type="button" aria-label={t("theme.dark")} aria-pressed={theme !== "light"} onClick={() => changeTheme("dark")} data-testid="gcs-account-theme-dark">
                  <GcsIconSvg icon={faMoon} />
                </button>
                <button type="button" aria-label={t("theme.light")} aria-pressed={theme === "light"} onClick={() => changeTheme("light")} data-testid="gcs-account-theme-light">
                  <GcsIconSvg icon={faSun} />
                </button>
              </span>
            ) : null}
            <label className="gcs-am__lang">
              <span className="gcs-srOnly">{t("language")}</span>
              <select value={locale} onChange={(e) => changeLocale(e.target.value)} data-testid="gcs-account-language">
                {locales.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.code.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="gcs-am__logout" onClick={logout} data-testid="gcs-menu-logout">
              <GcsIconSvg icon={faRightFromBracket} />
              {t("logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
