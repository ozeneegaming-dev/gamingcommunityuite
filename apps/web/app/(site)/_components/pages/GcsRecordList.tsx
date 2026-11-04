import type { GcsPagesDb, GcsPagesFieldView, GcsPagesRecordCard } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { GcsMemberLink } from "@/lib/member-names";
import { GcsStarsStatic } from "../topic/GcsTopicRating";

export type GcsRecordView = "list" | "grid" | "table" | "compact" | "featured" | "carousel";

/** Valoarea unui câmp pe card: insigna „Etichetă: valoare”, în culoarea câmpului (dacă are una). */
export function GcsFieldChip({ field, yes, no }: { field: GcsPagesFieldView; yes: string; no: string }) {
  const value = field.type === "checkbox" ? (field.value === true ? yes : no) : field.display;
  if (!value) return null;
  return (
    <span className="gcs-pgChip" data-field={field.key} style={field.badge ? ({ "--gcs-pg-chip": field.badge } as CSSProperties) : undefined}>
      <span className="gcs-pgChip__label">{field.label}</span>
      {value}
    </span>
  );
}

/** Autorul, data, comentariile, vizualizările și nota unei înregistrări (rândul de jos al cardului). */
async function Meta({ r, ratings }: { r: GcsPagesRecordCard; ratings: boolean }) {
  const [t, format] = await Promise.all([getTranslations("pages"), getFormatter()]);
  return (
    <span className="gcs-pgCard__meta">
      {r.author ? <GcsMemberLink user={r.author} /> : <span>{t("deletedMember")}</span>}
      {r.publishedAt && <time dateTime={r.publishedAt}>{format.dateTime(new Date(r.publishedAt), { dateStyle: "medium" })}</time>}
      <span title={t("commentsCount", { count: r.comments })}>
        <GcsIcon name="fa-regular fa-comment" /> {format.number(r.comments)}
      </span>
      <span title={t("viewsCount", { count: r.views })}>
        <GcsIcon name="fa-regular fa-eye" /> {format.number(r.views)}
      </span>
      {ratings && r.rating.count > 0 && <GcsStarsStatic avg={r.rating.avg} size="sm" label={t("ratingShort", { avg: r.rating.avg.toFixed(1), count: r.rating.count })} />}
    </span>
  );
}

/** Insignele stării: fixată, recomandată, nouă, în așteptare, ascunsă, respinsă. */
async function Flags({ r }: { r: GcsPagesRecordCard }) {
  const t = await getTranslations("pages.flags");
  const flags = [
    r.pinned && { key: "pinned", icon: "fa-solid fa-thumbtack" },
    r.featured && { key: "featured", icon: "fa-solid fa-star" },
    r.isNew && { key: "new", icon: "fa-solid fa-bolt" },
    r.status !== "PUBLISHED" && { key: r.status.toLowerCase(), icon: r.status === "PENDING" ? "fa-regular fa-clock" : "fa-solid fa-eye-slash" },
  ].filter(Boolean) as { key: string; icon: string }[];
  if (flags.length === 0) return null;
  return (
    <span className="gcs-pgFlags">
      {flags.map((f) => (
        <span key={f.key} className={`gcs-pgFlag gcs-pgFlag--${f.key}`}>
          <GcsIcon name={f.icon} />
          {t(f.key as never)}
        </span>
      ))}
    </span>
  );
}

async function Card({ r, db, image, big = false }: { r: GcsPagesRecordCard; db: GcsPagesDb; image: boolean; big?: boolean }) {
  const t = await getTranslations("pages");
  return (
    <article className={`gcs-pgCard${big ? " gcs-pgCard--big" : ""}`} data-testid="gcs-pages-record" data-record={r.id}>
      {image && (
        <Link href={r.href} className="gcs-pgCard__media" tabIndex={-1} aria-hidden="true">
          {r.image ? <img src={r.image} alt="" loading="lazy" /> : <GcsIcon name={r.category?.icon ?? db.icon ?? "fa-solid fa-file-lines"} className="gcs-pgCard__placeholder" />}
        </Link>
      )}
      <div className="gcs-pgCard__body">
        <Flags r={r} />
        {r.category && (
          <Link href={r.category.href} className="gcs-pgCard__cat" style={r.category.color ? ({ "--gcs-pg-cat": r.category.color } as CSSProperties) : undefined}>
            {r.category.icon && <GcsIcon name={r.category.icon} />}
            {r.category.name}
          </Link>
        )}
        <h3 className="gcs-pgCard__title">
          <Link href={r.href}>{r.title}</Link>
        </h3>
        {r.excerpt && <p className="gcs-pgCard__excerpt">{r.excerpt}</p>}
        {r.fields.length > 0 && (
          <span className="gcs-pgCard__fields">
            {r.fields.map((f) => (
              <GcsFieldChip key={f.key} field={f} yes={t("yes")} no={t("no")} />
            ))}
          </span>
        )}
        <Meta r={r} ratings={db.ratings} />
      </div>
    </article>
  );
}

/**
 * Înregistrările unei baze de date în aspectul ales: listă (rânduri cu miniatură), grilă de carduri, tabel (câmpurile de
 * pe card ca coloane), compact (doar titlul și meta), recomandate (prima mare, restul în grilă) sau carusel.
 */
export async function GcsRecordList({ db, records, view, hideImages = false }: { db: GcsPagesDb; records: GcsPagesRecordCard[]; view: GcsRecordView; hideImages?: boolean }) {
  const [t, format] = await Promise.all([getTranslations("pages"), getFormatter()]);
  if (records.length === 0) {
    return (
      <p className="gcs-emptyState" data-testid="gcs-pages-empty">
        <GcsIcon name={db.icon ?? "fa-solid fa-database"} className="gcs-emptyIcon" />
        {t("emptyRecords", { name: (db.recordPlural || db.name).toLowerCase() })}
      </p>
    );
  }
  if (view === "table") {
    const cols = db.fields.filter((f) => f.listed);
    return (
      <div className="gcs-pgTableWrap">
        <table className="gcs-pgTable" data-testid="gcs-pages-table">
          <thead>
            <tr>
              <th scope="col">{db.recordLabel || t("record")}</th>
              {cols.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
              <th scope="col">{t("updated")}</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} data-testid="gcs-pages-record" data-record={r.id}>
                <th scope="row">
                  <Link href={r.href}>{r.title}</Link>
                  <Flags r={r} />
                </th>
                {cols.map((c) => {
                  const f = r.fields.find((x) => x.key === c.key);
                  return <td key={c.key}>{f ? (f.type === "checkbox" ? (f.value === true ? t("yes") : t("no")) : f.display) : "—"}</td>;
                })}
                <td>
                  <time dateTime={r.updatedAt}>{format.dateTime(new Date(r.updatedAt), { dateStyle: "medium" })}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (view === "compact") {
    return (
      <ul className="gcs-pgCompact">
        {records.map((r) => (
          <li key={r.id} data-testid="gcs-pages-record" data-record={r.id}>
            <GcsIcon name={r.category?.icon ?? db.icon ?? "fa-solid fa-file-lines"} />
            <span>
              <Link href={r.href} className="gcs-pgCompact__title">
                {r.title}
              </Link>
              <Meta r={r} ratings={db.ratings} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  const image = !hideImages;
  if (view === "featured") {
    const [first, ...rest] = records;
    return (
      <div className="gcs-pgFeatured">
        <Card r={first!} db={db} image={image} big />
        {rest.length > 0 && (
          <div className="gcs-pgGrid">
            {rest.map((r) => (
              <Card key={r.id} r={r} db={db} image={image} />
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={view === "grid" ? "gcs-pgGrid" : view === "carousel" ? "gcs-pgCarousel" : "gcs-pgList"} data-view={view}>
      {records.map((r) => (
        <Card key={r.id} r={r} db={db} image={image} />
      ))}
    </div>
  );
}
