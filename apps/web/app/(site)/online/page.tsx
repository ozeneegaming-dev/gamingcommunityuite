import { GcsAvatar, GcsBadge, GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { ONLINE_FILTERS, whereOnline, type GcsOnlineFilter, type GcsWhereLocation } from "@/lib/where-online";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("onlinePage"))("title") };
}

const FILTER_ICONS: Record<GcsOnlineFilter, string> = { all: "fa-solid fa-users", members: "fa-solid fa-user", staff: "fa-solid fa-user-shield", guests: "fa-solid fa-user-secret" };
const LOCATION_ICONS: Record<string, string> = {
  index: "fa-solid fa-house",
  topic: "fa-solid fa-comments",
  forum: "fa-solid fa-folder-open",
  profile: "fa-solid fa-id-card",
  members: "fa-solid fa-users",
  staff: "fa-solid fa-shield-halved",
  online: "fa-solid fa-signal",
  chat: "fa-solid fa-message",
  messages: "fa-solid fa-envelope",
  search: "fa-solid fa-magnifying-glass",
  settings: "fa-solid fa-gear",
  app: "fa-solid fa-cubes",
  page: "fa-solid fa-file-lines",
};

type T = Awaited<ReturnType<typeof getTranslations<"onlinePage">>>;

/** „Vede topicul X”, „Citește forumul Y”, „Se uită la profilul lui Z”… (titlul doar dacă viewer-ul are acces). */
function Where({ loc, t }: { loc: GcsWhereLocation | null; t: T }) {
  if (!loc) return <span className="gcs-onlinePage__muted">{t("where.unknown")}</span>;
  const icon = <GcsIcon name={LOCATION_ICONS[loc.kind] ?? "fa-solid fa-file-lines"} />;
  if (loc.title && loc.href) {
    return (
      <span>
        {icon} {t(`where.${loc.kind}` as never)}{" "}
        <Link href={loc.href} data-testid="gcs-online-where-link">
          {loc.title}
        </Link>
      </span>
    );
  }
  if (loc.kind === "app") return <span>{icon} {t("where.app", { app: t(`apps.${loc.app}` as never) })}</span>;
  if (loc.kind === "topic" || loc.kind === "forum" || loc.kind === "profile") return <span>{icon} {t(`where.${loc.kind}Hidden` as never)}</span>;
  return <span>{icon} {t(`where.${loc.kind}` as never)}</span>;
}

/**
 * `/online` (Membri v2): cine e pe site acum și unde („Vede topicul X”), cu ora ultimei pagini; IP-ul doar pentru staff.
 * Filtrul: toți / membri / staff / vizitatori. Membrii cu statusul ascuns apar doar staff-ului.
 */
export default async function OnlinePage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const filter: GcsOnlineFilter = (ONLINE_FILTERS as readonly string[]).includes(sp.show ?? "") ? (sp.show as GcsOnlineFilter) : "all";
  const [t, format, actor] = await Promise.all([getTranslations("onlinePage"), getFormatter(), currentActor()]);
  const [view, record] = await Promise.all([whereOnline(actor, filter), services().presence.online()]);

  return (
    <>
      <header className="gcs-pageHeader">
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-signal" className="gcs-hIcon" />
          {t("title")}
        </h1>
        <p className="gcs-pageHeader__lead">
          {t("lead", { count: view.counts.all })}
          {record.record && <> · {t("record", { count: record.record.count, date: format.dateTime(record.record.at, { dateStyle: "medium" }) })}</>}
        </p>
      </header>
      <nav className="gcs-segLinks gcs-onlinePage__filters" aria-label={t("filterLabel")} data-testid="gcs-online-filters">
        {ONLINE_FILTERS.map((f) => (
          <Link key={f} href={f === "all" ? "/online" : `/online?show=${f}`} className={`gcs-segLink${filter === f ? " gcs-segLink--active" : ""}`} aria-current={filter === f ? "page" : undefined} data-testid={`gcs-online-filter-${f}`}>
            <GcsIcon name={FILTER_ICONS[f]} /> {t(`filters.${f}`)} <span className="gcs-onlinePage__count">{view.counts[f]}</span>
          </Link>
        ))}
      </nav>
      <GcsCard className="gcs-onlinePage">
        {view.rows.length === 0 ? (
          <p className="gcs-onlinePage__empty" data-testid="gcs-online-empty">
            {t("empty")}
          </p>
        ) : (
          <ul className="gcs-onlinePage__list" data-testid="gcs-online-list">
            {view.rows.map((r) => (
              <li key={r.key} className="gcs-onlinePage__row" data-testid="gcs-online-row" data-kind={r.kind} data-name={r.user?.name ?? ""}>
                <span className="gcs-onlinePage__who">
                  {r.user ? (
                    <>
                      <GcsAvatar name={r.user.name} size="s" userId={r.user.id} {...(r.user.image ? { src: r.user.image } : {})} {...(r.user.frameKey ? { frame: r.user.frameKey } : {})} />
                      <GcsMemberName userId={r.user.id} name={r.user.name} nameKey={r.user.nameKey} href={memberHref(r.user)} />
                      {r.user.staff && <GcsBadge tone="accent">{t("staffBadge")}</GcsBadge>}
                      {r.user.hidden && <GcsBadge tone="neutral">{t("hiddenBadge")}</GcsBadge>}
                    </>
                  ) : (
                    <>
                      <span className="gcs-onlinePage__guest" aria-hidden="true">
                        <GcsIcon name="fa-solid fa-user-secret" />
                      </span>
                      <span>{t("guest")}</span>
                    </>
                  )}
                </span>
                <span className="gcs-onlinePage__where" data-testid="gcs-online-where">
                  <Where loc={r.location} t={t} />
                </span>
                <span className="gcs-onlinePage__time">
                  <time dateTime={r.at}>{format.relativeTime(new Date(r.at))}</time>
                </span>
                {view.staffView && (
                  <span className="gcs-onlinePage__ip" data-testid="gcs-online-ip">
                    {r.ip ?? "—"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {view.hidden > 0 && <p className="gcs-onlinePage__muted gcs-onlinePage__hidden">{t("hiddenCount", { count: view.hidden })}</p>}
      </GcsCard>
    </>
  );
}
