import type { GcsCrumb } from "@gcs/modules";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { forumHref } from "@/lib/forum-urls";

/** Breadcrumb-ul din macheta Topic: Forum › categorie › forum. */
export async function GcsBreadcrumb({ crumbs }: { crumbs: GcsCrumb[] }) {
  const t = await getTranslations("forum");
  return (
    <nav aria-label={t("breadcrumb")} className="gcs-breadcrumb">
      <ol>
        <li>
          <Link href="/">{t("home")}</Link>
        </li>
        {crumbs.map((c) => (
          <li key={c.id}>
            <Link href={forumHref(c)}>{c.name}</Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
