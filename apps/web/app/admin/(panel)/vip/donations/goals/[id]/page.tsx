import { DONATION_GOALS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../../_components/GcsAcpTitle";
import { GcsActionForm } from "../../../../_components/GcsActionForm";
import { saveGoal } from "../../actions";
import { GcsGoalFields } from "../../GcsGoalFields";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.donations.goals"))("editTitle") };
}

/** ACP › Donații › Obiective › editarea unui obiectiv. */
export default async function AcpDonationGoalEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAcpSection(DONATION_GOALS_ACP_SECTION, "edit");
  const { id: raw } = await params;
  const id = /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const { donations, db } = services();
  const [t, goal, groups] = await Promise.all([
    getTranslations("acp.donations.goals"),
    id ? donations.goal(id) : Promise.resolve(null),
    db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  ]);
  if (!goal) notFound();
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-bullseye">{t("editTitle")}</GcsAcpTitle>
      <p style={{ margin: 0 }}>
        <Link href="/admin/vip/donations/goals" className="gcs-arrowLink">
          <GcsIcon name="fa-solid fa-arrow-left" /> {t("back")}
        </Link>
      </p>
      <GcsCard style={{ padding: 20, maxWidth: 860 }}>
        <GcsActionForm action={saveGoal.bind(null, goal.id)} submitLabel={t("save")} submitKind="save" redirectTo="/admin/vip/donations/goals">
          <GcsGoalFields
            groups={groups}
            values={{
              title: goal.title,
              target: (goal.target / 100).toFixed(goal.target % 100 === 0 ? 0 : 2),
              currency: goal.currency,
              period: goal.period,
              startsOn: day(goal.startsOn),
              endsOn: day(goal.endsOn),
              autoRenew: goal.autoRenew,
              groupIds: goal.groupIds,
              enabled: goal.enabled,
            }}
          />
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
