import { DONATION_GOALS_ACP_SECTION, dayKey, goalPeriod } from "@gcs/modules";
import { GcsBadge, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { requireAcpSection } from "@/lib/acp";
import { formatMoney, formatProgress } from "@/lib/donations";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { deleteGoal, saveGoal } from "../actions";
import { GcsGoalFields } from "../GcsGoalFields";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.donations.goals"))("title") };
}

/**
 * ACP › VIP & Magazin › Donații › Obiective: obiectivele cu progresul perioadei curente (donațiile confirmate, în moneda
 * obiectivului), starea și grupurile, plus adăugarea. Primul obiectiv activ e cel implicit al widget-ului.
 */
export default async function AcpDonationGoalsPage() {
  const panel = await requireAcpSection(DONATION_GOALS_ACP_SECTION);
  const [t, locale] = await Promise.all([getTranslations("acp.donations.goals"), getLocale()]);
  const { donations, db, acp, settings } = services();
  const [goals, groups, currency, canEdit, canDelete, tz] = await Promise.all([
    donations.goals(),
    db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    donations.mainCurrency(),
    acp.can(panel.actor, DONATION_GOALS_ACP_SECTION, "edit"),
    acp.can(panel.actor, DONATION_GOALS_ACP_SECTION, "delete"),
    settings.get<string>("site.timezone"),
  ]);
  // Progresul pentru staff: același calcul ca în widget, fără restricția de grupuri.
  const root = { ...panel.actor, groupIds: groups.map((g) => g.id) };
  const views = await Promise.all(goals.map((g) => (g.enabled ? donations.goalView(root, g.id) : Promise.resolve(null))));
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? `#${id}`;
  const now = new Date();

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-bullseye">{t("title")}</GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0, maxWidth: 760 }}>
        {t("lead")}
      </p>

      <GcsCard as="section" className="gcs-donTable" aria-label={t("list")}>
        {goals.length === 0 && (
          <p className="gcs-muted" style={{ padding: 16, margin: 0 }}>
            {t("empty")}
          </p>
        )}
        {goals.map((g, i) => {
          const view = views[i];
          const p = goalPeriod(g, now, tz);
          return (
            <div key={g.id} className="gcs-donTable__row" data-testid="gcs-acp-goal">
              <div className="gcs-donTable__main">
                <span className="gcs-donTable__who">
                  <strong>{g.title}</strong>
                  <GcsBadge tone={!g.enabled ? "neutral" : p.state === "active" ? "ok" : "warn"}>{g.enabled ? t(`states.${p.state}`) : t("disabled")}</GcsBadge>
                </span>
                <span className="gcs-donTable__meta">
                  {g.period === "MONTHLY" ? (g.autoRenew ? t("monthlyRenew") : t("monthlyOnce")) : t("custom")}
                  {` · ${p.startDay} → ${new Date(Date.parse(`${p.nextDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)}`}
                  {` · ${g.groupIds.length === 0 ? t("everyone") : g.groupIds.map(groupName).join(", ")}`}
                </span>
                {view ? (
                  <span className="gcs-donTable__progress">
                    <span className="gcs-donGoal__bar" role="progressbar" aria-label={g.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}>
                      <span className="gcs-donGoal__fill" style={{ "--gcs-don-pct": `${view.percent}%` } as CSSProperties} />
                    </span>
                    <span className="gcs-donTable__meta">
                      {formatProgress(view.raised, view.target, view.currency, locale)} · {t("donors", { count: view.donors })}
                    </span>
                  </span>
                ) : (
                  <span className="gcs-donTable__meta">{t("target", { amount: formatMoney(g.target, g.currency, locale) })}</span>
                )}
              </div>
              <div className="gcs-donTable__actions">
                {canEdit && (
                  <Link href={`/admin/vip/donations/goals/${g.id}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm" aria-label={t("editLabel", { title: g.title })} title={t("editLabel", { title: g.title })}>
                    <GcsIcon name="fa-solid fa-pen" />
                    {t("edit")}
                  </Link>
                )}
                {canDelete && (
                  <GcsActionForm action={deleteGoal.bind(null, g.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("deleteBody", { title: g.title })}>
                    {null}
                  </GcsActionForm>
                )}
              </div>
            </div>
          );
        })}
      </GcsCard>

      {canEdit && (
        <GcsCard as="section" style={{ padding: 20, maxWidth: 860 }} aria-labelledby="gcs-acp-goal-add">
          <h2 id="gcs-acp-goal-add" className="gcs-acpWidget__title" style={{ marginTop: 0 }}>
            {t("add")}
          </h2>
          <GcsActionForm action={saveGoal.bind(null, null)} submitLabel={t("addSubmit")} submitKind="create">
            <GcsGoalFields groups={groups} values={{ title: "", target: "", currency, period: "MONTHLY", startsOn: dayKey(now, tz).slice(0, 8) + "01", endsOn: "", autoRenew: true, groupIds: [], enabled: true }} />
          </GcsActionForm>
        </GcsCard>
      )}
    </>
  );
}
