import { GcsError } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsMemberCard } from "../_components/members/GcsMemberCard";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("members"))("staffTitle") };
}

/** `/staff` (specul etapei 5): echipa, grupată pe grupurile cu acces la moderare sau la ACP, cu statusul online. */
export default async function StaffPage() {
  const t = await getTranslations("members");
  const groups = await services()
    .memberList.staff(await currentActor())
    .catch((error: unknown) => {
      if (error instanceof GcsError && error.status === 403) return null;
      throw error;
    });
  if (!groups) {
    return (
      <GcsCard style={{ padding: 24 }} role="alert" data-testid="gcs-members-forbidden">
        {t("forbidden")}
      </GcsCard>
    );
  }
  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 30 }}>
        {t("staffTitle")}
      </h1>
      {groups.length === 0 && <GcsCard style={{ padding: 24, color: "var(--gcs-muted)" }}>{t("empty")}</GcsCard>}
      {groups.map((g) => (
        <section key={g.id} className="gcs-staffGroup" aria-labelledby={`gcs-staff-${g.key}`} data-testid="gcs-staff-group" data-group={g.key}>
          <h2 id={`gcs-staff-${g.key}`} className={`gcs-display gcs-staffGroup__title gcs-name--${g.key}`}>
            {g.icon && <GcsIcon name={g.icon} />} {g.name} <span className="gcs-muted">({g.members.length})</span>
          </h2>
          <div className="gcs-memberGrid">
            {g.members.map((m) => (
              <GcsMemberCard key={m.id} member={m} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
