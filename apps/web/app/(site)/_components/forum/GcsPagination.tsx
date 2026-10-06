import type { GcsPagination as Pagination } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Paginile din jurul paginii curente (+ prima și ultima), cu „…” între ele. */
function pageList(page: number, pages: number): (number | "gap")[] {
  const wanted = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((p) => p >= 1 && p <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

/** Paginarea (linkuri `?page=N`, cu `aria-current` pe pagina curentă). */
export async function GcsPagination({ pagination, href }: { pagination: Pagination; href: (page: number) => string }) {
  if (pagination.pages <= 1) return null;
  const t = await getTranslations("forum.pagination");
  const { page, pages } = pagination;
  return (
    <nav className="gcs-pagination" aria-label={t("label")}>
      {page > 1 && (
        <Link href={href(page - 1)} className="gcs-pagination__link" rel="prev">
          <GcsIcon name="fa-solid fa-chevron-left" className="gcs-pagination__icon" />
          {t("prev")}
        </Link>
      )}
      {pageList(page, pages).map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="gcs-pagination__gap" aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            className="gcs-pagination__link"
            aria-label={t("page", { page: p })}
            {...(p === page ? { "aria-current": "page" as const } : {})}
          >
            {p}
          </Link>
        ),
      )}
      {page < pages && (
        <Link href={href(page + 1)} className="gcs-pagination__link" rel="next">
          {t("next")}
          <GcsIcon name="fa-solid fa-chevron-right" className="gcs-pagination__icon" />
        </Link>
      )}
    </nav>
  );
}
