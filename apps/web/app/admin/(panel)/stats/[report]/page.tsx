import { faSliders } from "@fortawesome/free-solid-svg-icons";
import { statsReportSection, type GcsStatsUnit } from "@gcs/modules";
import { GcsButton, GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { changePct } from "../../_components/dashboard/GcsAcpCharts";
import { saveStatsConfig } from "./actions";
import { GcsStatsChart } from "./GcsStatsChart";
import { reportOf, STATS_RANGES, statsQuery, type GcsStatsSearch } from "./query";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ report: string }>; searchParams: Promise<GcsStatsSearch> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { report } = await params;
  const t = await getTranslations("acp.statsReports");
  return { title: t.has(`${report}.title`) ? t(`${report}.title`) : undefined };
}

/**
 * ACP › Statistici › un raport (înregistrări, membri, conținut, online, clanuri, servere, VIP): perioada (7 / 30 / 90 /
 * 365 de zile sau de la–până la), gruparea pe zile / săptămâni / luni, totalul fiecărei serii cu variația față de
 * perioada anterioară, graficul, plăcile și topurile raportului, exportul CSV. Panoul „Setări” e comun rapoartelor.
 */
export default async function AcpStatsReportPage({ params, searchParams }: Props) {
  const report = await reportOf((await params).report);
  if (!report) notFound();
  const panel = await requireAcpSection(statsReportSection(report));
  const sp = await searchParams;
  const { statsReports, settings, acp, registry } = services();
  const [t, format, locale, cfg, timeZone, canEdit] = await Promise.all([
    getTranslations("acp.statsReports"),
    getFormatter(),
    getLocale(),
    statsReports.config(),
    settings.get<string>("site.timezone").catch(() => "Europe/Bucharest"),
    acp.can(panel.actor, "stats.overview", "edit"),
  ]);
  const q = statsQuery(sp, cfg, timeZone || "Europe/Bucharest");
  const r = await statsReports.run(panel.actor, report, { from: q.from, to: q.to, group: q.group, timeZone: timeZone || "Europe/Bucharest" });
  const icon = registry.acpMenu().flatMap((s) => s.items).find((i) => i.href === `/admin/stats/${report}`)?.icon ?? "fa-solid fa-chart-line";

  const unit = (u: GcsStatsUnit, v: number) => (u === "hours" ? t("unitHours", { n: format.number(v, { maximumFractionDigits: 1 }) }) : u === "money" ? format.number(v, { maximumFractionDigits: 2 }) : format.number(v));
  const label = (key: string) => (t.has(key) ? t(key) : key.split(".").pop()!);
  // Metodele de înregistrare (furnizorii conturilor) au nume traduse; restul rândurilor își păstrează eticheta.
  const method = (raw: string) => (t.has(`methods.${raw}`) ? t(`methods.${raw}`) : raw);
  const bucketLabel = (key: string) => {
    const d = new Date(`${key}T12:00:00Z`);
    return q.group === "month" ? format.dateTime(d, { month: "short", year: "2-digit", timeZone: "UTC" }) : format.dateTime(d, { day: "numeric", month: "short", timeZone: "UTC" });
  };
  const href = (patch: Partial<GcsStatsSearch>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    const qs = p.toString();
    return `/admin/stats/${report}${qs ? `?${qs}` : ""}`;
  };
  const csv = `/admin/stats/${report}/export.csv?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <GcsAcpTitle
        icon={icon}
        description={t(`${report}.description`)}
        actions={
          <>
            <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-file-csv" />}>
              <a href={csv} download data-testid="gcs-stats-csv">
                {t("csv")}
              </a>
            </GcsButton>
            {canEdit && (
              <GcsAcpEditPanel label={t("settings")} variant="primary" buttonIcon={<GcsIconSvg icon={faSliders} />} title={t("settings")} titleIcon={<GcsIconSvg icon={faSliders} />} testId="gcs-stats-settings">
                <GcsActionForm action={saveStatsConfig} submitLabel={t("save")} submitKind="save">
                  <fieldset className="gcs-formSec">
                    <legend>{t("cfg.title")}</legend>
                    <label className="gcs-toggleRow">
                      <span>
                        {t("cfg.excludeStaff")}
                        <small className="gcs-achHint">{t("cfg.excludeStaffHint")}</small>
                      </span>
                      <input type="checkbox" name="excludeStaff" defaultChecked={cfg.excludeStaff} />
                    </label>
                    <label className="gcs-field">
                      {t("cfg.weekStart")}
                      <select className="gcs-input" name="weekStart" defaultValue={cfg.weekStart}>
                        <option value="monday">{t("cfg.monday")}</option>
                        <option value="sunday">{t("cfg.sunday")}</option>
                      </select>
                    </label>
                    <label className="gcs-field">
                      {t("cfg.defaultDays")}
                      <select className="gcs-input" name="defaultDays" defaultValue={String(cfg.defaultDays)}>
                        {STATS_RANGES.map((d) => (
                          <option key={d} value={d}>
                            {t("rangeDays", { days: d })}
                          </option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                </GcsActionForm>
              </GcsAcpEditPanel>
            )}
          </>
        }
      >
        {t(`${report}.title`)}
      </GcsAcpTitle>

      <GcsCard className="gcs-statsFilters" data-testid="gcs-stats-filters">
        <nav className="gcs-segLinks" aria-label={t("range")}>
          {STATS_RANGES.map((d) => (
            <Link key={d} href={href({ days: String(d), from: undefined, to: undefined })} className={`gcs-segLink${!q.custom && q.days === d ? " gcs-segLink--active" : ""}`} aria-current={!q.custom && q.days === d ? "page" : undefined}>
              {t("rangeDays", { days: d })}
            </Link>
          ))}
        </nav>
        <form method="get" className="gcs-statsFilters__form">
          <label className="gcs-field">
            {t("from")}
            <input className="gcs-input" type="date" name="from" defaultValue={r.from} />
          </label>
          <label className="gcs-field">
            {t("to")}
            <input className="gcs-input" type="date" name="to" defaultValue={r.to} />
          </label>
          <label className="gcs-field">
            {t("group")}
            <select className="gcs-input" name="group" defaultValue={q.group} data-testid="gcs-stats-group">
              {(["day", "week", "month"] as const).map((g) => (
                <option key={g} value={g}>
                  {t(`groups.${g}`)}
                </option>
              ))}
            </select>
          </label>
          <GcsButton variant="ghost" type="submit" icon={<GcsIcon name="fa-solid fa-filter" />}>
            {t("apply")}
          </GcsButton>
        </form>
      </GcsCard>

      <ul className="gcs-acpTiles gcs-sysTiles" data-testid="gcs-stats-tiles">
        {r.series.map((s, i) => {
          const pct = changePct(s.total, s.previous);
          return (
            <li key={s.key} className={`gcs-acpTile gcs-statsTile gcs-statsTile--${i + 1}`} data-series={s.key}>
              <div className="gcs-acpTile__inner">
                <span className="gcs-acpTile__icon" aria-hidden="true">
                  <GcsIcon name={pct >= 0 ? "fa-solid fa-arrow-trend-up" : "fa-solid fa-arrow-trend-down"} />
                </span>
                <span className="gcs-acpTile__value gcs-display">{unit(s.unit, s.total)}</span>
                <span className="gcs-acpTile__label">
                  {label(`series.${report}.${s.key}`)}{" "}
                  <span className={`gcs-statsDelta gcs-statsDelta--${pct > 0 ? "up" : pct < 0 ? "down" : "flat"}`} title={t("previous", { value: unit(s.unit, s.previous) })}>
                    {pct > 0 ? "+" : ""}
                    {pct}%
                  </span>
                </span>
              </div>
            </li>
          );
        })}
        {r.tiles.map((tile) => (
          <li key={tile.key} className="gcs-acpTile" data-tile={tile.key}>
            <div className="gcs-acpTile__inner">
              <span className="gcs-acpTile__icon" aria-hidden="true">
                <GcsIcon name="fa-solid fa-hashtag" />
              </span>
              <span className="gcs-acpTile__value gcs-display">{unit(tile.unit, tile.value)}</span>
              <span className="gcs-acpTile__label">{label(`tiles.${tile.key}`)}</span>
            </div>
          </li>
        ))}
      </ul>

      <GcsCard as="section" className="gcs-acpPanel gcs-statsChartCard" aria-label={t(`${report}.title`)}>
        <GcsStatsChart
          buckets={r.buckets.map((b) => bucketLabel(b.key))}
          series={r.series.map((s) => ({ key: s.key, label: label(`series.${report}.${s.key}`) }))}
          values={r.buckets.map((b) => b.values)}
          locale={locale}
          title={t("chartTitle", { report: t(`${report}.title`), from: format.dateTime(new Date(`${r.from}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }), to: format.dateTime(new Date(`${r.to}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) })}
        />
      </GcsCard>

      {r.tops.length > 0 && (
        <div className="gcs-sysGrid">
          {r.tops.map((top) => (
            <GcsCard key={top.key} as="section" className="gcs-acpPanel" aria-label={label(`tops.${report}.${top.key}`)} data-testid={`gcs-stats-top-${top.key}`}>
              <div className="gcs-acpPanel__head">
                <h2 className="gcs-acpPanel__title">
                  <GcsIcon name="fa-solid fa-ranking-star" /> {label(`tops.${report}.${top.key}`)}
                </h2>
              </div>
              {top.rows.length === 0 ? (
                <p className="gcs-acpList__empty gcs-sysEmpty">{t("noData")}</p>
              ) : (
                <ol className="gcs-sysList gcs-statsTop">
                  {top.rows.map((row, i) => {
                    const max = top.rows[0]!.value || 1;
                    return (
                      <li key={`${row.label}-${i}`} className="gcs-sysList__row">
                        <span className="gcs-statsTop__rank">{i + 1}</span>
                        <span className="gcs-sysList__body">
                          <strong>
                            {row.user ? <GcsMemberLink user={row.user} href={`/admin/members/${row.user.id}`} /> : row.href ? <Link href={row.href}>{row.label}</Link> : method(row.label)}
                          </strong>
                          <span className="gcs-sysDisk__bar" aria-hidden="true">
                            <span style={{ width: `${Math.round((row.value / max) * 100)}%` }} />
                          </span>
                        </span>
                        <span className="gcs-statsTop__value">{unit(top.unit, row.value)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </GcsCard>
          ))}
        </div>
      )}
    </>
  );
}
