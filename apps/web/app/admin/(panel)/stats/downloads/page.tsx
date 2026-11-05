import { DOWNLOADS_ACP } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireAcpAppSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsStatsChart } from "../[report]/GcsStatsChart";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.downloads"))("stats.title") };
}

const RANGES = [7, 30, 90, 365] as const;
type Props = { searchParams: Promise<{ days?: string }> };

/**
 * ACP → Statistici → Descărcări: descărcările și trimiterile pe zile (7 / 30 / 90 / 365), totalurile, cele mai
 * descărcate fișiere, autorii cu cele mai multe descărcări și membrii care descarcă cel mai mult.
 */
export default async function AcpDownloadStats({ searchParams }: Props) {
  const { actor } = await requireAcpAppSection("downloads", DOWNLOADS_ACP.stats);
  const raw = Number((await searchParams).days);
  const days = (RANGES as readonly number[]).includes(raw) ? raw : 30;
  const [t, format, locale, data] = await Promise.all([getTranslations("acp.downloads.stats"), getFormatter(), getLocale(), services().downloads.admin.stats(actor, days)]);
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-download" description={t("help")}>
        {t("title")}
      </GcsAcpTitle>
      <nav className="gcs-dlSorts" aria-label={t("range")}>
        {RANGES.map((d) => (
          <Link key={d} href={`/admin/stats/downloads?days=${d}`} className="gcs-chip gcs-sweep" aria-current={d === days ? "true" : undefined}>
            {t("days", { count: d })}
          </Link>
        ))}
      </nav>
      <ul className="gcs-acpTiles gcs-sysTiles">
        <li className="gcs-acpTile"><div className="gcs-acpTile__inner"><span className="gcs-acpTile__icon" aria-hidden="true"><GcsIcon name="fa-solid fa-download" /></span><span className="gcs-acpTile__value gcs-display">{format.number(data.totals.downloads)}</span><span className="gcs-acpTile__label">{t("downloads")}</span></div></li>
        <li className="gcs-acpTile"><div className="gcs-acpTile__inner"><span className="gcs-acpTile__icon" aria-hidden="true"><GcsIcon name="fa-solid fa-cloud-arrow-up" /></span><span className="gcs-acpTile__value gcs-display">{format.number(data.totals.submissions)}</span><span className="gcs-acpTile__label">{t("submissions")}</span></div></li>
      </ul>
      <GcsCard as="section" className="gcs-acpPanel">
        <GcsStatsChart
          title={t("chart")}
          locale={locale}
          buckets={data.series.map((s) => format.dateTime(new Date(`${s.day}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }))}
          series={[{ key: "downloads", label: t("downloads") }, { key: "submissions", label: t("submissions") }]}
          values={data.series.map((s) => [s.downloads, s.submissions])}
        />
      </GcsCard>
      <div className="gcs-sysGrid">
        <GcsCard as="section" className="gcs-acpPanel">
          <div className="gcs-acpPanel__head"><h2 className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-fire" /> {t("topFiles")}</h2></div>
          <ol className="gcs-dlAcpList">
            {data.topFiles.map((f) => <li key={f.id}><Link href={f.href}>{f.title}</Link><span className="gcs-muted">{format.number(f.downloads)}</span></li>)}
          </ol>
        </GcsCard>
        <GcsCard as="section" className="gcs-acpPanel">
          <div className="gcs-acpPanel__head"><h2 className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-user-pen" /> {t("topAuthors")}</h2></div>
          <ol className="gcs-dlAcpList">
            {await Promise.all(data.topAuthors.map(async (a, i) => <li key={a.user?.id ?? i}>{a.user ? <GcsMemberLink user={a.user} /> : "—"}<span className="gcs-muted">{t("authorRow", { files: a.files, downloads: a.downloads })}</span></li>))}
          </ol>
        </GcsCard>
        <GcsCard as="section" className="gcs-acpPanel">
          <div className="gcs-acpPanel__head"><h2 className="gcs-acpPanel__title"><GcsIcon name="fa-solid fa-users" /> {t("topDownloaders")}</h2></div>
          <ol className="gcs-dlAcpList">
            {await Promise.all(data.topDownloaders.map(async (u, i) => <li key={u.user?.id ?? i}>{u.user ? <GcsMemberLink user={u.user} /> : "—"}<span className="gcs-muted">{format.number(u.downloads)}</span></li>))}
          </ol>
        </GcsCard>
      </div>
    </>
  );
}
