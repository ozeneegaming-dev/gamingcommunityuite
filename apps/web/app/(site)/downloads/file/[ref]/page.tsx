import { downloadFileHref, formatBytes } from "@gcs/modules";
import { parseRef } from "@gcs/modules/slug";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { clientIp, currentActor } from "@/lib/actor";
import { GcsMemberLink, GcsNamedHtml } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsCommentForm, GcsDownloadButton, GcsDownloadStaffTools, GcsFollowButton, GcsPostTools, GcsReviewForm } from "../../../_components/downloads/GcsDownloadActions";
import { GcsDownloadStatus } from "../../../_components/downloads/GcsDownloadCards";
import { GcsRelTime } from "../../../_components/forum/GcsRelTime";
import { GcsStarsStatic } from "../../../_components/topic/GcsTopicRating";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ref: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ref = parseRef((await params).ref);
  const view = ref ? await services().downloads.queries.file(await currentActor(), ref.id) : null;
  return view ? { title: view.file.title, description: view.file.summary || undefined, alternates: { canonical: view.file.href } } : {};
}

const SCAN_ICON: Record<string, string> = { clean: "fa-solid fa-shield-halved", skipped: "fa-solid fa-user-check", error: "fa-solid fa-triangle-exclamation", pending: "fa-solid fa-hourglass-half", infected: "fa-solid fa-shield-virus" };

/**
 * `/downloads/file/{id}-{slug}` (specul 2026-11-03-descarcari §6.3): antetul, capturile, descrierea, câmpurile, versiunile
 * și lista schimbărilor; panoul de descărcare (fișierele versiunii curente, tipul real, verificarea antivirus, termenii,
 * invitația de înregistrare / VIP); recenziile și comentariile; uneltele autorului și ale staff-ului.
 */
export default async function DownloadFilePage({ params }: Props) {
  const { downloads, apps } = services();
  const actor = await currentActor();
  if (!(await downloads.queries.canUseApp(actor))) notFound();
  const ref = parseRef((await params).ref);
  const view = ref ? await downloads.queries.file(actor, ref.id) : null;
  if (!ref || !view) notFound();
  if (ref.slug !== view.file.slug) permanentRedirect(downloadFileHref(view.file));
  const viewer = actor.userId ? `u:${actor.userId}` : `ip:${clientIp(await headers())}`;
  await downloads.service.countView(view.file.id, viewer).catch(() => {});
  const [t, format, locale, vipOn, moveTargets] = await Promise.all([
    getTranslations("downloads"),
    getFormatter(),
    getLocale(),
    apps.enabled("vip"),
    view.access.moderate ? downloads.queries.categoryCounts(actor) : Promise.resolve([]),
  ]);
  const flat: { id: number; name: string; depth: number }[] = [];
  const walk = (list: typeof moveTargets) => list.forEach((c) => (flat.push({ id: c.id, name: c.name, depth: c.depth }), walk(c.children)));
  walk(moveTargets);
  const f = view.file;
  const current = view.current;
  const sidebar = view.fields.filter((x) => x.location === "sidebar");
  const below = view.fields.filter((x) => x.location !== "sidebar");
  const fieldValue = async (x: (typeof view.fields)[number]) =>
    x.members.length > 0 ? (
      <span className="gcs-dlField__members">{await Promise.all(x.members.map(async (m) => <GcsMemberLink key={m.id} user={m} />))}</span>
    ) : x.url ? (
      <a href={x.url} rel="nofollow ugc noopener" target="_blank">{x.url.replace(/^https?:\/\//, "")}</a>
    ) : x.type === "checkbox" ? (
      t(x.text === "yes" ? "fieldYes" : "fieldNo")
    ) : (
      x.text
    );

  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("title")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/downloads">
                <GcsIcon name="fa-solid fa-download" className="gcs-breadcrumb__home" />
                {t("title")}
              </Link>
            </li>
            {view.crumbs.map((c) => (
              <li key={c.id}>
                <Link href={c.href}>{c.name}</Link>
              </li>
            ))}
            <li aria-current="page">{f.title}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title gcs-dlTitle">
            {f.title}
            {f.version && <span className="gcs-dlVersion gcs-dlVersion--lg">{f.version}</span>}
          </h1>
          <p className="gcs-dlHeadMeta">
            {f.author ? <GcsMemberLink user={f.author} /> : <span className="gcs-muted">{t("deletedMember")}</span>}
            <GcsRelTime at={f.publishedAt} />
            <GcsDownloadStatus status={f.status} />
            {f.vip && <span className="gcs-dlFlag" data-flag="vip"><GcsIcon name="fa-solid fa-crown" />VIP</span>}
            {f.featured && <span className="gcs-dlFlag" data-flag="featured"><GcsIcon name="fa-solid fa-star" />{t("featured")}</span>}
          </p>
          {f.summary && <p className="gcs-pageHeader__desc">{f.summary}</p>}
        </div>
        <div className="gcs-pageHeader__actions">
          {actor.userId && f.status === "approved" && <GcsFollowButton kind="file" id={f.id} following={view.following} />}
          {view.access.canNewVersion && (
            <Link className="gcs-btn gcs-btn--ghost" href={`${f.href}/version`} data-testid="gcs-download-new-version">
              <GcsIcon name="fa-solid fa-code-branch" />
              {t("newVersion")}
            </Link>
          )}
          {view.access.canEdit && (
            <Link className="gcs-btn gcs-btn--ghost" href={`${f.href}/edit`} data-testid="gcs-download-edit">
              <GcsIcon name="fa-solid fa-pen" />
              {t("edit")}
            </Link>
          )}
        </div>
      </header>

      {f.status !== "approved" && (
        <div className="gcs-card gcs-dlNotice" role="status" data-status={f.status} data-testid="gcs-download-notice">
          <GcsIcon name={f.status === "quarantined" ? "fa-solid fa-shield-virus" : f.status === "rejected" ? "fa-solid fa-ban" : "fa-solid fa-hourglass-half"} />
          <p>
            {t(`notices.${f.status}`)}
            {f.rejectReason && f.status !== "quarantined" && <> {t("reason", { reason: f.rejectReason })}</>}
          </p>
        </div>
      )}
      {view.pending && (
        <div className="gcs-card gcs-dlNotice" role="status" data-status={view.pending.status} data-testid="gcs-download-pending-version">
          <GcsIcon name="fa-solid fa-code-branch" />
          <p>{t(`pendingVersion.${view.pending.status}`, { label: view.pending.label || "—" })}</p>
        </div>
      )}
      {(view.access.moderate || view.access.canDelete) && (
        <GcsDownloadStaffTools
          fileId={f.id}
          pendingVersionId={view.pending?.status === "pending" ? view.pending.id : null}
          featured={f.featured}
          hidden={f.status === "hidden"}
          commentsLocked={f.commentsLocked}
          vipOnly={f.vip}
          canDelete={view.access.canDelete}
          moderate={view.access.moderate}
          categories={flat}
          categoryId={f.category.id}
        />
      )}

      <div className="gcs-dlLayout gcs-dlLayout--file">
        <div className="gcs-dlLayout__main">
          {view.screenshots.length > 0 && (
            <section className="gcs-dlShotsView" aria-label={t("screenshots")} data-testid="gcs-download-screenshots">
              {view.screenshots.map((s, i) => (
                <button key={s.id} type="button" className="gcs-dlShotsView__item" data-gcs-viewer={s.url} aria-label={t("openShot", { n: i + 1 })}>
                  <img src={s.thumb} alt="" loading={i === 0 ? "eager" : "lazy"} decoding="async" />
                </button>
              ))}
            </section>
          )}
          <section className="gcs-card gcs-titledBox gcs-dlSection" aria-labelledby="gcs-dl-about">
            <h2 id="gcs-dl-about" className="gcs-titleBand">
              <GcsIcon name="fa-solid fa-align-left" className="gcs-hIcon" />
              {t("about")}
            </h2>
            <GcsNamedHtml html={f.descriptionHtml} className="gcs-richText gcs-postBody gcs-dlDescription" data-testid="gcs-download-description" />
            {below.length > 0 && (
              <dl className="gcs-dlFields">
                {await Promise.all(below.map(async (x) => (
                  <div key={x.id}>
                    <dt>{x.name}</dt>
                    <dd>{await fieldValue(x)}</dd>
                  </div>
                )))}
              </dl>
            )}
            {f.tags.length > 0 && (
              <ul className="gcs-dlTags" aria-label={t("tags")}>
                {f.tags.map((tag) => (
                  <li key={tag}>
                    <Link className="gcs-chip gcs-sweep" href={`/downloads/all?tag=${encodeURIComponent(tag)}`}>#{tag}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(current?.changelogHtml || view.history.length > 0) && (
            <section className="gcs-card gcs-titledBox gcs-dlSection" aria-labelledby="gcs-dl-versions" data-testid="gcs-download-versions">
              <h2 id="gcs-dl-versions" className="gcs-titleBand">
                <GcsIcon name="fa-solid fa-code-branch" className="gcs-hIcon" />
                {t("versions")}
              </h2>
              <ol className="gcs-dlVersions">
                {[...(current ? [current] : []), ...view.history].map((v, i) => (
                  <li key={v.id} className="gcs-dlVersions__item" data-current={i === 0 && current ? "true" : undefined}>
                    <header>
                      <strong>{v.label || t("noLabel")}</strong>
                      {i === 0 && current && <span className="gcs-dlFlag" data-flag="current">{t("currentVersion")}</span>}
                      <span className="gcs-muted"><GcsRelTime at={v.approvedAt ?? v.createdAt} /> · {formatBytes(v.size, locale)} · {t("downloadsCount", { count: v.downloads })}</span>
                    </header>
                    {v.changelogHtml && <GcsNamedHtml html={v.changelogHtml} className="gcs-richText gcs-dlChangelog" />}
                    {i > 0 && view.access.canDownload && (
                      <ul className="gcs-dlOldFiles">
                        {v.assets.filter((a) => a.href).map((a) => (
                          <li key={a.id}>
                            <a href={a.href!} rel="nofollow">
                              <GcsIcon name="fa-solid fa-download" />
                              {a.name} ({formatBytes(a.size, locale)})
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {view.access.reviewsEnabled && (
            <section className="gcs-card gcs-titledBox gcs-dlSection" aria-labelledby="gcs-dl-reviews" data-testid="gcs-download-reviews">
              <h2 id="gcs-dl-reviews" className="gcs-titleBand">
                <GcsIcon name="fa-solid fa-star" className="gcs-hIcon" />
                {t("reviews.title", { count: f.reviewsCount })}
              </h2>
              {view.access.canReview ? (
                <GcsReviewForm fileId={f.id} mine={view.myReview} />
              ) : (
                view.access.reviewDenial && view.access.reviewDenial !== "own" && <p className="gcs-muted">{t(`reviews.denial.${view.access.reviewDenial}`)}</p>
              )}
              {view.reviews.length === 0 ? (
                <p className="gcs-muted">{t("reviews.none")}</p>
              ) : (
                <ul className="gcs-dlPosts">
                  {await Promise.all(view.reviews.map(async (r) => (
                    <li key={r.id} className="gcs-dlPost" data-status={r.status} data-testid="gcs-download-review">
                      <header className="gcs-dlPost__head">
                        {r.user ? <GcsMemberLink user={r.user} /> : <span className="gcs-muted">{t("deletedMember")}</span>}
                        <GcsStarsStatic avg={r.rating ?? 0} size="sm" label={t("reviews.stars", { count: r.rating ?? 0 })} />
                        {r.version && <span className="gcs-dlVersion">{r.version}</span>}
                        <GcsRelTime at={r.createdAt} />
                        {r.status !== "visible" && <span className="gcs-dlStatus" data-status={r.status}>{t(`postStatus.${r.status}`)}</span>}
                        <GcsPostTools kind="review" id={r.id} status={r.status} moderate={view.access.moderate} canDelete={r.canDelete} />
                      </header>
                      {r.bodyHtml && <GcsNamedHtml html={r.bodyHtml} className="gcs-richText gcs-postBody" />}
                    </li>
                  )))}
                </ul>
              )}
            </section>
          )}

          {view.access.commentsEnabled && (
            <section className="gcs-card gcs-titledBox gcs-dlSection" aria-labelledby="gcs-dl-comments" data-testid="gcs-download-comments">
              <h2 id="gcs-dl-comments" className="gcs-titleBand">
                <GcsIcon name="fa-solid fa-comments" className="gcs-hIcon" />
                {t("comments.title", { count: f.commentsCount })}
              </h2>
              {view.comments.length === 0 && <p className="gcs-muted">{t("comments.none")}</p>}
              <ul className="gcs-dlPosts">
                {await Promise.all(view.comments.map(async (c) => (
                  <li key={c.id} className="gcs-dlPost" data-status={c.status} data-testid="gcs-download-comment">
                    <header className="gcs-dlPost__head">
                      {c.user ? <GcsMemberLink user={c.user} /> : <span className="gcs-muted">{t("deletedMember")}</span>}
                      <GcsRelTime at={c.createdAt} />
                      {c.status !== "visible" && <span className="gcs-dlStatus" data-status={c.status}>{t(`postStatus.${c.status}`)}</span>}
                      <GcsPostTools kind="comment" id={c.id} status={c.status} moderate={view.access.moderate} canDelete={c.canDelete} />
                    </header>
                    <GcsNamedHtml html={c.bodyHtml} className="gcs-richText gcs-postBody" />
                  </li>
                )))}
              </ul>
              {view.access.canComment ? (
                <GcsCommentForm fileId={f.id} />
              ) : f.commentsLocked ? (
                <p className="gcs-muted"><GcsIcon name="fa-solid fa-lock" /> {t("comments.locked")}</p>
              ) : (
                !actor.userId && <p className="gcs-muted"><Link href={`/login?next=${encodeURIComponent(f.href)}`}>{t("comments.login")}</Link></p>
              )}
            </section>
          )}
        </div>

        <aside className="gcs-dlLayout__side">
          <section className="gcs-card gcs-dlPanel" aria-labelledby="gcs-dl-get" data-testid="gcs-download-panel">
            <h2 id="gcs-dl-get" className="gcs-srOnly">{t("downloadPanel")}</h2>
            {current && current.assets.length > 0 ? (
              <ul className="gcs-dlPanel__files">
                {current.assets.map((a, i) => (
                  <li key={a.id} className="gcs-dlPanel__file">
                    <div className="gcs-dlPanel__cart" aria-hidden="true">
                      <span className="gcs-dlPanel__kind">{a.kind}</span>
                    </div>
                    <div className="gcs-dlPanel__info">
                      <span className="gcs-dlPanel__name">{a.name}</span>
                      <span className="gcs-dlPanel__scan" data-scan={a.scan}>
                        <GcsIcon name={a.source === "link" ? "fa-solid fa-arrow-up-right-from-square" : (SCAN_ICON[a.scan] ?? "fa-solid fa-shield")} />
                        {a.source === "link" ? t("panel.link", { host: a.host ?? "" }) : t(`panel.scan.${a.scan}`)}
                      </span>
                    </div>
                    {a.href && view.access.canDownload && <GcsDownloadButton href={a.href} name={a.source === "link" ? (a.host ?? a.name) : a.kind} size={a.source === "link" ? t("panel.external") : formatBytes(a.size, locale)} terms={view.access.terms} primary={i === 0} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="gcs-muted">{t("panel.noFiles")}</p>
            )}
            {!view.access.canDownload && view.access.denial === "guest" && (
              <div className="gcs-dlLocked" data-testid="gcs-download-guest">
                <GcsIcon name="fa-solid fa-user-lock" />
                <p>{t("panel.guest")}</p>
                <span className="gcs-dlLocked__actions">
                  <Link className="gcs-btn gcs-btn--primary" href={`/register?next=${encodeURIComponent(f.href)}`}>{t("panel.register")}</Link>
                  <Link className="gcs-btn gcs-btn--ghost" href={`/login?next=${encodeURIComponent(f.href)}`}>{t("panel.login")}</Link>
                </span>
              </div>
            )}
            {!view.access.canDownload && view.access.denial === "vip" && (
              <div className="gcs-dlLocked" data-locked="vip" data-testid="gcs-download-vip">
                <GcsIcon name="fa-solid fa-crown" />
                <p>{t("panel.vip")}</p>
                {vipOn && <Link className="gcs-btn gcs-btn--primary" href="/vip" data-testid="gcs-download-vip-cta">{t("panel.becomeVip")}</Link>}
              </div>
            )}
            {!view.access.canDownload && view.access.denial === "no_permission" && (
              <div className="gcs-dlLocked" data-testid="gcs-download-no-permission">
                <GcsIcon name="fa-solid fa-lock" />
                <p>{view.access.message || t("panel.noPermission")}</p>
              </div>
            )}
            <dl className="gcs-dlPanel__stats">
              <div><dt>{t("stats.downloads")}</dt><dd>{format.number(f.downloads)}</dd></div>
              <div><dt>{t("stats.views")}</dt><dd>{format.number(f.views)}</dd></div>
              <div><dt>{t("stats.size")}</dt><dd>{formatBytes(f.size, locale)}</dd></div>
              <div>
                <dt>{t("stats.rating")}</dt>
                <dd>{f.reviewsCount > 0 ? <GcsStarsStatic avg={f.rating} size="sm" label={t("ratingLabel", { avg: f.rating.toFixed(1), count: f.reviewsCount })} /> : "—"}</dd>
              </div>
              <div><dt>{t("stats.updated")}</dt><dd><GcsRelTime at={f.publishedAt} /></dd></div>
              <div><dt>{t("stats.submitted")}</dt><dd><GcsRelTime at={f.createdAt} /></dd></div>
              <div><dt>{t("stats.category")}</dt><dd><Link href={f.category.href}>{f.category.name}</Link></dd></div>
              {await Promise.all(sidebar.map(async (x) => (
                <div key={x.id}><dt>{x.name}</dt><dd>{await fieldValue(x)}</dd></div>
              )))}
            </dl>
            {view.access.canSeeLog && (
              <Link className="gcs-dlPanel__log" href={`${f.href}/log`} data-testid="gcs-download-log-link">
                <GcsIcon name="fa-solid fa-list-ol" />
                {t("log.open")}
              </Link>
            )}
            {f.topicId && (
              <Link className="gcs-dlPanel__log" href={`/topic/${f.topicId}`}>
                <GcsIcon name="fa-solid fa-life-ring" />
                {t("supportTopic")}
              </Link>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
