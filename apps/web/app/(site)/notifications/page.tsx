import { GcsButton } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { daySection, notificationItems, notificationTab } from "@/lib/notifications";
import { services } from "@/lib/services";
import { GcsNotificationList, type GcsNotificationRow } from "../_components/notifications/GcsNotificationList";
import { notificationIcons } from "../_components/notifications/notification-icons";

const PER_PAGE = 30;
const FILTERS = ["all", "unread", "read"] as const;
type Filter = (typeof FILTERS)[number];

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("notifications"))("title"), robots: { index: false } };
}

/**
 * Toate notificările membrului (specul etapei 4 §8, Notificări v2): taburile (Toate, Mențiuni, Mesaje, Moderare și ale
 * aplicațiilor active, cu necititele lor), filtrul citite / necitite, „Marchează toate citite”, ștergerea și gruparea
 * („Ana și alți 3 au reacționat”), pe zile; paginare pe cursor.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ before?: string; tab?: string; filter?: string }> }) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const sp = await searchParams;
  const beforeRaw = Number(sp.before);
  const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined;
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as Filter) : "all";
  const [t, tAll, locale, format, { tabs, tab }] = await Promise.all([getTranslations("notifications"), getTranslations(), getLocale(), getFormatter(), notificationTab(sp.tab)]);
  const [items, byType, icons, viewer] = await Promise.all([
    notificationItems(actor.userId, locale, {
      limit: PER_PAGE + 1,
      ...(before ? { before } : {}),
      ...(tab.types ? { types: tab.types } : {}),
      ...(filter === "unread" ? { unreadOnly: true } : filter === "read" ? { readOnly: true } : {}),
    }),
    services().notifications.unreadByType(actor.userId),
    notificationIcons(),
    services().db.user.findUnique({ where: { id: actor.userId }, select: { timezone: true } }),
  ]);
  const more = items.length > PER_PAGE;
  const now = new Date();
  const timeZone = viewer?.timezone ?? "UTC";
  const shown: GcsNotificationRow[] = items.slice(0, PER_PAGE).map((i) => ({
    ...i,
    section: daySection(i.updatedAt, now, timeZone),
    when: format.relativeTime(new Date(i.updatedAt), now),
    whenTitle: format.dateTime(new Date(i.updatedAt), { dateStyle: "medium", timeStyle: "short", timeZone }),
  }));
  const unreadOf = (types: string[] | null) => (types ? types.reduce((s, k) => s + (byType[k] ?? 0), 0) : Object.values(byType).reduce((s, n) => s + n, 0));
  const href = (q: { tab?: string; filter?: Filter; before?: number }) => {
    const p = new URLSearchParams();
    const tb = q.tab ?? tab.key;
    const f = q.filter ?? filter;
    if (tb !== "all") p.set("tab", tb);
    if (f !== "all") p.set("filter", f);
    if (q.before) p.set("before", String(q.before));
    const s = p.toString();
    return s ? `/notifications?${s}` : "/notifications";
  };

  return (
    <>
      <header className="gcs-pageHeader gcs-pageHeader--center">
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-bell" className="gcs-hIcon" />
          {t("title")}
        </h1>
        <div className="gcs-pageHeader__actions">
          <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-calendar-week" />}>
            <Link href="/notifications/weekly" data-testid="gcs-notif-weekly-link">
              {t("weekly.link")}
            </Link>
          </GcsButton>
          <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-sliders" />}>
            <Link href="/settings/notifications">{t("preferences")}</Link>
          </GcsButton>
        </div>
      </header>

      <nav className="gcs-notifTabs gcs-notifPage__tabs" aria-label={t("tabsLabel")} data-testid="gcs-notif-page-tabs">
        {tabs.map((x) => {
          const n = unreadOf(x.types);
          return (
            <Link
              key={x.key}
              href={href({ tab: x.key })}
              className={`gcs-sweep gcs-notifTabs__tab${x.key === tab.key ? " gcs-notifTabs__tab--active" : ""}`}
              aria-current={x.key === tab.key ? "page" : undefined}
              data-testid={`gcs-notif-page-tab-${x.key}`}
            >
              <GcsIcon name={x.icon} />
              {tAll.has(x.labelKey) ? tAll(x.labelKey) : x.key}
              {n > 0 && <span className="gcs-notifTabs__count">{n > 99 ? "99+" : n}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="gcs-notifPage__bar">
        <div className="gcs-notifFilter" role="group" aria-label={t("filter.label")}>
          {FILTERS.map((f) => (
            <Link key={f} href={href({ filter: f })} className={`gcs-sweep gcs-notifFilter__item${f === filter ? " gcs-notifFilter__item--active" : ""}`} aria-current={f === filter ? "true" : undefined} data-testid={`gcs-notif-filter-${f}`}>
              {t(`filter.${f}`)}
            </Link>
          ))}
        </div>
      </div>

      <GcsNotificationList
        items={shown}
        tab={tab.key}
        icons={icons}
        hasUnread={unreadOf(tab.types) > 0}
        emptyText={filter === "unread" ? t("emptyUnread") : tab.key === "mentions" ? t("emptyMentions") : t("empty")}
      />

      {more && (
        <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-clock-rotate-left" />}>
          <Link href={href({ before: shown[shown.length - 1]!.id })} data-testid="gcs-notif-older">
            {t("older")}
          </Link>
        </GcsButton>
      )}
    </>
  );
}
