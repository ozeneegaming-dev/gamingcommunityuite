import { RANKS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { recomputeRanks, saveAchievementSettings } from "../actions";
import { GcsRecalcPanel } from "./GcsRecalcPanel";
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
  const { db, settings, achievementRules } = services();
  const [rules, groups, excluded, rare, recalc] = await Promise.all([
    db.achievementRule.findMany({ where: { trigger: { in: ["EACH_POST", "EACH_REACTION_RECEIVED", "EACH_SOLUTION"] } }, orderBy: { position: "asc" } }),
    db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    settings.get<number[]>("achievements.excluded_groups"),
    settings.get<number>("achievements.rare_percent"),
    achievementRules.recalcStatus(),
  ]);
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-sliders">
        {t("settingsTitle")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-labelledby="gcs-ach-settings" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-ach-settings">
        <h2 id="gcs-ach-settings" className="gcs-acpWidget__title"><GcsAcpTitleIcon name="fa-solid fa-sliders" />{t("v2.settingsTitle")}</h2>
        <GcsActionForm action={saveAchievementSettings} submitLabel={t("save")} submitKind="save">
          <fieldset className="gcs-ruleB__chips">
            <legend>{t("v2.excludedGroups")}</legend>
            {groups.map((g) => (
              <label key={g.id} className="gcs-chip gcs-ruleB__chip">
                <input type="checkbox" name="excludedGroups" value={g.id} defaultChecked={excluded.includes(g.id)} />
                {g.name}
              </label>
            ))}
          </fieldset>
          <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>{t("v2.excludedHelp")}</p>
          <label className="gcs-field" style={{ maxWidth: 220 }}>
            {t("v2.rarePercent")}
            <input className="gcs-input" name="rarePercent" type="number" min={0.1} max={100} step={0.1} defaultValue={rare} />
          </label>
        </GcsActionForm>
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-ach-recalc" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="gcs-ach-recalc" className="gcs-acpWidget__title"><GcsAcpTitleIcon name="fa-solid fa-gears" />{t("v2.recalcTitle")}</h2>
        <p className="gcs-muted" style={{ margin: 0 }}>{t("v2.recalcHelp")}</p>
        <GcsRecalcPanel initial={{ state: recalc.state, done: recalc.done, total: recalc.total, awarded: recalc.awarded }} />
      </GcsCard>
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
