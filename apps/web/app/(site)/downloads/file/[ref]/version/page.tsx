import { parseRef } from "@gcs/modules/slug";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { flatCategories } from "../../../../_components/downloads/categories";
import { GcsDownloadForm } from "../../../../_components/downloads/GcsDownloadForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ref: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("downloads"))("newVersion") };
}

/** `/downloads/file/{id}-{slug}/version`: o versiune nouă (fișierele, eticheta, lista schimbărilor), prin verificare. */
export default async function NewVersionPage({ params }: Props) {
  const { downloads } = services();
  const actor = await currentActor();
  if (!(await downloads.queries.canUseApp(actor))) notFound();
  const ref = parseRef((await params).ref);
  const form = ref ? await downloads.queries.editForm(actor, ref.id) : null;
  if (!form?.context?.category || form.file.status !== "approved") notFound();
  const t = await getTranslations("downloads");
  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("title")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/downloads"><GcsIcon name="fa-solid fa-download" className="gcs-breadcrumb__home" />{t("title")}</Link>
            </li>
            <li><Link href={form.file.href}>{form.file.title}</Link></li>
            <li aria-current="page">{t("newVersion")}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title"><GcsIcon name="fa-solid fa-code-branch" className="gcs-hIcon" />{t("newVersionTitle", { title: form.file.title })}</h1>
          {form.file.version && <p className="gcs-pageHeader__desc">{t("currentIs", { version: form.file.version })}</p>}
        </div>
      </header>
      <GcsDownloadForm mode="version" fileId={form.file.id} fileHref={form.file.href} context={{ ...form.context, categories: flatCategories(form.context.categories) }} />
    </>
  );
}
