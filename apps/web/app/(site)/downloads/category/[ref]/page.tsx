import { downloadCategoryHref } from "@gcs/modules";
import { parseRef } from "@gcs/modules/slug";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsDownloadListing } from "../../../_components/downloads/GcsDownloadListing";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ sort?: string; page?: string; q?: string; tag?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ref = parseRef((await params).ref);
  const category = ref ? await services().downloads.access.category(ref.id) : null;
  return category ? { title: category.name, alternates: { canonical: downloadCategoryHref(category), types: { "application/rss+xml": `/downloads/rss.xml?category=${category.id}` } } } : {};
}

/** `/downloads/category/{id}-{slug}`: o categorie (adresa canonică are slug-ul de acum). */
export default async function DownloadCategoryPage({ params, searchParams }: Props) {
  const { downloads } = services();
  const actor = await currentActor();
  if (!(await downloads.queries.canUseApp(actor))) notFound();
  const ref = parseRef((await params).ref);
  const category = ref ? await downloads.access.category(ref.id) : null;
  if (!ref || !category) notFound();
  if (ref.slug !== category.slug) permanentRedirect(downloadCategoryHref(category));
  const view = await GcsDownloadListing({ actor, categoryId: category.id, query: await searchParams, basePath: downloadCategoryHref(category) });
  if (!view) notFound();
  return view;
}
