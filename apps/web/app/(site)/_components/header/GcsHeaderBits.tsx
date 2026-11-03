"use client";

import { faBars, faBell, faComments, faEnvelope, faHouse, faMagnifyingGlass, faMoon, faPlus, faServer, faSun, faUser, faBolt, faPeopleGroup, faCommentDots } from "@fortawesome/free-solid-svg-icons";
import type { GcsMobileBarItem } from "@gcs/core/themes";
import type { GcsServerLive } from "@gcs/modules";
import { GcsIconSvg, GcsTooltip } from "@gcs/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { GcsThemeToggle as GcsThemeToggleState } from "@/lib/appearance";
import { setSkinChoice, setThemeMode } from "../../actions";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { GcsServerLiveProvider, useServerStatuses } from "../servers/GcsServerLive";
import { GcsCountUp } from "./GcsCountUp";
import { HEADER_EVENTS, useHeaderState } from "./header-context";

/** Meniul: bara (desktop) sau butonul sertarului (tabletă, mobil). */
export function GcsNavElement({ bar, drawer }: { bar: ReactNode; drawer: ReactNode }) {
  const { device } = useHeaderState();
  return <>{device === "desktop" ? bar : drawer}</>;
}

function Summary({ matches }: { matches: number }) {
  const t = useTranslations("header.live");
  const statuses = useServerStatuses();
  const online = Object.values(statuses).filter((s): s is GcsServerLive => !!s && s.online);
  const players = online.reduce((n, s) => n + s.players, 0);
  return (
    <span className="gcs-liveSummary" data-testid="gcs-servers-live">
      <span className={`gcs-liveSummary__dot${online.length > 0 ? " gcs-liveSummary__dot--on" : ""}`} aria-hidden="true" />
      <span>
        {t("servers", { count: online.length })} · {t("players", { count: players })}
        {matches > 0 && <> · {t("matches", { count: matches })}</>}
      </span>
    </span>
  );
}

/** „Status servere live” (aplicația Servere): serverele online, jucătorii și meciurile live, actualizate live. */
export function GcsServersLiveSummary({ statuses, pollSeconds, matches }: { statuses: Record<number, GcsServerLive | null>; pollSeconds: number; matches: number }) {
  return (
    <GcsServerLiveProvider initial={statuses} pollSeconds={pollSeconds}>
      <Summary matches={matches} />
    </GcsServerLiveProvider>
  );
}

/**
 * Trece la cealaltă temă a perechii lună / soare (ACP → Aspect → Teme): preferința membrului și cookie-ul (vizitatori),
 * apoi pagina se reîncarcă cu tema nouă (CSS-ul, designul și modul ei).
 */
export function useThemeSwitch(toggle: GcsThemeToggleState | null) {
  const [pending, start] = useTransition();
  const go = () => {
    if (!toggle) return;
    start(async () => {
      const fd = new FormData();
      fd.set("skin", toggle.target);
      await setSkinChoice(fd);
      window.location.reload();
    });
  };
  return { pending, go };
}

/**
 * Comutatorul lună / soare, ca element de antet: trece între cele două teme ale perechii. Fără pereche, pe o temă cu
 * ambele moduri comută modul ei (`mode`); altfel nu apare.
 */
export function GcsThemeToggle({ toggle, mode = null }: { toggle: GcsThemeToggleState | null; mode?: "dark" | "light" | "auto" | null }) {
  const t = useTranslations("header.theme");
  const { pending, go } = useThemeSwitch(toggle);
  if (!toggle) return mode ? <GcsModeToggle mode={mode} /> : null;
  const label = t(toggle.side === "light" ? "toDark" : "toLight");
  return (
    <GcsTooltip content={label} side="bottom">
      <button type="button" className="gcs-hb__sq" aria-label={label} onClick={go} disabled={pending} data-side={toggle.side} data-testid="gcs-header-theme">
        <GcsIconSvg icon={toggle.side === "light" ? faMoon : faSun} />
      </button>
    </GcsTooltip>
  );
}

/** Comutatorul de mod (întunecat / luminos) al aceleiași teme, pentru temele din afara perechii cu ambele moduri. */
function GcsModeToggle({ mode }: { mode: "dark" | "light" | "auto" }) {
  const t = useTranslations("header.theme");
  const [current, setCurrent] = useState(mode);
  const [, start] = useTransition();
  const next = current === "light" ? "dark" : "light";
  const label = t(next === "dark" ? "toDark" : "toLight");
  return (
    <GcsTooltip content={label} side="bottom">
      <button
        type="button"
        className="gcs-hb__sq"
        aria-label={label}
        onClick={() =>
          start(async () => {
            setCurrent(next);
            document.documentElement.dataset.theme = next;
            const fd = new FormData();
            fd.set("mode", next);
            await setThemeMode(fd);
          })
        }
        data-testid="gcs-header-theme"
      >
        <GcsIconSvg icon={current === "light" ? faMoon : faSun} />
      </button>
    </GcsTooltip>
  );
}

const BAR_ICONS: Record<GcsMobileBarItem, Parameters<typeof GcsIconSvg>[0]["icon"]> = {
  home: faHouse,
  forum: faComments,
  servers: faServer,
  create: faPlus,
  messages: faEnvelope,
  notifications: faBell,
  search: faMagnifyingGlass,
  menu: faBars,
  account: faUser,
  chat: faCommentDots,
  activity: faBolt,
  clans: faPeopleGroup,
};

/** Adresele elementelor barei de jos (cele care deschid un panou n-au adresă). */
const BAR_HREF: Partial<Record<GcsMobileBarItem, string>> = {
  home: "/",
  servers: "/servers",
  messages: "/messages",
  notifications: "/notifications",
  chat: "/chat",
  activity: "/activity",
  clans: "/clans",
};

/**
 * Bara de jos de pe mobil (specul 2026-10-10-hero-cockpit §7, §9): elementele alese în temă (implicit Forum, Servere,
 * + Creează în centru, Mesaje, Notificări), cu textul sub iconiță (opțional) și numerele live de necitite.
 * Căutarea, meniul și „Creează” deschid panourile antetului; „Cont” (membrii) deschide meniul contului ca foaie de jos.
 */
export function GcsMobileBar({
  items,
  labels: showLabels,
  forumHref,
  accountHref,
  unread,
  member,
}: {
  items: GcsMobileBarItem[];
  labels: boolean;
  forumHref: string;
  accountHref: string | null;
  unread: { messages: number; notifications: number };
  member: boolean;
}) {
  const t = useTranslations("header.mobileBar");
  const pathname = usePathname();
  const realtime = useRealtime();
  const [counts, setCounts] = useState(unread);
  useEffect(() => setCounts(unread), [unread]);
  useEffect(() => {
    const offPm = realtime.on("pm", (d) => typeof (d as { unread?: unknown })?.unread === "number" && setCounts((c) => ({ ...c, messages: (d as { unread: number }).unread })));
    const offN = realtime.on("notification", (d) => typeof (d as { unread?: unknown })?.unread === "number" && setCounts((c) => ({ ...c, notifications: (d as { unread: number }).unread })));
    return () => {
      offPm();
      offN();
    };
  }, [realtime]);

  const shown = items.filter((i) => member || !["create", "messages", "notifications"].includes(i));
  const fire = (event: string) => () => window.dispatchEvent(new CustomEvent(event));
  return (
    <nav className={`gcs-mbar${showLabels ? "" : " gcs-mbar--iconsOnly"}`} aria-label={t("label")} data-testid="gcs-mobile-bar">
      {shown.map((item) => {
        const label = t(`items.${item}`);
        const count = item === "messages" ? counts.messages : item === "notifications" ? counts.notifications : 0;
        const content = (
          <>
            <span className="gcs-mbar__icon">
              <GcsIconSvg icon={BAR_ICONS[item]} />
              {count > 0 && (
                <span className="gcs-hb__count">
                  <GcsCountUp value={count} format={(n) => (n > 99 ? "99+" : String(n))} />
                </span>
              )}
            </span>
            <span className={showLabels && item !== "create" ? "gcs-mbar__label" : "gcs-srOnly"}>{label}</span>
          </>
        );
        if (item === "create") {
          return (
            <button key={item} type="button" className="gcs-mbar__create" aria-label={label} onClick={fire(HEADER_EVENTS.create)} data-testid="gcs-mobile-bar-create">
              {content}
            </button>
          );
        }
        if (item === "search" || item === "menu") {
          return (
            <button key={item} type="button" className="gcs-mbar__item" onClick={fire(item === "search" ? HEADER_EVENTS.search : HEADER_EVENTS.drawer)} data-testid={`gcs-mobile-bar-${item}`}>
              {content}
            </button>
          );
        }
        const href = item === "forum" ? forumHref : item === "account" ? (accountHref ?? "/login") : (BAR_HREF[item] ?? "/");
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href.split("?")[0]!);
        if (item === "account" && member) {
          // Contul deschide meniul contului (foaia de jos); fără meniu montat în antet, linkul duce la profil.
          const openMenu = (e: ReactMouseEvent) => {
            if (!window.dispatchEvent(new CustomEvent(HEADER_EVENTS.account, { cancelable: true }))) e.preventDefault();
          };
          return (
            <Link key={item} href={href} className={`gcs-mbar__item${active ? " gcs-mbar__item--active" : ""}`} aria-haspopup="dialog" onClick={openMenu} data-testid="gcs-mobile-bar-account">
              {content}
            </Link>
          );
        }
        return (
          <Link key={item} href={href} className={`gcs-mbar__item${active ? " gcs-mbar__item--active" : ""}`} aria-current={active ? "page" : undefined} data-testid={`gcs-mobile-bar-${item}`}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
