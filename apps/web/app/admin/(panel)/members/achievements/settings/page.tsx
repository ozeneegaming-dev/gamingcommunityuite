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
 * ACP → Membri → Realizări → Setări: cine nu primește nimic din reguli și pragul badge-urilor rare (formularul pe
 * secțiuni), recalcularea regulilor în fundal, rezumatul punctelor pe acțiune (editabile în Reguli) și recalcularea
 * rangurilor tuturor. Cardurile mici stau câte două pe ecranele late.
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
      <GcsAcpTitle icon="fa-solid fa-sliders">{t("settingsTitle")}</GcsAcpTitle>
      <GcsCard as="section" aria-labelledby="gcs-ach-settings" className="gcs-achSettings__card" data-testid="gcs-ach-settings">
        <h2 id="gcs-ach-settings" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-sliders" />
          {t("v2.settingsTitle")}
        </h2>
        <GcsActionForm action={saveAchievementSettings} submitLabel={t("save")} submitKind="save">
          <fieldset className="gcs-formSec">
            <legend>{t("v2.excludedGroups")}</legend>
            <div className="gcs-ruleB__chips">
              {groups.map((g) => (
                <label key={g.id} className="gcs-chip gcs-ruleB__chip">
                  <input type="checkbox" name="excludedGroups" value={g.id} defaultChecked={excluded.includes(g.id)} />
                  {g.name}
                </label>
              ))}
            </div>
            <p className="gcs-achHint">{t("v2.excludedHelp")}</p>
          </fieldset>
          <fieldset className="gcs-formSec">
            <legend>{t("panel.secRare")}</legend>
            <div className="gcs-formGrid">
              <label className="gcs-field">
                {t("v2.rarePercent")}
                <input className="gcs-input" name="rarePercent" type="number" min={0.1} max={100} step={0.1} defaultValue={rare} />
              </label>
            </div>
          </fieldset>
        </GcsActionForm>
      </GcsCard>
      <div className="gcs-achSettings">
        <GcsCard as="section" aria-labelledby="gcs-ach-recalc" className="gcs-achSettings__card">
          <h2 id="gcs-ach-recalc" className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-gears" />
            {t("v2.recalcTitle")}
          </h2>
          <p className="gcs-achHint">{t("v2.recalcHelp")}</p>
          <GcsRecalcPanel initial={{ state: recalc.state, done: recalc.done, total: recalc.total, awarded: recalc.awarded }} />
        </GcsCard>
        <GcsCard as="section" aria-labelledby="gcs-ach-ranks" className="gcs-achSettings__card">
          <h2 id="gcs-ach-ranks" className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-rotate" />
            {t("recomputeTitle")}
          </h2>
          <p className="gcs-achHint">{t("recomputeHelp")}</p>
          <GcsActionForm action={recomputeRanks} submitLabel={t("recompute")} submitKind="recompute" variant="ghost">
            {null}
          </GcsActionForm>
        </GcsCard>
        <GcsCard as="section" aria-labelledby="gcs-ach-points" className="gcs-achSettings__card">
          <h2 id="gcs-ach-points" className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-coins" />
            {t("pointsTitle")}
          </h2>
          <ul className="gcs-achPoints">
            {rules.map((r) => (
              <li key={r.id} className={r.enabled ? undefined : "is-off"}>
                <span>{t(`triggers.${r.trigger}`)}</span>
                <strong>{r.points > 0 ? `+${r.points}` : r.points}</strong>
                {!r.enabled && <span className="gcs-achChip">{t("disabled")}</span>}
              </li>
            ))}
          </ul>
          <Link href="/admin/members/achievements/rules" className="gcs-achLink">
            {t("editRules")}
          </Link>
        </GcsCard>
      </div>
    </>
  );
}
