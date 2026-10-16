"use client";

import { faBellSlash } from "@fortawesome/free-regular-svg-icons";
import { faArrowRight, faAt, faBell, faCheckDouble, faGear, faStar } from "@fortawesome/free-solid-svg-icons";
import { GcsAvatar, GcsIconSvg, GcsNamedText, GcsSpinner } from "@gcs/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { GcsNotificationItem } from "@/lib/notifications";
import { markNotificationsRead } from "../../notification-actions";
import { GcsCountUp } from "../header/GcsCountUp";
import { useHeaderPopover } from "../header/GcsHeaderPopover";
import { useHeaderState } from "../header/header-context";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

const badge = (n: number) => (n > 99 ? "99+" : String(n));
type Tab = "all" | "mentions";
const TABS: { key: Tab; icon: typeof faBell }[] = [
  { key: "all", icon: faBell },
  { key: "mentions", icon: faAt },
];

/**
 * Clopoțelul (componentă de sistem, în orice temă; Notificări v2): numărul de necitite vine de pe server și se
 * actualizează live (`notification`, `resync`); dropdown-ul are taburile Toate / Mențiuni (cross-fade), „Marchează toate
 * citite” (pe tabul curent), linkul spre setări și „Vezi toate”. Deschis, lista se reîncarcă la fiecare notificare nouă.
 * `icons`: iconițele categoriilor (randate pe server), după numele din `item.icon`.
 */
export function GcsNotificationBell({ initialUnread, icons = {} }: { initialUnread: number; icons?: Record<string, ReactNode> }) {
  const t = useTranslations("notifications");
  const format = useFormatter();
  const realtime = useRealtime();
  const router = useRouter();
  const { dropdowns } = useHeaderState();
  const [unread, setUnread] = useState(initialUnread);
  const [tab, setTab] = useState<Tab>("all");
  const [items, setItems] = useState<GcsNotificationItem[] | null>(null);
  const tabRef = useRef<Tab>("all");
  tabRef.current = tab;

  const load = useCallback(async (which: Tab | "count") => {
    const res = await fetch(`/api/notifications${which === "count" ? "?count=1" : `?tab=${which}`}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) {
      if (which !== "count") setItems((v) => v ?? []);
      return;
    }
    const body = (await res.json()) as { unread: number; items: GcsNotificationItem[] };
    setUnread(body.unread);
    // Un răspuns întârziat al altui tab nu suprascrie lista tabului curent.
    if (which !== "count" && which === tabRef.current) setItems(body.items);
  }, []);
  const pop = useHeaderPopover({ mode: dropdowns, onOpen: () => void load(tabRef.current) });
  const openRef = useRef(false);
  openRef.current = pop.open;

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  useEffect(() => {
    const offLive = realtime.on("notification", (data) => {
      const n = (data as { unread?: unknown } | null)?.unread;
      if (typeof n === "number") setUnread(n);
      // Live: deschis, lista tabului curent se reîncarcă; închis, se reîncarcă la următoarea deschidere.
      if (openRef.current) void load(tabRef.current);
      else setItems(null);
    });
    const offResync = realtime.on("resync", () => void load("count"));
    return () => {
      offLive();
      offResync();
    };
  }, [realtime, load]);

  const choose = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    tabRef.current = next;
    setItems(null);
    void load(next);
  };

  const openItem = async (item: GcsNotificationItem) => {
    pop.close(false);
    if (!item.read) {
      setItems((list) => list?.map((i) => (i.id === item.id ? { ...i, read: true } : i)) ?? null);
    }
    const res = await markNotificationsRead({ ids: [item.id], click: true });
    if (res.ok) setUnread(res.data.unread);
    router.push(item.href);
  };

  const markAll = async () => {
    const res = await markNotificationsRead({ ids: "all", tab });
    if (res.ok) setUnread(res.data.unread);
    setItems((list) => list?.map((i) => ({ ...i, read: true })) ?? null);
  };

  const unreadInTab = items?.some((i) => !i.read) ?? false;

  return (
    <div className="gcs-hb__pop gcs-notifMenu" {...pop.rootProps}>
      <button
        {...pop.triggerProps}
        className="gcs-headerIcon"
        aria-label={unread > 0 ? t("unreadLabel", { count: unread }) : t("title")}
        data-testid="gcs-header-bell"
      >
        <GcsIconSvg icon={faBell} />
        {unread > 0 && (
          <span className="gcs-headerIcon__count" data-testid="gcs-header-bell-count">
            <GcsCountUp value={unread} format={badge} />
          </span>
        )}
      </button>
      {pop.mounted && (
        <div {...pop.panelProps} role="dialog" aria-label={t("title")} className="gcs-hb__panel gcs-notifMenu__panel" data-testid="gcs-notif-panel">
          <div className="gcs-hb__panelHead gcs-notifMenu__head">
            <strong>
              <GcsIconSvg icon={faBell} className="gcs-hIcon" />
              {t("title")}
            </strong>
            <span className="gcs-notifMenu__tools">
              {(unreadInTab || (tab === "all" && unread > 0)) && (
                <button type="button" className="gcs-sweep gcs-hb__panelAction gcs-notifMenu__markAll" onClick={() => void markAll()} data-testid="gcs-notif-mark-all">
                  <GcsIconSvg icon={faCheckDouble} />
                  {t("markAll")}
                </button>
              )}
              <Link href="/settings/notifications" className="gcs-iconBtn gcs-notifMenu__settings" aria-label={t("settingsLink")} title={t("settingsLink")} onClick={() => pop.close(false)} data-testid="gcs-notif-settings">
                <GcsIconSvg icon={faGear} />
              </Link>
            </span>
          </div>
          <div role="tablist" aria-label={t("title")} className="gcs-notifTabs gcs-notifMenu__tabs">
            {TABS.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={tab === x.key}
                className={`gcs-sweep gcs-notifTabs__tab${tab === x.key ? " gcs-notifTabs__tab--active" : ""}`}
                onClick={() => choose(x.key)}
                data-testid={`gcs-notif-tab-${x.key}`}
              >
                <GcsIconSvg icon={x.icon} />
                {t(`tabs.${x.key}`)}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="gcs-notifMenu__body" key={tab}>
            {items === null ? (
              <p className="gcs-hb__panelNote gcs-loading" aria-busy="true">
                <GcsSpinner label={t("loading")} />
              </p>
            ) : items.length === 0 ? (
              <p className="gcs-hb__panelNote gcs-notifMenu__empty">
                <GcsIconSvg icon={faBellSlash} className="gcs-emptyIcon" />
                {tab === "mentions" ? t("emptyMentions") : t("empty")}
              </p>
            ) : (
              <ul className="gcs-notifMenu__list">
                {items.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`/notifications/${item.id}`}
                      className={`gcs-notifRow${item.read ? "" : " gcs-notifRow--unread"}${item.important ? " gcs-notifRow--important" : ""}`}
                      onClick={(e) => {
                        e.preventDefault();
                        void openItem(item);
                      }}
                      data-testid="gcs-notif-item"
                    >
                      <span className="gcs-notifRow__lead" aria-hidden="true">
                        {item.actor ? (
                          <GcsAvatar name={item.actor.name} size="s" userId={item.actor.id} {...(item.actor.image ? { src: item.actor.image } : {})} {...(item.actor.frameKey ? { frame: item.actor.frameKey } : {})} />
                        ) : (
                          <span className="gcs-notifRow__icon">{icons[item.icon] ?? <GcsIconSvg icon={faBell} />}</span>
                        )}
                      </span>
                      <span className="gcs-notifRow__main">
                        <span className="gcs-notifRow__text">
                          <GcsNamedText text={item.text} user={item.actor} />
                        </span>
                        {item.snippet && <span className="gcs-notifRow__snippet">{item.snippet}</span>}
                        <span className="gcs-notifRow__meta">
                          {item.important && (
                            <span className="gcs-notifRow__flag" title={t("important")}>
                              <GcsIconSvg icon={faStar} />
                              {t("important")}
                            </span>
                          )}
                          <time className="gcs-notifRow__time" dateTime={item.updatedAt} title={format.dateTime(new Date(item.updatedAt), { dateStyle: "medium", timeStyle: "short" })}>
                            {format.relativeTime(new Date(item.updatedAt))}
                          </time>
                        </span>
                      </span>
                      {!item.read && (
                        <span className="gcs-notifRow__dot">
                          <span className="gcs-srOnly">{t("unread")}</span>
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link href={tab === "mentions" ? "/notifications?tab=mentions" : "/notifications"} className="gcs-hb__panelFoot gcs-arrowLink" onClick={() => pop.close(false)} data-testid="gcs-notif-see-all">
            {t("seeAll")}
            <GcsIconSvg icon={faArrowRight} className="gcs-arrow" />
          </Link>
        </div>
      )}
    </div>
  );
}

/** Un număr din header actualizat live (ex. plicul mesajelor: evenimentul `pm`). */
export function GcsLiveCount({ initial, event, testId }: { initial: number; event: string; testId: string }) {
  const [count, setCount] = useState(initial);
  const realtime = useRealtime();
  useEffect(() => setCount(initial), [initial]);
  useEffect(
    () =>
      realtime.on(event, (data) => {
        const n = (data as { unread?: unknown } | null)?.unread;
        if (typeof n === "number") setCount(n);
      }),
    [realtime, event],
  );
  if (count <= 0) return null;
  return (
    <span className="gcs-headerIcon__count" data-testid={testId}>
      {badge(count)}
    </span>
  );
}
