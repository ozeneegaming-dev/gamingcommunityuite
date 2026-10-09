"use client";

import { faBars, faBell, faComments, faEnvelope, faHouse, faMagnifyingGlass, faMoon, faPlus, faServer, faSun, faUser, faBolt, faPeopleGroup, faCommentDots } from "@fortawesome/free-solid-svg-icons";
import type { GcsMobileBarItem } from "@gcs/core/themes";
import type { GcsServerLive } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { setThemeMode } from "../../actions";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { GcsServerLiveProvider, useServerStatuses } from "../servers/GcsServerLive";
import { HEADER_EVENTS, useHeaderState } from "./header-context";

/** Meniul: bara (desktop) sau butonul sertarului (tabletă, mobil). */
export function GcsNavElement({ bar, drawer }: { bar: ReactNode; drawer: ReactNode }) {
  const { device } = useHeaderState();
  return <>{device === "desktop" ? bar : drawer}</>;
}

/** Partea dreaptă a meniului împărțit: doar pe desktop (pe ecranele mici, sertarul are tot meniul). */
export function GcsDesktopOnly({ children }: { children: ReactNode }) {
  const { device } = useHeaderState();
  return device === "desktop" ? <>{children}</> : null;
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

/** Comutatorul temei (întunecată / luminoasă), ca element de antet. */
export function GcsThemeToggle({ mode }: { mode: "dark" | "light" | "auto" }) {
  const t = useTranslations("header.theme");
  const router = useRouter();
  const [current, setCurrent] = useState(mode);
  const [, start] = useTransition();
  const next = current === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className="gcs-hb__sq"
      aria-label={t(next === "dark" ? "toDark" : "toLight")}
      onClick={() =>
        start(async () => {
          setCurrent(next);
          document.documentElement.dataset.theme = next;
          const fd = new FormData();
          fd.set("mode", next);
          await setThemeMode(fd);
          router.refresh();
        })
      }
      data-testid="gcs-header-theme"
    >
      <GcsIconSvg icon={current === "light" ? faMoon : faSun} />
    </button>
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
 * Căutarea, meniul și „Creează” deschid panourile antetului.
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
              {count > 0 && <span className="gcs-hb__count">{count > 99 ? "99+" : count}</span>}
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
        return (
          <Link key={item} href={href} className={`gcs-mbar__item${active ? " gcs-mbar__item--active" : ""}`} aria-current={active ? "page" : undefined} data-testid={`gcs-mobile-bar-${item}`}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
