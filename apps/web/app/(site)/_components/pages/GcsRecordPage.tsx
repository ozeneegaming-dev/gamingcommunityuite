import type { GcsActor } from "@gcs/core";
import type { GcsPagesDb, GcsPagesFieldView, GcsPagesQueries } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { memberHref } from "@/lib/forum-urls";
import { GcsMemberLink, GcsNamedHtml } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsPagination } from "../forum/GcsPagination";
import { GcsRelTime } from "../forum/GcsRelTime";
import { GcsTopicRating } from "../topic/GcsTopicRating";
import { ratePagesRecord, unratePagesRecord } from "../../pages-actions";
import { GcsCommentComposer } from "./GcsCommentComposer";
import { GcsCopyText } from "./GcsCopyText";
import { GcsCommentTools, GcsRecordModBar, GcsRestoreRevision } from "./GcsPagesTools";

type RecordData = NonNullable<Awaited<ReturnType<GcsPagesQueries["record"]>>>;

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Un câmp pe pagina înregistrării: codul cu „Copiază”, video-ul încorporat, fișierul de descărcat, restul ca text. */
async function FieldValue({ f }: { f: GcsPagesFieldView }) {
  const t = await getTranslations("pages");
  switch (f.type) {
    case "code":
      return (
        <div className="gcs-pgCode">
          <div className="gcs-pgCode__bar">
            <GcsIcon name="fa-solid fa-terminal" />
            <span>{f.label}</span>
            <GcsCopyText text={String(f.value)} testId={`gcs-pages-copy-${f.key}`} />
          </div>
          <pre>
            <code>{String(f.value)}</code>
          </pre>
        </div>
      );
    case "youtube":
      return (
        <div className="gcs-pgVideo">
          <iframe src={f.url!} title={f.label} loading="lazy" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation" />
        </div>
      );
    case "file":
      return (
        <a className="gcs-btn gcs-btn--ghost gcs-pgFile" href={f.url!} download data-testid={`gcs-pages-file-${f.key}`}>
          <GcsIcon name="fa-solid fa-download" />
          <span>{f.display}</span>
          {f.size !== null && <small>{sizeText(f.size)}</small>}
        </a>
      );
    case "image":
      return <img className="gcs-pgFieldImage" src={f.url!} alt={f.label} loading="lazy" />;
    case "checkbox":
      return <span>{f.value === true ? t("yes") : t("no")}</span>;
    case "textarea":
      return <span className="gcs-pgPre">{f.display}</span>;
    default:
      return f.url ? (
        <a href={f.url} {...(f.url.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
          {f.display}
        </a>
      ) : (
        <span>{f.display}</span>
      );
  }
}

/** Câmpurile unei poziții (deasupra / sub conținut): blocurile mari (cod, video) separat, restul ca listă de definiții. */
async function FieldGroup({ fields }: { fields: GcsPagesFieldView[] }) {
  const big = fields.filter((f) => f.type === "code" || f.type === "youtube");
  const small = fields.filter((f) => f.type !== "code" && f.type !== "youtube");
  if (fields.length === 0) return null;
  return (
    <>
      {small.length > 0 && (
        <dl className="gcs-pgFields" data-testid="gcs-pages-fields">
          {small.map((f) => (
            <div key={f.key} className="gcs-pgFields__row" data-field={f.key} style={f.badge ? ({ "--gcs-pg-chip": f.badge } as CSSProperties) : undefined}>
              <dt>{f.label}</dt>
              <dd>
                <FieldValue f={f} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {big.map((f) => (
        <FieldValue key={f.key} f={f} />
      ))}
    </>
  );
}

/**
 * Pagina unei înregistrări: antetul (categoria, stările, titlul, autorul, nota cu stele), imaginea, câmpurile de deasupra,
 * conținutul (cu mențiunile stilizate), câmpurile de dedesubt, topicul din forum, uneltele staff-ului, reviziile și
 * comentariile (cu editorul comun).
 */
export async function GcsRecordPage({ actor, db, data, commentsPage, base }: { actor: GcsActor; db: GcsPagesDb; data: RecordData; commentsPage: number; base: string }) {
  const { pagesQueries } = services();
  const [t, format] = await Promise.all([getTranslations("pages"), getFormatter()]);
  const r = data.record;
  const [comments, revisions] = await Promise.all([db.comments ? pagesQueries.comments(actor, r.id, commentsPage) : null, data.can.moderate && data.revisions > 0 ? pagesQueries.revisions(actor, r.id) : []]);
  const top = data.fields.filter((f) => f.position === "top");
  const bottom = data.fields.filter((f) => f.position !== "top");

  return (
    <article className="gcs-pgRecord" data-testid="gcs-pages-record-page" data-record={r.id}>
      <nav className="gcs-breadcrumb" aria-label={t("breadcrumb")}>
        <ol>
          <li>
            <Link href={base}>{db.name}</Link>
          </li>
          {r.category && (
            <li>
              <Link href={r.category.href}>{r.category.name}</Link>
            </li>
          )}
          <li aria-current="page">{r.title}</li>
        </ol>
      </nav>

      {r.status !== "PUBLISHED" && (
        <p className={`gcs-pgNotice gcs-pgNotice--${r.status.toLowerCase()}`} role="status" data-testid="gcs-pages-status">
          <GcsIcon name={r.status === "PENDING" ? "fa-regular fa-clock" : r.status === "REJECTED" ? "fa-solid fa-ban" : "fa-solid fa-eye-slash"} />
          {t(`status.${r.status}` as never)}
          {r.status === "REJECTED" && r.rejectReason && <span className="gcs-pgNotice__reason">{t("rejectReason", { reason: r.rejectReason })}</span>}
        </p>
      )}

      {(data.can.moderate || data.can.delete) && <GcsRecordModBar recordId={r.id} status={r.status} featured={r.featured} pinned={r.pinned} moderate={data.can.moderate} canDelete={data.can.delete} />}

      <header className="gcs-pgRecord__head">
        {r.image && <img className="gcs-pgRecord__cover" src={r.image} alt="" />}
        <div className="gcs-pgRecord__headText">
          {r.category && (
            <Link href={r.category.href} className="gcs-pgCard__cat" style={r.category.color ? ({ "--gcs-pg-cat": r.category.color } as CSSProperties) : undefined}>
              {r.category.icon && <GcsIcon name={r.category.icon} />}
              {r.category.name}
            </Link>
          )}
          <h1 className="gcs-display gcs-pgRecord__title">
            {r.pinned && <GcsIcon name="fa-solid fa-thumbtack" className="gcs-pgRecord__pin" />}
            {r.title}
          </h1>
          <p className="gcs-pgRecord__by">
            {r.author ? t.rich("by", { name: () => <GcsMemberLink user={r.author!} /> }) : t("deletedMember")}
            {r.publishedAt && (
              <>
                {" · "}
                <GcsRelTime at={r.publishedAt} />
              </>
            )}
            {" · "}
            {t("viewsCount", { count: r.views })}
            {r.editedAt && (
              <span className="gcs-pgRecord__edited">
                {r.editedBy ? t.rich("editedBy", { name: () => <Link href={memberHref(r.editedBy!)}>{r.editedBy!.name}</Link>, when: format.relativeTime(new Date(r.editedAt)) }) : t("edited")}
              </span>
            )}
          </p>
          {data.rating && (
            <GcsTopicRating
              topicId={0}
              avg={data.rating.avg}
              count={data.rating.count}
              mine={data.rating.mine}
              canRate={data.rating.canRate && data.can.rate}
              reason={data.rating.reason}
              canChange={data.rating.canChange}
              distribution={[]}
              loginHref={`/login?next=${encodeURIComponent(r.href)}`}
              rate={ratePagesRecord.bind(null, r.id)}
              unrate={unratePagesRecord.bind(null, r.id)}
              testId="gcs-pages-rating"
            />
          )}
        </div>
        {data.can.edit && (
          <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-pgRecord__edit" href={`${r.href}/edit`} data-testid="gcs-pages-edit">
            <GcsIcon name="fa-solid fa-pen" />
            {t("edit")}
          </Link>
        )}
      </header>

      <FieldGroup fields={top} />
      {r.contentHtml && <GcsNamedHtml className="gcs-postBody gcs-pgRecord__body" html={r.contentHtml} data-testid="gcs-pages-record-body" />}
      <FieldGroup fields={bottom} />

      {r.topicId && (
        <p className="gcs-pgRecord__topic">
          <GcsIcon name="fa-regular fa-comments" />
          <Link href={`/topic/${r.topicId}`}>{t("discussTopic")}</Link>
        </p>
      )}

      {revisions.length > 0 && (
        <details className="gcs-card gcs-pgRevisions" data-testid="gcs-pages-revisions">
          <summary>
            <GcsIcon name="fa-solid fa-clock-rotate-left" />
            {t("revisions.title", { count: revisions.length })}
          </summary>
          <ol>
            {revisions.map((v) => (
              <li key={v.id}>
                <span>
                  <strong>{v.title}</strong> · {format.dateTime(new Date(v.at), { dateStyle: "medium", timeStyle: "short" })}
                  {v.actor && <> · {v.actor.name}</>}
                </span>
                <GcsRestoreRevision revisionId={v.id} />
              </li>
            ))}
          </ol>
        </details>
      )}

      {comments && (
        <section className="gcs-pgComments" aria-labelledby="gcs-pg-comments-title" data-testid="gcs-pages-comments">
          <h2 id="gcs-pg-comments-title" className="gcs-pgComments__title">
            <GcsIcon name="fa-regular fa-comments" />
            {t("comments.title", { count: comments.pagination.total })}
          </h2>
          {comments.comments.length === 0 && <p className="gcs-muted">{t("comments.empty")}</p>}
          <ol className="gcs-pgComments__list">
            {comments.comments.map((c) => (
              <li key={c.id} id={`comment-${c.id}`} className={`gcs-pgComment${c.hidden ? " gcs-pgComment--hidden" : ""}${c.pending ? " gcs-pgComment--pending" : ""}`} data-testid="gcs-pages-comment">
                <div className="gcs-pgComment__head">
                  {c.author ? <GcsMemberLink user={c.author} /> : <strong>{t("deletedMember")}</strong>}
                  <GcsRelTime at={c.createdAt} />
                  {c.pending && <span className="gcs-pgFlag gcs-pgFlag--pending">{t("flags.pending")}</span>}
                  {c.hidden && <span className="gcs-pgFlag gcs-pgFlag--hidden">{t("flags.hidden")}</span>}
                  {(comments.staff || c.canEdit) && <GcsCommentTools commentId={c.id} pending={c.pending} hidden={c.hidden} staff={comments.staff} canDelete={c.canEdit} />}
                </div>
                <GcsNamedHtml className="gcs-postBody gcs-pgComment__body" html={c.html} />
              </li>
            ))}
          </ol>
          <GcsPagination pagination={comments.pagination} href={(p) => `${r.href}?cp=${p}#gcs-pg-comments-title`} />
          {data.can.comment ? (
            <GcsCommentComposer recordId={r.id} databaseId={db.id} />
          ) : (
            !actor.userId && (
              <p className="gcs-muted">
                <Link href={`/login?next=${encodeURIComponent(r.href)}`}>{t("comments.signIn")}</Link>
              </p>
            )
          )}
        </section>
      )}
    </article>
  );
}
