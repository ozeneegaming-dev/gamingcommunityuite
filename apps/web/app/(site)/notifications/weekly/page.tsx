import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("notifications.weekly"))("title"), robots: { index: false } };
}

/**
 * Rezumatul săptămânal „Ce ai ratat” (Notificări v2), pe site: topicurile populare ale ultimelor 7 zile pe care membrul
 * le poate citi, mențiunile lui necitite, momentele serverelor și secțiunile aplicațiilor. Același conținut ca emailul.
 */
export default async function WeeklyDigestPage() {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const [t, locale, format] = await Promise.all([getTranslations("notifications.weekly"), getLocale(), getFormatter()]);
  const digest = await services().notificationProducers.weekly.forUser(actor.userId, locale);
  const empty = digest.topics.length === 0 && digest.mentions.count === 0 && digest.servers.length === 0 && digest.extras.length === 0;

  return (
    <>
      <header className="gcs-pageHeader gcs-pageHeader--center">
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-calendar-week" className="gcs-hIcon" />
          {t("title")}
        </h1>
        <div className="gcs-pageHeader__actions">
          <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-bell" />}>
            <Link href="/notifications">{t("back")}</Link>
          </GcsButton>
          <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-sliders" />}>
            <Link href="/settings/notifications">{t("settings")}</Link>
          </GcsButton>
        </div>
      </header>
      <p className="gcs-muted gcs-weekly__intro">{t("intro", { since: format.dateTime(new Date(digest.since), { dateStyle: "long" }) })}</p>
      {empty ? (
        <p className="gcs-notifPage__empty" data-testid="gcs-weekly-empty">
          <GcsIcon name="fa-regular fa-face-smile" className="gcs-emptyIcon" />
          {t("empty")}
        </p>
      ) : (
        <div className="gcs-weekly" data-testid="gcs-weekly">
          {digest.topics.length > 0 && (
            <GcsCard as="section" className="gcs-weekly__card" aria-labelledby="gcs-weekly-topics">
              <h2 id="gcs-weekly-topics" className="gcs-weekly__title">
                <GcsIcon name="fa-solid fa-fire" className="gcs-hIcon" />
                {t("topics")}
              </h2>
              <ol className="gcs-weekly__list">
                {digest.topics.map((x) => (
                  <li key={x.id} className="gcs-weekly__row">
                    <Link href={x.href}>{x.title}</Link>
                    <span className="gcs-weekly__meta">{t("replies", { count: x.replies })}</span>
                  </li>
                ))}
              </ol>
            </GcsCard>
          )}
          {digest.mentions.count > 0 && (
            <GcsCard as="section" className="gcs-weekly__card" aria-labelledby="gcs-weekly-mentions">
              <h2 id="gcs-weekly-mentions" className="gcs-weekly__title">
                <GcsIcon name="fa-solid fa-at" className="gcs-hIcon" />
                {t("mentions", { count: digest.mentions.count })}
              </h2>
              <ul className="gcs-weekly__list">
                {digest.mentions.items.map((m) => (
                  <li key={m.href} className="gcs-weekly__row">
                    <a href={m.href}>{m.text}</a>
                    <time className="gcs-weekly__meta" dateTime={m.at}>
                      {format.relativeTime(new Date(m.at))}
                    </time>
                  </li>
                ))}
              </ul>
              <Link href="/notifications?tab=mentions" className="gcs-arrowLink">
                {t("allMentions")}
              </Link>
            </GcsCard>
          )}
          {digest.servers.length > 0 && (
            <GcsCard as="section" className="gcs-weekly__card" aria-labelledby="gcs-weekly-servers">
              <h2 id="gcs-weekly-servers" className="gcs-weekly__title">
                <GcsIcon name="fa-solid fa-server" className="gcs-hIcon" />
                {t("servers")}
              </h2>
              <ul className="gcs-weekly__list">
                {digest.servers.map((s) => (
                  <li key={s.id} className="gcs-weekly__row">
                    <Link href={s.href}>{s.name}</Link>
                    <span className="gcs-weekly__meta">
                      {t("peak", { peak: s.peak, max: s.maxPlayers })}
                      {s.matches > 0 && ` · ${t("matches", { count: s.matches })}`}
                    </span>
                  </li>
                ))}
              </ul>
            </GcsCard>
          )}
          {digest.extras.map((e) => (
            <GcsCard key={e.key} as="section" className="gcs-weekly__card" aria-label={e.title}>
              <h2 className="gcs-weekly__title">{e.title}</h2>
              <ul className="gcs-weekly__list">
                {e.items.map((i) => (
                  <li key={i.href} className="gcs-weekly__row">
                    <Link href={i.href}>{i.text}</Link>
                  </li>
                ))}
              </ul>
            </GcsCard>
          ))}
        </div>
      )}
    </>
  );
}
