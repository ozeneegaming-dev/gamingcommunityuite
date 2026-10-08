import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsClanForm } from "../../_components/clans/GcsClanForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clans"))("createTitle") };
}

export const dynamic = "force-dynamic";

/**
 * `/clans/new` (specul 2026-10-08-clanuri §7.4): formularul de creare, doar cu `clans.create`; cu aprobarea pornită,
 * nota că clanul va aștepta staff-ul. Fără drept, pagina explică cine poate crea.
 */
export default async function NewClanPage() {
  const { clanQueries, permissions } = services();
  if (!(await clanQueries.appEnabled())) notFound();
  const [actor, t] = await Promise.all([currentActor(), getTranslations("clans")]);
  const allowed = actor.userId !== null && (await permissions.can(actor, "clans.create"));
  const options = await clanQueries.options();

  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("title")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/clans">
                <GcsIcon name="fa-solid fa-people-group" className="gcs-breadcrumb__home" />
                {t("title")}
              </Link>
            </li>
            <li aria-current="page">{t("createTitle")}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-flag" className="gcs-hIcon" />
            {t("createTitle")}
          </h1>
          <p className="gcs-pageHeader__desc">{t("createLead")}</p>
        </div>
      </header>
      {allowed ? (
        <GcsCard style={{ padding: 20 }}>
          <GcsClanForm
            mode="create"
            leader
            initial={{ tag: "", name: "", description: "", color: "#D62839", color2: "#1B1E26", links: {}, joinMode: "REQUEST", logo: null, banner: null, officerRights: [] }}
            options={{
              tagMin: options.tagMin,
              tagMax: options.tagMax,
              tagCharset: options.tagCharset,
              requiredFields: options.requiredFields,
              logoMaxKb: options.logoMaxKb,
              bannerMaxKb: options.bannerMaxKb,
              forumMode: options.forumParent > 0 ? options.forumMode : "off",
              officerRights: options.officerRights,
              requireApproval: options.requireApproval,
            }}
          />
        </GcsCard>
      ) : (
        <GcsCard style={{ padding: 24 }} role="alert" data-testid="gcs-clan-create-forbidden">
          <GcsIcon name="fa-solid fa-lock" className="gcs-emptyIcon" />
          {actor.userId ? t("createForbidden") : t("createGuest")}
        </GcsCard>
      )}
    </>
  );
}
