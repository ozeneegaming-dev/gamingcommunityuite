import { GcsButton, GcsNamedText } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { notificationItems } from "@/lib/notifications";
import { GcsMarkAllRead } from "../_components/notifications/GcsMarkAllRead";

const PER_PAGE = 30;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("notifications"))("title"), robots: { index: false } };
}

/** Toate notificările membrului (specul etapei 4 §8), cele mai noi primele, cu paginare pe cursor. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const beforeRaw = Number((await searchParams).before);
  const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined;
  const [t, format, locale] = await Promise.all([getTranslations("notifications"), getFormatter(), getLocale()]);
  const items = await notificationItems(actor.userId, locale, { limit: PER_PAGE + 1, ...(before ? { before } : {}) });
  const more = items.length > PER_PAGE;
  const shown = items.slice(0, PER_PAGE);

  return (
    <>
      <header className="gcs-pageHeader gcs-pageHeader--center">
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-bell" className="gcs-hIcon" />
          {t("title")}
        </h1>
        <div className="gcs-pageHeader__actions">
          <GcsMarkAllRead label={t("markAll")} />
          <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-sliders" />}>
            <Link href="/settings/notifications">{t("preferences")}</Link>
          </GcsButton>
        </div>
      </header>
      {shown.length === 0 ? (
        <p className="gcs-muted">
          <GcsIcon name="fa-regular fa-bell-slash" className="gcs-emptyIcon" />
          {t("empty")}
        </p>
      ) : (
        <ul className="gcs-notifList" data-testid="gcs-notif-list">
          {shown.map((n) => (
            <li key={n.id}>
              <a href={`/notifications/${n.id}`} className={`gcs-notifItem${n.read ? "" : " gcs-notifItem--unread"}`}>
                <span className="gcs-notifItem__text">
                  <GcsNamedText text={n.text} user={n.actor} />
                </span>
                {n.snippet && <span className="gcs-notifItem__snippet">{n.snippet}</span>}
                <time className="gcs-notifItem__time" dateTime={n.updatedAt}>
                  {format.relativeTime(new Date(n.updatedAt))}
                </time>
              </a>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-clock-rotate-left" />}>
          <Link href={`/notifications?before=${shown[shown.length - 1]!.id}`}>{t("older")}</Link>
        </GcsButton>
      )}
    </>
  );
}
