import { GcsButton } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { landingCanonical } from "@/lib/landing";
import { services } from "@/lib/services";
import { GcsCategoryList, GcsDownloadGrid } from "../_components/downloads/GcsDownloadCards";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("downloads");
  return { title: t("title"), alternates: { canonical: await landingCanonical("downloads", "/downloads"), types: { "application/rss+xml": "/downloads/rss.xml" } } };
}

export const dynamic = "force-dynamic";

/**
 * `/downloads` (specul 2026-11-03-descarcari §6): antetul cu „Trimite un fișier” și „Toate fișierele”, căutarea, casetele
 * alese în ACP (Recomandate, Noutăți, Cele mai bine notate, Cele mai descărcate) și categoriile cu numărul de fișiere.
 */
export default async function DownloadsPage() {
  const { downloads } = services();
  const actor = await currentActor();
  if (!(await downloads.queries.canUseApp(actor))) notFound();
  const [t, view] = await Promise.all([getTranslations("downloads"), downloads.queries.index(actor)]);
  const boxes = [
    { key: "featured", icon: "fa-solid fa-star", files: view.boxes.featured, href: "/downloads/all?sort=updated" },
    { key: "new", icon: "fa-solid fa-bolt", files: view.boxes.new, href: "/downloads/all?sort=newest" },
    { key: "rated", icon: "fa-solid fa-ranking-star", files: view.boxes.rated, href: "/downloads/all?sort=rating" },
    { key: "downloaded", icon: "fa-solid fa-fire", files: view.boxes.downloaded, href: "/downloads/all?sort=downloads" },
  ].filter((b) => b.files.length > 0);

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-download" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc" data-testid="gcs-downloads-summary">
            {view.total > 0 ? t("lead", { count: view.total }) : t("leadEmpty")}
          </p>
        </div>
        <div className="gcs-pageHeader__actions">
          <Link className="gcs-btn gcs-btn--ghost" href="/downloads/all" data-testid="gcs-downloads-all">
            <GcsIcon name="fa-solid fa-list" />
            {t("viewAll")}
          </Link>
          {actor.userId && (
            <Link className="gcs-btn gcs-btn--ghost" href="/downloads/mine">
              <GcsIcon name="fa-solid fa-folder-open" />
              {t("mine")}
            </Link>
          )}
          {view.canSubmit && (
            <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-cloud-arrow-up" />}>
              <Link href="/downloads/submit" data-testid="gcs-downloads-submit">{t("submit")}</Link>
            </GcsButton>
          )}
        </div>
      </header>

      <form className="gcs-dlSearch" action="/downloads/all" role="search">
        <label className="gcs-srOnly" htmlFor="gcs-dl-q">{t("searchLabel")}</label>
        <input id="gcs-dl-q" className="gcs-input" name="q" type="search" placeholder={t("searchPlaceholder")} maxLength={60} />
        <button type="submit" className="gcs-btn gcs-btn--ghost">
          <GcsIcon name="fa-solid fa-magnifying-glass" />
          {t("search")}
        </button>
      </form>

      <div className="gcs-dlLayout">
        <div className="gcs-dlLayout__main">
          {boxes.map((b) => (
            <section key={b.key} className="gcs-dlBox" aria-labelledby={`gcs-dl-box-${b.key}`} data-testid={`gcs-downloads-box-${b.key}`}>
              <h2 id={`gcs-dl-box-${b.key}`} className="gcs-titleBand gcs-dlBox__title">
                <GcsIcon name={b.icon} className="gcs-hIcon" />
                {t(`boxes.${b.key}`)}
                <Link href={b.href} className="gcs-dlBox__more">{t("seeMore")}</Link>
              </h2>
              <GcsDownloadGrid files={b.files} testId={`gcs-downloads-grid-${b.key}`} compact={b.key !== "featured"} />
            </section>
          ))}
          {view.categories.length === 0 && boxes.length === 0 && (
            <div className="gcs-card gcs-dlEmpty" data-testid="gcs-downloads-empty">
              <GcsIcon name="fa-solid fa-box-open" className="gcs-emptyIcon" />
              <p>{t("empty")}</p>
            </div>
          )}
        </div>
        <aside className="gcs-dlLayout__side">
          <section className="gcs-dlBox" aria-labelledby="gcs-dl-cats">
            <h2 id="gcs-dl-cats" className="gcs-titleBand gcs-dlBox__title">
              <GcsIcon name="fa-solid fa-folder-tree" className="gcs-hIcon" />
              {t("categories")}
            </h2>
            <GcsCategoryList categories={view.categories} />
          </section>
          {view.rss && (
            <a className="gcs-dlRss" href="/downloads/rss.xml">
              <GcsIcon name="fa-solid fa-rss" />
              {t("rss")}
            </a>
          )}
        </aside>
      </div>
    </>
  );
}
