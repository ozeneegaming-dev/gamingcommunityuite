import { formatBytes } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsDownloadStatus } from "../../_components/downloads/GcsDownloadCards";
import { GcsRelTime } from "../../_components/forum/GcsRelTime";
import { GcsPagination } from "../../_components/forum/GcsPagination";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("downloads"))("mine") };
}

type Props = { searchParams: Promise<{ page?: string }> };

/** `/downloads/mine`: trimiterile membrului, cu starea (verificare, coadă, publicat, respins, carantină) și spațiul folosit. */
export default async function MyDownloadsPage({ searchParams }: Props) {
  const { downloads } = services();
  const actor = await currentActor();
  if (!(await downloads.queries.canUseApp(actor))) notFound();
  if (!actor.userId) redirect(`/login?next=${encodeURIComponent("/downloads/mine")}`);
  const raw = (await searchParams).page;
  const [t, locale, view] = await Promise.all([getTranslations("downloads"), getLocale(), downloads.queries.mine(actor, raw && /^\d{1,5}$/.test(raw) ? Number(raw) : 1)]);
  if (!view) notFound();
  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("title")} className="gcs-breadcrumb">
          <ol>
            <li><Link href="/downloads"><GcsIcon name="fa-solid fa-download" className="gcs-breadcrumb__home" />{t("title")}</Link></li>
            <li aria-current="page">{t("mine")}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title"><GcsIcon name="fa-solid fa-folder-open" className="gcs-hIcon" />{t("mine")}</h1>
          <p className="gcs-pageHeader__desc" data-testid="gcs-downloads-quota">
            {view.quota.limit === null ? t("quotaUnlimited", { used: formatBytes(view.quota.used, locale) }) : t("quotaUsed", { used: formatBytes(view.quota.used, locale), limit: formatBytes(view.quota.limit, locale) })}
          </p>
        </div>
        <div className="gcs-pageHeader__actions">
          <Link className="gcs-btn gcs-btn--primary" href="/downloads/submit"><GcsIcon name="fa-solid fa-cloud-arrow-up" />{t("submit")}</Link>
        </div>
      </header>
      {view.quota.limit !== null && (
        <progress className="gcs-dlQuota" max={view.quota.limit} value={Math.min(view.quota.used, view.quota.limit)} aria-label={t("quotaLabel")} />
      )}
      {view.files.length === 0 ? (
        <div className="gcs-card gcs-dlEmpty"><GcsIcon name="fa-solid fa-box-open" className="gcs-emptyIcon" /><p>{t("mineEmpty")}</p></div>
      ) : (
        <ul className="gcs-card gcs-dlMine" data-testid="gcs-downloads-mine">
          {view.files.map((f) => (
            <li key={f.id} className="gcs-dlMine__row" data-status={f.status}>
              <Link href={f.href} className="gcs-dlMine__title">{f.title}</Link>
              {f.version && <span className="gcs-dlVersion">{f.version}</span>}
              <span className="gcs-muted">{f.category.name}</span>
              <GcsRelTime at={f.createdAt} />
              <GcsDownloadStatus status={f.status} />
              {f.pendingVersion && <span className="gcs-dlStatus" data-status={f.pendingVersion.status.toLowerCase()}>{t("mineVersion", { label: f.pendingVersion.label || "—", status: t(`status.${f.pendingVersion.status.toLowerCase()}`) })}</span>}
              {f.rejectReason && f.status === "rejected" && <span className="gcs-dlMine__reason">{t("reason", { reason: f.rejectReason })}</span>}
              <span className="gcs-dlMine__stats"><GcsIcon name="fa-solid fa-download" />{f.downloads}</span>
            </li>
          ))}
        </ul>
      )}
      <GcsPagination pagination={view.pagination} href={(p) => (p > 1 ? `/downloads/mine?page=${p}` : "/downloads/mine")} />
    </>
  );
}
