import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsDownloadListing } from "../../_components/downloads/GcsDownloadListing";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("downloads"))("allFiles") };
}

type Props = { searchParams: Promise<{ sort?: string; page?: string; q?: string; tag?: string }> };

/** `/downloads/all`: toate fișierele vizibile, cu căutarea (`?q=`), eticheta (`?tag=`) și sortarea. */
export default async function AllDownloadsPage({ searchParams }: Props) {
  const actor = await currentActor();
  if (!(await services().downloads.queries.canUseApp(actor))) notFound();
  return (await GcsDownloadListing({ actor, categoryId: null, query: await searchParams, basePath: "/downloads/all" })) ?? notFound();
}
