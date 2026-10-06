import { groupLegend, whoWasOnline, type GcsLegendGroup, type GcsWhoWasOnline } from "@gcs/modules";
import { GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { memberHref } from "@/lib/forum-urls";
import { onlineView } from "@/lib/online";
import { services } from "@/lib/services";
import { GcsWhoIsOnline } from "../forum/GcsWhoIsOnline";

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

/** „Cine a fost online” (24 h), lista cu numele stilizate. */
export async function GcsWhoWasOnline({ id }: { id: string }) {
  const [t, view] = await Promise.all([getTranslations("stats"), cachedWhoWasOnline()]);
  return (
    <section className="gcs-card gcs-sideCard gcs-widget" aria-labelledby={`gcs-widget-${id}`} data-widget="core.onlineDay" data-testid="gcs-who-was-online">
      <h2 id={`gcs-widget-${id}`} className="gcs-display gcs-sideCard__title">
        {t("onlineDay")}
      </h2>
      <p className="gcs-sideCard__line">{t("onlineDaySummary", { members: view.total })}</p>
      {view.members.length > 0 && (
        <p className="gcs-nameList">
          {view.members.map((m, i) => (
            <span key={m.id}>
              <GcsUserLink userId={m.id} name={m.name} nameKey={m.nameKey} href={memberHref(m)} />
              {i < view.members.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

/** Legenda grupurilor: numele în stilul grupului, cu iconița lui. */
export async function GcsGroupLegend({ id }: { id: string }) {
  const [t, groups] = await Promise.all([getTranslations("stats"), cachedLegend()]);
  return (
    <section className="gcs-card gcs-sideCard gcs-widget" aria-labelledby={`gcs-widget-${id}`} data-widget="core.groupLegend" data-testid="gcs-group-legend">
      <h2 id={`gcs-widget-${id}`} className="gcs-display gcs-sideCard__title">
        {t("legend")}
      </h2>
      <ul className="gcs-legend">
        {groups.map((g) => (
          <li key={g.id} className={`gcs-name--${g.key}`}>
            {g.icon && <GcsIcon name={g.icon} />}
            {g.name}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Panoul de statistici (specul etapei 5, imaginea de referință): plăcile (topicuri, postări, membri, cel mai nou membru
 * și plăcile aplicațiilor active), „Cine e online”, „Cine a fost online” (24 h) și legenda grupurilor.
 */
export async function GcsStatsPanel({ id }: { id: string }) {
  const { stats, forumQueries } = services();
  const [t, tAll, format, locale, tiles, community, online, day, legend, tOnline] = await Promise.all([
    getTranslations("stats"),
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
  return (
    <section className="gcs-card gcs-statsPanel gcs-widget" aria-labelledby={`gcs-widget-${id}`} data-widget="core.statsPanel" data-testid="gcs-stats-panel">
      <h2 id={`gcs-widget-${id}`} className="gcs-display gcs-sideCard__title">
        {t("title")}
      </h2>
      <ul className="gcs-statsPanel__tiles">
        {tiles.map((tile) => {
          const body = (
            <>
              <span className="gcs-statsPanel__icon" style={tile.color ? { color: tile.color } : undefined}>
                <GcsIcon name={tile.icon} />
              </span>
              <span className="gcs-statsPanel__value">{format.number(tile.value)}</span>
              <span className="gcs-statsPanel__label">{label(tile.labelKey)}</span>
            </>
          );
          return (
            <li key={tile.key} className="gcs-statsPanel__tile" data-tile={tile.key}>
              {tile.href ? <Link href={tile.href}>{body}</Link> : body}
            </li>
          );
        })}
        {community.newestMember && (
          <li className="gcs-statsPanel__tile gcs-statsPanel__tile--newest" data-tile="newest">
            <span className="gcs-statsPanel__icon">
              <GcsIcon name="fa-solid fa-user-plus" />
            </span>
            <span className="gcs-statsPanel__value gcs-statsPanel__value--name">
              <GcsUserLink userId={community.newestMember.id} name={community.newestMember.name} nameKey={community.newestMember.nameKey} href={memberHref(community.newestMember)} />
            </span>
            <span className="gcs-statsPanel__label">{t("newest")}</span>
          </li>
        )}
      </ul>
      <div className="gcs-statsPanel__sections">
        <div className="gcs-statsPanel__section">
          <GcsWhoIsOnline
            initial={online}
            locale={locale}
            labels={{ title: tOnline("title"), summary: tOnline.raw("summary") as string, record: tOnline.raw("record") as string, nobody: tOnline("nobody") }}
          />
          <Link href="/members?online=1" className="gcs-statsPanel__more" data-testid="gcs-stats-all-online">
            {t("allOnline")}
          </Link>
        </div>
        <div className="gcs-statsPanel__section">
          <h3>{t("onlineDay")}</h3>
          <p className="gcs-sideCard__line">{t("onlineDaySummary", { members: day.total })}</p>
          {day.members.length > 0 && (
            <p className="gcs-nameList" data-testid="gcs-online-day-members">
              {day.members.map((m, i) => (
                <span key={m.id}>
                  <GcsUserLink userId={m.id} name={m.name} nameKey={m.nameKey} href={memberHref(m)} />
                  {i < day.members.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          )}
        </div>
        {legend.length > 0 && (
          <div className="gcs-statsPanel__section">
            <h3>{t("legend")}</h3>
            <ul className="gcs-legend" data-testid="gcs-legend">
              {legend.map((g) => (
                <li key={g.id} className={`gcs-name--${g.key}`}>
                  {g.icon && <GcsIcon name={g.icon} />}
                  {g.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
