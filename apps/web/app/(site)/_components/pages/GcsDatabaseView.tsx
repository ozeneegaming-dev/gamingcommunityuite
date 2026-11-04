import type { GcsActor } from "@gcs/core";
import { FILTERABLE_FIELD_TYPES, PAGES_FOLLOW_TYPE, PAGES_LIST_SORTS, type GcsPagesCategoryView, type GcsPagesDb } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { services } from "@/lib/services";
import { GcsPagination } from "../forum/GcsPagination";
import { GcsFollowDatabase } from "./GcsPagesTools";
import { GcsRecordList } from "./GcsRecordList";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Cardurile categoriilor (cuprinsul bazei sau subcategoriile categoriei deschise). */
async function CategoryCards({ categories }: { categories: GcsPagesCategoryView[] }) {
  const [t, format] = await Promise.all([getTranslations("pages"), getFormatter()]);
  if (categories.length === 0) return null;
  return (
    <ul className="gcs-pgCats" data-testid="gcs-pages-categories">
      {categories.map((c) => (
        <li key={c.id} className="gcs-pgCats__item" style={c.color ? ({ "--gcs-pg-cat": c.color } as CSSProperties) : undefined}>
          <Link href={c.href} className="gcs-pgCats__link">
            {c.image ? <img src={c.image} alt="" loading="lazy" className="gcs-pgCats__cover" /> : <GcsIcon name={c.icon ?? "fa-regular fa-folder"} className="gcs-pgCats__icon" />}
            <span className="gcs-pgCats__text">
              <strong>
                {c.name}
                {c.private && <GcsIcon name="fa-solid fa-lock" className="gcs-pgCats__lock" />}
              </strong>
              {c.description && <span className="gcs-pgCats__desc">{c.description}</span>}
              <span className="gcs-pgCats__count">{t("recordsCount", { count: c.recordsCount, n: format.number(c.recordsCount) })}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pagina unei baze de date: antetul (descrierea, „Adaugă …”, „Urmărește”, RSS), categoriile, căutarea, filtrele pe
 * câmpuri și ordinea, apoi înregistrările în aspectul bazei, cu paginare. Staff-ul are și cozile (în așteptare, ascunse);
 * membrul, „Trimiterile mele”.
 */
export async function GcsDatabaseView({ actor, db, title, categorySlug, searchParams }: { actor: GcsActor; db: GcsPagesDb; title: string; categorySlug: string | null; searchParams: Search }) {
  const { pagesQueries, pagesAccess, follows } = services();
  const t = await getTranslations("pages");
  const base = `/pages/${db.path}`;
  const categories = await pagesQueries.categories(actor, db);
  const category = categorySlug ? categories.find((c) => c.slug === categorySlug) : null;
  if (categorySlug && !category) return null;
  const staff = await pagesAccess.isStaff(actor);
  const statusParam = one(searchParams.status);
  const status = statusParam === "pending" || statusParam === "hidden" ? (staff ? statusParam : undefined) : statusParam === "mine" && actor.userId ? "mine" : undefined;
  const q = one(searchParams.q).slice(0, 100);
  const sort = PAGES_LIST_SORTS.includes(one(searchParams.sort)) ? one(searchParams.sort) : undefined;
  const filterDefs = db.fields.filter((f) => f.filter && FILTERABLE_FIELD_TYPES.includes(f.type) && f.type !== "server" && f.type !== "member");
  const filters = Object.fromEntries(filterDefs.flatMap((f) => (one(searchParams[`f_${f.key}`]) ? [[f.key, one(searchParams[`f_${f.key}`])]] : [])));
  const page = Math.max(1, Number(one(searchParams.page)) || 1);
  const showIndex = !category && !q && !status && Object.keys(filters).length === 0 && db.indexMode === "categories" && categories.length > 0;
  const list = showIndex
    ? null
    : await pagesQueries.list(actor, db, { categoryId: category?.id ?? null, page, q, ...(sort ? { sort } : {}), filters, ...(status ? { status } : {}), featured: !category && !q && !status && db.indexMode === "featured" });
  const [canSubmit, following] = await Promise.all([pagesAccess.canSubmit(actor, db), actor.userId ? follows.isFollowing(actor.userId, PAGES_FOLLOW_TYPE, String(db.id)) : Promise.resolve(false)]);
  const href = (patch: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    const cur: Record<string, string> = { q, ...(sort ? { sort } : {}), ...(status ? { status } : {}), ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [`f_${k}`, v])) };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v !== null && v !== "" && v !== 1) params.set(k, String(v));
    const qs = params.toString();
    return `${category ? category.href : base}${qs ? `?${qs}` : ""}`;
  };
  const children = category ? categories.filter((c) => c.parentId === category.id) : categories.filter((c) => c.parentId === null);
  const noun = db.recordLabel || t("record");

  return (
    <div className="gcs-pgDb" data-testid="gcs-pages-database" data-database={db.key}>
      <header className="gcs-pageHeader gcs-pgDb__head">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name={category?.icon ?? db.icon ?? "fa-solid fa-database"} className="gcs-hIcon" />
            {category ? category.name : title}
          </h1>
          {(category?.description || (!category && db.description)) && <p className="gcs-pageHeader__desc">{category ? category.description : db.description}</p>}
        </div>
        <div className="gcs-pageHeader__actions">
          {db.rss && (
            <a className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/pages/rss/${db.key}`} aria-label={t("rss")} title={t("rss")}>
              <GcsIcon name="fa-solid fa-rss" />
            </a>
          )}
          {actor.userId && <GcsFollowDatabase databaseId={db.id} following={following} />}
          {canSubmit && (
            <Link className="gcs-btn gcs-btn--primary gcs-btn--sm" href={`${base}/submit${category ? `?c=${category.id}` : ""}`} data-testid="gcs-pages-submit">
              <GcsIcon name="fa-solid fa-plus" />
              {t("add", { noun: noun.toLowerCase() })}
            </Link>
          )}
        </div>
      </header>

      {category && (
        <nav className="gcs-breadcrumb gcs-pgDb__crumbs" aria-label={t("breadcrumb")}>
          <ol>
            <li>
              <Link href={base}>{title}</Link>
            </li>
            <li aria-current="page">{category.name}</li>
          </ol>
        </nav>
      )}

      {(showIndex || category) && <CategoryCards categories={children} />}

      {!showIndex && (
        <>
          <form className="gcs-card gcs-pgFilters" method="get" action={category ? category.href : base} role="search" data-testid="gcs-pages-filters">
            <label className="gcs-field gcs-pgFilters__q">
              <span className="gcs-srOnly">{t("searchIn", { name: title })}</span>
              <input className="gcs-input" type="search" name="q" defaultValue={q} maxLength={100} placeholder={t("searchIn", { name: title })} />
            </label>
            {filterDefs.map((f) => (
              <label key={f.key} className="gcs-field gcs-pgFilters__f">
                <span className="gcs-field__label">{f.label}</span>
                <select className="gcs-input" name={`f_${f.key}`} defaultValue={filters[f.key] ?? ""}>
                  <option value="">{t("any")}</option>
                  {f.type === "checkbox" ? (
                    <>
                      <option value="1">{t("yes")}</option>
                      <option value="0">{t("no")}</option>
                    </>
                  ) : (
                    f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))
                  )}
                </select>
              </label>
            ))}
            <label className="gcs-field gcs-pgFilters__f">
              <span className="gcs-field__label">{t("sortBy")}</span>
              <select className="gcs-input" name="sort" defaultValue={list?.sort ?? db.sort}>
                {["newest", "updated", "title", "rating", "views", "comments"].map((s) => (
                  <option key={s} value={s}>
                    {t(`sort.${s}` as never)}
                  </option>
                ))}
              </select>
            </label>
            {status && <input type="hidden" name="status" value={status} />}
            <button type="submit" className="gcs-btn gcs-btn--ghost">
              <GcsIcon name="fa-solid fa-filter" />
              {t("apply")}
            </button>
          </form>

          {(staff || actor.userId) && (
            <nav className="gcs-segLinks gcs-pgDb__queues" aria-label={t("queues")}>
              <Link href={href({ status: null, page: null })} className={`gcs-segLink${!status ? " gcs-segLink--active" : ""}`} aria-current={!status ? "page" : undefined}>
                {t("queue.published")}
              </Link>
              {actor.userId && (
                <Link href={href({ status: "mine", page: null })} className={`gcs-segLink${status === "mine" ? " gcs-segLink--active" : ""}`} aria-current={status === "mine" ? "page" : undefined}>
                  {t("queue.mine")}
                </Link>
              )}
              {staff && (
                <>
                  <Link href={href({ status: "pending", page: null })} className={`gcs-segLink${status === "pending" ? " gcs-segLink--active" : ""}`} data-testid="gcs-pages-queue-pending">
                    {t("queue.pending")}
                  </Link>
                  <Link href={href({ status: "hidden", page: null })} className={`gcs-segLink${status === "hidden" ? " gcs-segLink--active" : ""}`}>
                    {t("queue.hidden")}
                  </Link>
                </>
              )}
            </nav>
          )}

          <GcsRecordList db={db} records={list!.records} view={db.listLayout} />
          <GcsPagination pagination={list!.pagination} href={(p) => href({ page: p })} />
        </>
      )}
    </div>
  );
}
