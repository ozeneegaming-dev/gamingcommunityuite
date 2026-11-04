import { GCS_ACTIVITY_FILTERS, loadStreamsConfig, type GcsActivityFilter, type GcsStreamItem, type GcsUserRef } from "@gcs/modules";
import { GcsAvatar, GcsButton, GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { landingCanonical } from "@/lib/landing";
import { currentActor } from "@/lib/actor";
import { forumHref, memberHref, postHref, topicHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  // Aleasă ca pagină de pornire, are aceeași adresă canonică pe `/` și pe /activity: `/`.
  return { title: (await getTranslations("activity"))("title"), alternates: { canonical: await landingCanonical("core", "/activity") } };
}

type Search = { type?: string; unread?: string; before?: string; stream?: string };

const FILTER_ICONS: Record<GcsActivityFilter, string> = {
  all: "fa-solid fa-bolt",
  topics: "fa-solid fa-plus",
  replies: "fa-solid fa-reply",
  statuses: "fa-solid fa-quote-left",
};
const KIND_ICONS: Record<GcsStreamItem["kind"], string> = {
  topic: "fa-solid fa-plus",
  reply: "fa-solid fa-reply",
  status: "fa-solid fa-quote-left",
  member: "fa-solid fa-user-plus",
  app: "fa-solid fa-cube",
};

/**
 * `/activity`: fluxul comunității (topicuri noi, răspunsuri, statusuri, membri noi), grupat pe zile, cu filtre și
 * „Doar necitite” pentru membri. Randat pe server, paginat cu cursor (`?before=`), deci adresele se pot partaja.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const [t, format, actor] = await Promise.all([getTranslations("activity"), getFormatter(), currentActor()]);
  const filter: GcsActivityFilter = GCS_ACTIVITY_FILTERS.includes(sp.type as GcsActivityFilter) ? (sp.type as GcsActivityFilter) : "all";
  const unread = actor.userId !== null && sp.unread === "1";
  // Fluxurile proprii din ACP › Fluxuri: tab-uri în plus; unul ales înlocuiește filtrele de tip.
  const streams = (await loadStreamsConfig(services().settings)).custom;
  const stream = streams.find((x) => x.key === sp.stream) ?? null;
  const page = await services().activity.page(actor, { filter: stream ? "all" : filter, unread, before: sp.before ?? null, stream: stream?.key ?? null });

  const href = (patch: { type?: GcsActivityFilter; unread?: boolean; before?: string | null; stream?: string | null }) => {
    const next = { type: patch.type ?? filter, unread: patch.unread ?? unread, before: patch.before ?? null, stream: patch.stream === undefined ? (patch.type ? null : (stream?.key ?? null)) : patch.stream };
    const params = new URLSearchParams();
    if (next.stream) params.set("stream", next.stream);
    else if (next.type !== "all") params.set("type", next.type);
    if (next.unread) params.set("unread", "1");
    if (next.before) params.set("before", next.before);
    const qs = params.toString();
    return qs ? `/activity?${qs}` : "/activity";
  };

  // Zilele, în fusul și limba viewer-ului: „Azi”, „Ieri”, apoi data.
  const dayKey = (d: Date) => format.dateTime(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  const now = new Date();
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const days: { key: string; label: string; items: GcsStreamItem[] }[] = [];
  for (const item of page.items) {
    const at = new Date(item.at);
    const key = dayKey(at);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: key === today ? t("today") : key === yesterday ? t("yesterday") : format.dateTime(at, { dateStyle: "full" }), items: [] };
      days.push(day);
    }
    day.items.push(item);
  }

  const who = (u: GcsUserRef | null) => (u ? <GcsMemberName userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u)} /> : <strong>{t("deletedUser")}</strong>);
  const line = (item: GcsStreamItem): ReactNode => {
    const user = () => who(item.user);
    if (item.kind === "topic" || item.kind === "reply") {
      const topic = () => (
        <Link className="gcs-stream__title" href={item.kind === "topic" ? topicHref(item.topic) : postHref(item.topic.id, item.postId)}>
          {item.topic.title}
        </Link>
      );
      return t.rich(`line.${item.kind}`, { user, topic });
    }
    if (item.kind === "app") {
      const title = () => (
        <Link className="gcs-stream__title" href={item.href}>
          {item.title}
        </Link>
      );
      return t.rich("line.app", { user, title, place: item.context?.label ?? "" });
    }
    if (item.kind === "status") return item.owner ? t.rich("line.wall", { user, owner: () => who(item.owner) }) : t.rich("line.status", { user });
    return t.rich("line.member", { user });
  };
  const empty = unread ? t("emptyUnread") : filter === "all" ? t("empty") : t("emptyFiltered");

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-bolt" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc">{t("lead")}</p>
        </div>
      </header>

      <div className="gcs-pageControls">
        <nav className="gcs-segLinks" aria-label={t("filters")}>
          {GCS_ACTIVITY_FILTERS.map((f) => (
            <Link
              key={f}
              href={href({ type: f })}
              className={`gcs-segLink${!stream && f === filter ? " gcs-segLink--active" : ""}`}
              aria-current={!stream && f === filter ? "page" : undefined}
              data-testid={`gcs-activity-filter-${f}`}
            >
              <GcsIcon name={FILTER_ICONS[f]} />
              {t(`filter.${f}`)}
            </Link>
          ))}
          {streams.map((x) => (
            <Link
              key={x.key}
              href={href({ stream: x.key })}
              className={`gcs-segLink${stream?.key === x.key ? " gcs-segLink--active" : ""}`}
              aria-current={stream?.key === x.key ? "page" : undefined}
              data-testid={`gcs-activity-stream-${x.key}`}
            >
              <GcsIcon name={x.icon || "fa-solid fa-list-ul"} />
              {x.name}
            </Link>
          ))}
        </nav>
        {actor.userId && (
          <Link href={href({ unread: !unread })} className="gcs-toggleLink" data-active={unread ? "" : undefined} data-testid="gcs-activity-unread">
            <GcsIcon name={unread ? "fa-solid fa-square-check" : "fa-regular fa-square"} />
            {t("unreadOnly")}
            <span className="gcs-srOnly">{unread ? t("toggleOn") : t("toggleOff")}</span>
          </Link>
        )}
      </div>

      <GcsCard as="section" className="gcs-stream" aria-label={t("title")} data-testid="gcs-activity">
        {days.length === 0 && (
          <p className="gcs-emptyState" data-testid="gcs-activity-empty">
            <GcsIcon name={unread ? "fa-solid fa-check-double" : "fa-regular fa-clock"} className="gcs-emptyIcon" />
            {empty}
          </p>
        )}
        {days.map((day) => (
          <section key={day.key} aria-label={day.label}>
            <h2 className="gcs-stream__dayTitle">{day.label}</h2>
            <ol className="gcs-stream__list">
              {day.items.map((item) => (
                <li key={item.key} className="gcs-stream__item" data-kind={item.kind} data-testid="gcs-activity-item">
                  <span className="gcs-stream__avatar">
                    <GcsAvatar
                      name={item.user?.name ?? "?"}
                      size="m"
                      {...(item.user?.image ? { src: item.user.image } : {})}
                      {...(item.user?.frameKey ? { frame: item.user.frameKey } : {})}
                    />
                    <span className={`gcs-stream__kind gcs-stream__kind--${item.kind}`} title={t(`kind.${item.kind}`)}>
                      <GcsIcon name={item.kind === "app" ? item.icon : KIND_ICONS[item.kind]} />
                      <span className="gcs-srOnly">{t(`kind.${item.kind}`)}</span>
                    </span>
                  </span>
                  <div className="gcs-stream__body">
                    <p className="gcs-stream__line">{line(item)}</p>
                    {"snippet" in item && item.snippet && <p className="gcs-stream__snippet">{item.snippet}</p>}
                    <p className="gcs-stream__meta">
                      {(item.kind === "topic" || item.kind === "reply") && (
                        <Link className="gcs-stream__forum" href={forumHref(item.forum)}>
                          <GcsIcon name="fa-regular fa-folder" />
                          {item.forum.name}
                        </Link>
                      )}
                      {item.kind === "app" && item.context && (
                        <Link className="gcs-stream__forum" href={item.context.href}>
                          <GcsIcon name={item.icon} />
                          {item.context.label}
                        </Link>
                      )}
                      {item.kind === "status" && (item.owner ?? item.user) && (
                        <Link className="gcs-stream__forum" href={`${memberHref((item.owner ?? item.user)!)}?tab=about`}>
                          <GcsIcon name="fa-regular fa-comment" />
                          {t("seeWall")}
                        </Link>
                      )}
                      <time dateTime={item.at} title={format.dateTime(new Date(item.at), { dateStyle: "medium", timeStyle: "short" })}>
                        {format.relativeTime(new Date(item.at))}
                      </time>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </GcsCard>

      {(page.next || sp.before) && (
        <nav className="gcs-stream__more" aria-label={t("pages")}>
          {sp.before && (
            <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-arrow-up" />}>
              <Link href={href({ before: null })}>{t("newest")}</Link>
            </GcsButton>
          )}
          {page.next && (
            <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-clock-rotate-left" />}>
              <Link href={href({ before: page.next })} data-testid="gcs-activity-older">
                {t("older")}
              </Link>
            </GcsButton>
          )}
        </nav>
      )}
    </>
  );
}
