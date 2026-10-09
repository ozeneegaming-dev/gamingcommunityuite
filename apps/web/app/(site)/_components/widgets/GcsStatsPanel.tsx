import { groupLegend, whoWasOnline, type GcsLegendGroup, type GcsWhoWasOnline } from "@gcs/modules";
import { GcsAvatar, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { memberHref } from "@/lib/forum-urls";
import { onlineView } from "@/lib/online";
import { services } from "@/lib/services";
import { GcsWhoIsOnline } from "../forum/GcsWhoIsOnline";
import { GcsStatsPanelFrame } from "./GcsStatsPanelFrame";
import { GcsWidgetTitle, widgetIcon } from "./GcsWidgetTitle";

/** „Cine a fost online” (24 h): lista e aceeași pentru toți vizitatorii, deci se calculează cel mult o dată pe minut. */
async function cachedWhoWasOnline(): Promise<GcsWhoWasOnline> {
  const { cache, db } = services();
  const hit = await cache.get<GcsWhoWasOnline>("stats:who-was-online");
  if (hit) return hit;
  const view = await whoWasOnline(db);
  await cache.set("stats:who-was-online", view, { ttlSec: 60, tags: ["stats"] });
  return view;
}

/** Legenda grupurilor (se schimbă doar din ACP: tag-ul `name-styles` o invalidează la orice schimbare de grup). */
async function cachedLegend(): Promise<GcsLegendGroup[]> {
  const { cache, db } = services();
  const hit = await cache.get<GcsLegendGroup[]>("stats:group-legend");
  if (hit) return hit;
  const legend = await groupLegend(db);
  await cache.set("stats:group-legend", legend, { ttlSec: 600, tags: ["name-styles"] });
  return legend;
}

/** O variabilă CSS pe element (culoarea plăcii / a grupului); fără valoare, CSS-ul folosește culoarea implicită. */
const cssVar = (name: string, value: string | null | undefined): CSSProperties | undefined => (value ? ({ [name]: value } as CSSProperties) : undefined);

/** Numele membrilor activi în ultimele 24 h, în stilul grupului fiecăruia. */
function DayNames({ view, nobody, testId }: { view: GcsWhoWasOnline; nobody: string; testId?: string }) {
  if (view.members.length === 0) return <p className="gcs-onlineBlock__empty">{nobody}</p>;
  return (
    <p className="gcs-onlineBlock__names" data-testid={testId}>
      {view.members.map((m, i) => (
        <span key={m.id}>
          <GcsMemberName userId={m.id} name={m.name} nameKey={m.nameKey} href={memberHref(m)} />
          {i < view.members.length - 1 ? ", " : ""}
        </span>
      ))}
    </p>
  );
}

/** Sumarul „Cine a fost online”: membrii vizibili și cei anonimi (statusul ascuns), cu puncte colorate. */
async function DayDots({ view }: { view: GcsWhoWasOnline }) {
  const t = await getTranslations("stats.panel");
  return (
    <ul className="gcs-onlineBlock__dots">
      <li data-dot="members">{t("members", { count: Math.max(0, view.total - view.hidden) })}</li>
      <li data-dot="anonymous">{t("anonymous", { count: view.hidden })}</li>
    </ul>
  );
}

/** Pastilele legendei: conturul și textul în culoarea grupului, cu iconița și numele (stilul grupului). */
function LegendPills({ groups, testId }: { groups: GcsLegendGroup[]; testId?: string }) {
  return (
    <ul className="gcs-legend" data-testid={testId}>
      {groups.map((g) => (
        <li key={g.id} className="gcs-legend__pill" style={cssVar("--gcs-group", g.color)}>
          {g.icon && (
            <span className="gcs-legend__icon" aria-hidden="true">
              <GcsIcon name={g.icon} />
            </span>
          )}
          <span className={`gcs-legend__name gcs-name--${g.key}`}>{g.name}</span>
        </li>
      ))}
    </ul>
  );
}

/** „Cine a fost online” (24 h), widget-ul separat: sumarul cu puncte și lista cu numele stilizate. */
export async function GcsWhoWasOnline({ id, config }: { id: string; config?: Record<string, unknown> }) {
  const [t, tp, view] = await Promise.all([getTranslations("stats"), getTranslations("stats.panel"), cachedWhoWasOnline()]);
  return (
    <section className="gcs-card gcs-sideCard gcs-widget gcs-dayCard" aria-labelledby={`gcs-widget-${id}`} data-widget="core.onlineDay" data-testid="gcs-who-was-online">
      <GcsWidgetTitle id={`gcs-widget-${id}`} icon={widgetIcon("core.onlineDay", config)}>
        {t("onlineDay")}
      </GcsWidgetTitle>
      <p className="gcs-sideCard__line">{t("onlineDaySummary", { members: view.total })}</p>
      <DayDots view={view} />
      <DayNames view={view} nobody={tp("dayNobody")} />
    </section>
  );
}

/** Legenda grupurilor, widget-ul separat: pastilele în culoarea grupurilor, cu iconițele lor. */
export async function GcsGroupLegend({ id, config }: { id: string; config?: Record<string, unknown> }) {
  const [t, groups] = await Promise.all([getTranslations("stats"), cachedLegend()]);
  return (
    <section className="gcs-card gcs-sideCard gcs-widget" aria-labelledby={`gcs-widget-${id}`} data-widget="core.groupLegend" data-testid="gcs-group-legend">
      <GcsWidgetTitle id={`gcs-widget-${id}`} icon={widgetIcon("core.groupLegend", config)}>
        {t("legend")}
      </GcsWidgetTitle>
      <LegendPills groups={groups} />
    </section>
  );
}

/**
 * Panoul de statistici (imaginile de referință): bara de titlu cu iconița și butonul de restrângere, plăcile
 * (topicuri, postări, membri, plăcile aplicațiilor active și cel mai nou membru), „Cine e online” (live),
 * „Cine a fost online” (24 h) și legenda grupurilor.
 */
export async function GcsStatsPanel({ id, config }: { id: string; config?: Record<string, unknown> }) {
  const { stats, forumQueries } = services();
  const [t, tp, tAll, format, locale, tiles, community, online, day, legend, tOnline] = await Promise.all([
    getTranslations("stats"),
    getTranslations("stats.panel"),
    getTranslations(),
    getFormatter(),
    getLocale(),
    stats.tiles(),
    forumQueries.stats(),
    onlineView(),
    cachedWhoWasOnline(),
    cachedLegend(),
    getTranslations("online"),
  ]);
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);
  const newest = community.newestMember;
  const headingId = `gcs-widget-${id}`;

  return (
    <GcsStatsPanelFrame
      id={id}
      labels={{ collapse: tp("collapse"), expand: tp("expand") }}
      heading={
        <GcsWidgetTitle id={headingId} icon={widgetIcon("core.statsPanel", config)} className="gcs-statsPanel__title">
          {tp("title")}
        </GcsWidgetTitle>
      }
    >
      <ul className="gcs-statsPanel__tiles">
        {tiles.map((tile) => {
          const body = (
            <>
              <span className="gcs-statsTile__icon" aria-hidden="true">
                <GcsIcon name={tile.icon} />
              </span>
              <span className="gcs-statsTile__text">
                <span className="gcs-statsTile__value">{format.number(tile.value)}</span>
                <span className="gcs-statsTile__label">{label(tile.labelKey)}</span>
              </span>
            </>
          );
          return (
            <li key={tile.key} className="gcs-statsTile" data-tile={tile.key} style={cssVar("--gcs-tile", tile.color)}>
              {tile.href ? (
                <Link href={tile.href} className="gcs-statsTile__inner">
                  {body}
                </Link>
              ) : (
                <div className="gcs-statsTile__inner">{body}</div>
              )}
            </li>
          );
        })}
        {newest && (
          <li className="gcs-statsTile gcs-statsTile--newest" data-tile="newest">
            <div className="gcs-statsTile__inner">
              <a href={memberHref(newest)} className="gcs-statsTile__avatar" tabIndex={-1} aria-hidden="true">
                <GcsAvatar name={newest.name} size="m" userId={newest.id} {...(newest.image ? { src: newest.image } : {})} {...(newest.frameKey ? { frame: newest.frameKey } : {})} />
              </a>
              <span className="gcs-statsTile__text">
                <span className="gcs-statsTile__kicker">
                  <GcsIcon name="fa-solid fa-user-plus" />
                  {tp("newMember")}
                </span>
                <span className="gcs-statsTile__name">
                  <GcsMemberName userId={newest.id} name={newest.name} nameKey={newest.nameKey} href={memberHref(newest)} />
                </span>
                {newest.joinedAt && (
                  <span className="gcs-statsTile__date">
                    <GcsIcon name="fa-solid fa-calendar-days" />
                    <time dateTime={newest.joinedAt}>{format.dateTime(new Date(newest.joinedAt), { day: "numeric", month: "short", year: "numeric" })}</time>
                  </span>
                )}
              </span>
            </div>
          </li>
        )}
      </ul>

      <GcsWhoIsOnline
        variant="panel"
        initial={online}
        locale={locale}
        headingId={`${headingId}-online`}
        labels={{ title: tOnline("title"), summary: tOnline.raw("summary") as string, record: tOnline.raw("record") as string, nobody: tOnline("nobody") }}
        action={
          <Link href="/members?online=1" className="gcs-onlineBlock__btn gcs-onlineBlock__btn--now" data-testid="gcs-stats-all-online">
            {tp("seeAll")}
          </Link>
        }
      />

      <section className="gcs-onlineBlock gcs-onlineBlock--day" aria-labelledby={`${headingId}-day`} data-testid="gcs-stats-online-day">
        <div className="gcs-onlineBlock__info">
          <h3 id={`${headingId}-day`} className="gcs-onlineBlock__title">
            {t("onlineDay")}
          </h3>
          <p className="gcs-onlineBlock__summary">{tp("daySummary")}</p>
          <DayDots view={day} />
        </div>
        <div className="gcs-onlineBlock__list">
          <p className="gcs-onlineBlock__listTitle">{tp("dayList")}</p>
          <DayNames view={day} nobody={tp("dayNobody")} testId="gcs-online-day-members" />
        </div>
        <div className="gcs-onlineBlock__action">
          <Link href="/members" className="gcs-onlineBlock__btn gcs-onlineBlock__btn--day" data-testid="gcs-stats-all-day">
            {tp("seeAll")}
          </Link>
        </div>
      </section>

      {legend.length > 0 && (
        <section className="gcs-legendBlock" aria-labelledby={`${headingId}-legend`}>
          <h3 id={`${headingId}-legend`} className="gcs-legendBlock__title">
            <GcsIcon name="fa-solid fa-users" />
            {tp("legendTitle")}
          </h3>
          <LegendPills groups={legend} testId="gcs-legend" />
        </section>
      )}
    </GcsStatsPanelFrame>
  );
}
