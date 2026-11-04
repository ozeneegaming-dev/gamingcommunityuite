import { CATEGORY_SORTS } from "@gcs/modules";
import { GcsButton } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { GcsActor } from "@gcs/core";
import { GcsNamedHtml } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsPagination } from "../forum/GcsPagination";
import { GcsCategoryList, GcsDownloadGrid } from "./GcsDownloadCards";
import { GcsFollowButton } from "./GcsDownloadActions";

type Query = { sort?: string; page?: string; q?: string; tag?: string };

/**
 * Lista fișierelor dintr-o categorie (cu subcategoriile, descrierea, urmărirea și „Trimite aici”) sau a tuturor
 * fișierelor vizibile: căutarea, eticheta, sortarea și paginile. `null` = categoria nu există sau nu se vede.
 */
export async function GcsDownloadListing({ actor, categoryId, query, basePath }: { actor: GcsActor; categoryId: number | null; query: Query; basePath: string }) {
  const { downloads, follows } = services();
  const page = /^\d{1,6}$/.test(query.page ?? "") ? Number(query.page) : 1;
  const view = await downloads.queries.listing(actor, { categoryId, ...(query.sort ? { sort: query.sort } : {}), page, ...(query.q ? { q: query.q } : {}), ...(query.tag ? { tag: query.tag } : {}) });
  if (!view) return null;
  const [t, following] = await Promise.all([getTranslations("downloads"), view.category && actor.userId ? follows.isFollowing(actor.userId, "downloads.category", String(view.category.id)) : Promise.resolve(false)]);
  const href = (p: number, sort = view.sort) => {
    const params = new URLSearchParams();
    if (sort !== (view.category ? "" : "updated")) params.set("sort", sort);
    if (view.q) params.set("q", view.q);
    if (view.tag) params.set("tag", view.tag);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const title = view.category?.name ?? t("allFiles");

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
            {view.crumbs.slice(0, -1).map((c) => (
              <li key={c.id}>
                <Link href={c.href}>{c.name}</Link>
              </li>
            ))}
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name={view.category?.icon || "fa-solid fa-folder-open"} className="gcs-hIcon" />
            {title}
            {view.category?.vip && <span className="gcs-dlFlag" data-flag="vip"><GcsIcon name="fa-solid fa-crown" />VIP</span>}
          </h1>
          <p className="gcs-pageHeader__desc">{t("count", { count: view.pagination.total })}</p>
        </div>
        <div className="gcs-pageHeader__actions">
          {view.category && actor.userId && <GcsFollowButton kind="category" id={view.category.id} following={following} />}
          {view.canSubmit && view.category && (
            <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-cloud-arrow-up" />}>
              <Link href={`/downloads/submit?category=${view.category.id}`} data-testid="gcs-downloads-submit-here">{t("submitHere")}</Link>
            </GcsButton>
          )}
        </div>
      </header>

      {view.category?.descriptionHtml && <GcsNamedHtml html={view.category.descriptionHtml} className="gcs-card gcs-dlIntro gcs-richText" />}
      {view.children.length > 0 && <GcsCategoryList categories={view.children} testId="gcs-download-subcategories" />}

      {view.category && !view.category.canView ? (
        <div className="gcs-card gcs-dlNotice" role="note" data-testid="gcs-downloads-cannot-view">
          <GcsIcon name="fa-solid fa-lock" />
          <p>{view.category.message || t("cannotView")}</p>
        </div>
      ) : (
        <>
          <div className="gcs-dlToolbar">
            <form className="gcs-dlSearch gcs-dlSearch--inline" action={basePath} role="search">
              <label className="gcs-srOnly" htmlFor="gcs-dl-list-q">{t("searchLabel")}</label>
              <input id="gcs-dl-list-q" className="gcs-input" name="q" type="search" defaultValue={view.q} placeholder={t("searchPlaceholder")} maxLength={60} />
              {view.sort && <input type="hidden" name="sort" value={view.sort} />}
              <button type="submit" className="gcs-btn gcs-btn--ghost" aria-label={t("search")} title={t("search")}>
                <GcsIcon name="fa-solid fa-magnifying-glass" />
              </button>
            </form>
            <nav className="gcs-dlSorts" aria-label={t("sortLabel")}>
              {CATEGORY_SORTS.map((s) => (
                <Link key={s} href={href(1, s)} className="gcs-chip gcs-sweep" aria-current={s === view.sort ? "true" : undefined} data-testid={`gcs-downloads-sort-${s}`}>
                  {t(`sorts.${s}`)}
                </Link>
              ))}
            </nav>
          </div>
          {view.tag && (
            <p className="gcs-dlTagFilter">
              {t("taggedWith", { tag: view.tag })} <Link href={basePath}>{t("clearFilter")}</Link>
            </p>
          )}
          {view.files.length === 0 ? (
            <div className="gcs-card gcs-dlEmpty" data-testid="gcs-downloads-empty">
              <GcsIcon name="fa-solid fa-box-open" className="gcs-emptyIcon" />
              <p>{view.q || view.tag ? t("noResults") : t("emptyCategory")}</p>
            </div>
          ) : (
            <GcsDownloadGrid files={view.files} />
          )}
          <GcsPagination pagination={view.pagination} href={(p) => href(p)} />
        </>
      )}
    </>
  );
}
