import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { FORUM_INDEX_ALT_HREF } from "@/lib/landing";
import { services } from "@/lib/services";
import { GcsForumIndex } from "../_components/forum/GcsForumIndex";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("site.nav"))("forum"), alternates: { canonical: FORUM_INDEX_ALT_HREF } };
}

/**
 * `/forum` (specul 2026-10-09-acp-navigatie-aplicatii §2.3): indexul forumului când aplicația de pornire e alta. Când
 * `/` arată chiar forumul (pornirea e Forumul, sau vizitatorul nu poate accesa aplicația de pornire), duce pe `/`:
 * o singură adresă pentru același conținut și nicio buclă (`/` nu redirecționează niciodată).
 */
export default async function ForumIndexPage() {
  if (!(await services().apps.landingFor(await currentActor()))) redirect("/");
  return <GcsForumIndex />;
}
