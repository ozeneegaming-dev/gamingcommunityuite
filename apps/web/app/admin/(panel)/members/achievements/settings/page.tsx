import { RANKS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { recomputeRanks } from "../actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.achievements"))("settingsTitle") };
}

/**
 * ACP → Membri → Realizări → Setări: punctele pe acțiune sunt regulile „pentru fiecare …” (editabile în Reguli);
 * aici se vede rezumatul și se pot recalcula rangurile tuturor.
 */
export default async function AcpAchievementSettingsPage() {
  await requireAcpSection(RANKS_ACP_SECTION);
  const t = await getTranslations("acp.achievements");
  const rules = await services().db.achievementRule.findMany({ where: { trigger: { in: ["EACH_POST", "EACH_REACTION_RECEIVED", "EACH_SOLUTION"] } }, orderBy: { position: "asc" } });
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-sliders">
        {t("settingsTitle")}
      </GcsAcpTitle>
      <GcsCard as="section" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="gcs-acpWidget__title"><GcsAcpTitleIcon name="fa-solid fa-coins" />{t("pointsTitle")}</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {rules.map((r) => (
            <li key={r.id}>
              {t(`triggers.${r.trigger}`)}: <strong>{r.points > 0 ? `+${r.points}` : r.points}</strong>
              {!r.enabled && <span className="gcs-muted"> · {t("disabled")}</span>}
            </li>
          ))}
        </ul>
        <Link href="/admin/members/achievements/rules">{t("editRules")}</Link>
      </GcsCard>
      <GcsCard as="section" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="gcs-acpWidget__title"><GcsAcpTitleIcon name="fa-solid fa-rotate" />{t("recomputeTitle")}</h2>
        <p className="gcs-muted" style={{ margin: 0 }}>
          {t("recomputeHelp")}
        </p>
        <GcsActionForm action={recomputeRanks} submitLabel={t("recompute")} submitKind="recompute" variant="ghost">
          {null}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
