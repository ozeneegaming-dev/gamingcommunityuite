import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { flatCategories } from "../../_components/downloads/categories";
import { GcsDownloadForm } from "../../_components/downloads/GcsDownloadForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("downloads"))("submit") };
}

type Props = { searchParams: Promise<{ category?: string }> };

/**
 * `/downloads/submit`: întâi categoria (regulile ei: extensii, mărime, versiuni, capturi, termeni), apoi formularul.
 * Vizitatorul e trimis la autentificare; fără nicio categorie cu drept de încărcare, un mesaj.
 */
export default async function SubmitDownloadPage({ searchParams }: Props) {
  const { downloads } = services();
  const actor = await currentActor();
  if (!(await downloads.queries.canUseApp(actor))) notFound();
  if (!actor.userId) redirect(`/login?next=${encodeURIComponent("/downloads/submit")}`);
  const raw = (await searchParams).category;
  const categoryId = raw && /^\d{1,10}$/.test(raw) ? Number(raw) : null;
  const [t, context] = await Promise.all([getTranslations("downloads"), downloads.queries.submitContext(actor, categoryId)]);
  if (!context) notFound();
  const categories = flatCategories(context.categories);
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
            <li aria-current="page">{t("submit")}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-cloud-arrow-up" className="gcs-hIcon" />
            {t("submit")}
          </h1>
          <p className="gcs-pageHeader__desc">{t("submitLead")}</p>
        </div>
      </header>
      {categories.length === 0 ? (
        <div className="gcs-card gcs-dlEmpty" data-testid="gcs-downloads-no-upload">
          <GcsIcon name="fa-solid fa-lock" className="gcs-emptyIcon" />
          <p>{t("noUploadCategory")}</p>
        </div>
      ) : (
        <div className="gcs-dlSubmit">
          <form className="gcs-card gcs-dlPick" action="/downloads/submit" data-testid="gcs-download-pick">
            <label className="gcs-field">
              {t("form.category")}
              <select className="gcs-input" name="category" defaultValue={context.category?.id ?? ""} data-testid="gcs-download-category">
                <option value="" disabled>{t("form.chooseCategory")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{`${"— ".repeat(c.depth)}${c.name}${c.vip ? " (VIP)" : ""}`}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="gcs-btn gcs-btn--ghost" data-testid="gcs-download-category-go">
              <GcsIcon name="fa-solid fa-arrow-right" />
              {context.category ? t("form.changeCategory") : t("form.continue")}
            </button>
          </form>
          {context.category && <GcsDownloadForm key={context.category.id} mode="submit" context={{ ...context, categories }} />}
        </div>
      )}
    </>
  );
}
