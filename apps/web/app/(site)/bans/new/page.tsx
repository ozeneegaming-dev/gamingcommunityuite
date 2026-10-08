import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { sanctionAbilities } from "@/lib/sanction-form";
import { services } from "@/lib/services";
import { GcsSanctionForm } from "../../_components/servers/GcsSanctionForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bridge.sanctionForm"))("titleCreate") };
}

export const dynamic = "force-dynamic";

/**
 * `/bans/new` (specul 2026-10-08-servere-pagini §4): sancțiune nouă de pe site, pentru staff-ul cu `servers.sanction` și
 * adminii serverelor (după flag-uri). `?player={id}` precompletează ținta (butonul din profilul jucătorului).
 */
export default async function NewSanctionPage({ searchParams }: { searchParams: Promise<{ player?: string }> }) {
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled())) notFound();
  const [sp, actor, t] = await Promise.all([searchParams, currentActor(), getTranslations("bridge.sanctionForm")]);
  const abilities = await sanctionAbilities(actor);
  if (!abilities) notFound();
  const player = /^\d{1,9}$/.test(sp.player ?? "") ? await bridge.players.get(Number(sp.player)) : null;
  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("titleCreate")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/bans">
                <GcsIcon name="fa-solid fa-gavel" className="gcs-breadcrumb__home" />
                {t("bans")}
              </Link>
            </li>
            <li aria-current="page">{t("titleCreate")}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-gavel" className="gcs-hIcon" />
            {t("titleCreate")}
          </h1>
          <p className="gcs-pageHeader__desc">{abilities.staff ? t("leadStaff") : t("leadAdmin")}</p>
        </div>
      </header>
      <GcsCard as="section" className="gcs-formCard">
        <GcsSanctionForm mode="create" abilities={abilities} initialPlayer={player ? { id: player.id, name: player.name, kind: player.kind, value: player.value } : null} />
      </GcsCard>
    </>
  );
}
