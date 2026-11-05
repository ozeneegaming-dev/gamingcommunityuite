import { formatBytes, type GcsCategoryNode, type GcsDownloadCard } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { GcsMemberLink, GcsNamedHtml } from "@/lib/member-names";
import { GcsRelTime } from "../forum/GcsRelTime";
import { GcsStarsStatic } from "../topic/GcsTopicRating";

/** Eticheta stării pentru fișierele care nu sunt simplu publicate (autorul și staff-ul le văd în liste). */
export async function GcsDownloadStatus({ status }: { status: string }) {
  if (status === "approved") return null;
  const t = await getTranslations("downloads.status");
  const icon = status === "pending" ? "fa-solid fa-hourglass-half" : status === "scanning" ? "fa-solid fa-shield-halved" : status === "quarantined" ? "fa-solid fa-shield-virus" : status === "hidden" ? "fa-solid fa-eye-slash" : "fa-solid fa-ban";
  return (
    <span className="gcs-dlStatus" data-status={status} data-testid="gcs-download-status">
      <GcsIcon name={icon} />
      {t(status)}
    </span>
  );
}

/**
 * Grila fișierelor (indexul, categoriile, căutarea): coperta (prima captură sau iconița categoriei), titlul, autorul cu
 * numele stilizat, versiunea, descărcările, nota și insigna VIP / Recomandat.
 */
export async function GcsDownloadGrid({ files, testId = "gcs-download-grid", compact = false }: { files: GcsDownloadCard[]; testId?: string; compact?: boolean }) {
  const [t, format, locale] = await Promise.all([getTranslations("downloads"), getFormatter(), getLocale()]);
  return (
    <ul className={`gcs-dlGrid${compact ? " gcs-dlGrid--compact" : ""}`} data-testid={testId}>
      {files.map((f) => {
        const headingId = `gcs-dl-${testId}-${f.id}`;
        return (
          <li key={f.id}>
            <article className="gcs-card gcs-dlCard" aria-labelledby={headingId} data-testid="gcs-download-card" data-file={f.id}>
              <Link href={f.href} className="gcs-dlCard__cover" tabIndex={-1} aria-hidden="true">
                {f.cover ? <img src={f.cover} alt="" loading="lazy" decoding="async" /> : <GcsIcon name={f.category.icon || "fa-solid fa-file-zipper"} className="gcs-dlCard__coverIcon" />}
                {(f.vip || f.featured) && (
                  <span className="gcs-dlCard__flags">
                    {f.featured && <span className="gcs-dlFlag" data-flag="featured"><GcsIcon name="fa-solid fa-star" />{t("featured")}</span>}
                    {f.vip && <span className="gcs-dlFlag" data-flag="vip"><GcsIcon name="fa-solid fa-crown" />VIP</span>}
                  </span>
                )}
              </Link>
              <div className="gcs-dlCard__body">
                <h3 id={headingId} className="gcs-dlCard__title">
                  <Link href={f.href}>{f.title}</Link>
                  {f.version && <span className="gcs-dlVersion">{f.version}</span>}
                </h3>
                {!compact && f.summary && <p className="gcs-dlCard__summary">{f.summary}</p>}
                <p className="gcs-dlCard__by">
                  {f.author ? <GcsMemberLink user={f.author} /> : <span className="gcs-muted">{t("deletedMember")}</span>}
                  <GcsRelTime at={f.publishedAt} />
                </p>
                <GcsDownloadStatus status={f.status} />
              </div>
              <footer className="gcs-dlCard__meta">
                <span title={t("downloadsCount", { count: f.downloads })}>
                  <GcsIcon name="fa-solid fa-download" />
                  {format.number(f.downloads, { notation: "compact" })}
                </span>
                {f.reviewsCount > 0 ? <GcsStarsStatic avg={f.rating} size="sm" label={t("ratingLabel", { avg: f.rating.toFixed(1), count: f.reviewsCount })} /> : <span className="gcs-muted">{t("noReviews")}</span>}
                {f.size > 0 && <span className="gcs-dlCard__size">{formatBytes(f.size, locale)}</span>}
              </footer>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

/** Categoriile (indexul și subcategoriile): iconița sau imaginea, numele, descrierea, numărul de fișiere, VIP. */
export async function GcsCategoryList({ categories, testId = "gcs-download-categories" }: { categories: GcsCategoryNode[]; testId?: string }) {
  const [t, format] = await Promise.all([getTranslations("downloads"), getFormatter()]);
  return (
    <ul className="gcs-dlCats" data-testid={testId}>
      {categories.map((c) => (
        <li key={c.id} className="gcs-card gcs-dlCat" data-testid="gcs-download-category">
          <span className="gcs-dlCat__icon" aria-hidden="true">
            {c.iconUrl || c.coverUrl ? <img src={(c.iconUrl ?? c.coverUrl)!} alt="" /> : <GcsIcon name={c.icon || "fa-solid fa-folder"} />}
          </span>
          <div className="gcs-dlCat__body">
            <h3 className="gcs-dlCat__name">
              <Link href={c.href}>{c.name}</Link>
              {c.vip && <span className="gcs-dlFlag" data-flag="vip"><GcsIcon name="fa-solid fa-crown" />VIP</span>}
            </h3>
            {c.descriptionHtml && <GcsNamedHtml html={c.descriptionHtml} className="gcs-dlCat__desc gcs-richText" />}
            {c.children.length > 0 && (
              <ul className="gcs-dlCat__subs">
                {c.children.map((s) => (
                  <li key={s.id}>
                    <Link href={s.href}>{s.name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <span className="gcs-dlCat__count">
            <strong>{format.number(c.filesCount)}</strong>
            {t("filesShort", { count: c.filesCount })}
          </span>
        </li>
      ))}
    </ul>
  );
}
