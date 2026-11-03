import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { normalizeConditions, normalizeRewards, RULES_ACP_SECTION } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../_components/GcsAcpTitle";
import { deleteRule, saveRule } from "../actions";
import { GcsRuleBuilder, type GcsBuilderEvent, type GcsBuilderRule } from "./GcsRuleBuilder";
import { GcsRuleToggle } from "./GcsRuleToggle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.achievements"))("rulesTitle") };
}

const TRIGGERS = ["POSTS_COUNT", "REPUTATION", "POINTS", "MEMBER_DAYS", "SOLUTIONS_COUNT", "IS_VIP", "EACH_POST", "EACH_REACTION_RECEIVED", "EACH_SOLUTION"] as const;

/**
 * ACP → Membri → Realizări → Reguli: regulile pe evenimente ca propoziții („Când … → Atunci …”, constructorul în
 * panou), apoi regulile clasice („când X atinge pragul, acordă badge-ul și/sau puncte”, plus punctele pe acțiune) ca
 * rânduri compacte cu comutator; „Editează” și „Regulă clasică nouă” deschid panoul regulii.
 */
export default async function AcpRulesPage() {
  await requireAcpSection(RULES_ACP_SECTION);
  const t = await getTranslations("acp.achievements");
  const tAll = await getTranslations();
  const { achievementAdmin, achievementRules, registry, apps, db } = services();
  const [allRules, badges, available, on, forums, groups, nameStyles] = await Promise.all([
    achievementAdmin.rules(),
    achievementAdmin.badges(),
    achievementRules.availableEvents(),
    apps.enabledFilter(),
    db.forum.findMany({ where: { type: "FORUM" }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    db.group.findMany({ where: { key: { notIn: ["guest", "banned"] } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, isVip: true, isProtected: true } }),
    db.nameStyle.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  ]);
  const servers = on("servers") ? await db.gameServer.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true } }) : null;
  const label = (key: string) => (tAll.has(key as never) ? tAll(key as never) : key);
  const events: GcsBuilderEvent[] = available.map(({ module, def }) => {
    const app = registry.module(module)?.app;
    return {
      key: def.key,
      label: label(def.labelKey),
      icon: def.icon,
      app: module,
      appLabel: app && !app.locked ? label(app.labelKey) : t("v2.coreApp"),
      kind: def.kind,
      scopes: [...(def.scopes ?? [])],
      other: def.otherLabelKey ? label(def.otherLabelKey) : null,
    };
  });
  const v2: GcsBuilderRule[] = allRules
    .filter((r) => r.trigger === "EVENT")
    .map((r) => {
      const kind = events.find((e) => e.key === r.event)?.kind ?? "count";
      return { id: r.id, name: r.name, event: r.event ?? "", enabled: r.enabled, unavailable: !events.some((e) => e.key === r.event), conditions: normalizeConditions(r.conditions, kind), rewards: normalizeRewards(r.rewards) };
    });
  const rules = allRules.filter((r) => r.trigger !== "EVENT");
  const badgeName = (id: number | null) => badges.find((b) => b.id === id)?.name ?? null;

  const fields = (r?: (typeof rules)[number]) => (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("panel.secClassicWhen")}</legend>
        <label className="gcs-field">
          {t("name")}
          <input className="gcs-input" name="name" defaultValue={r?.name ?? ""} required maxLength={80} />
        </label>
        <div className="gcs-formGrid">
          <label className="gcs-field">
            {t("trigger")}
            <select className="gcs-input" name="trigger" defaultValue={r?.trigger ?? "POSTS_COUNT"}>
              {TRIGGERS.map((k) => (
                <option key={k} value={k}>
                  {t(`triggers.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="gcs-field">
            {t("threshold")}
            <input className="gcs-input" name="threshold" type="number" min={0} defaultValue={r?.threshold ?? 1} />
          </label>
        </div>
        <p className="gcs-achHint">{t("panel.thresholdHint")}</p>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("panel.secClassicReward")}</legend>
        <div className="gcs-formGrid">
          <label className="gcs-field">
            {t("points")}
            <input className="gcs-input" name="points" type="number" min={-1000} max={1000} defaultValue={r?.points ?? 0} />
          </label>
          <label className="gcs-field">
            {t("badge")}
            <select className="gcs-input" name="badgeId" defaultValue={r?.badgeId ?? ""}>
              <option value="">{t("noBadge")}</option>
              {badges.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="gcs-achHint">{t("panel.eachNoBadge")}</p>
        <label className="gcs-toggleRow">
          <span>{t("enabled")}</span>
          <input type="checkbox" name="enabled" defaultChecked={r?.enabled ?? true} />
        </label>
      </fieldset>
    </>
  );

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-list-check" description={t("v2.help")}>
        {t("rulesTitle")}
      </GcsAcpTitle>
      <GcsRuleBuilder
        events={events}
        forums={forums}
        servers={servers}
        groups={groups.map(({ id, name }) => ({ id, name }))}
        rewardGroups={groups.filter((g) => !g.isProtected && !g.isVip).map(({ id, name }) => ({ id, name }))}
        badges={badges.map((b) => ({ id: b.id, name: b.name }))}
        nameStyles={nameStyles}
        vipGroups={on("vip") ? groups.filter((g) => g.isVip).map(({ id, name }) => ({ id, name })) : null}
        rules={v2}
      />
      <section className="gcs-card gcs-ruleList" aria-labelledby="gcs-rule-classic-title" data-testid="gcs-classic-rules">
        <div className="gcs-ruleList__head">
          <h2 id="gcs-rule-classic-title" className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-scale-balanced" />
            {t("v2.classicTitle")}
          </h2>
          <div className="gcs-ruleList__tools">
            <GcsAcpEditPanel label={t("panel.classicNew")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("panel.classicNew")} titleIcon={<GcsIconSvg icon={faPlus} />} testId="gcs-classic-rule-new">
              <GcsActionForm action={saveRule.bind(null, null)} submitLabel={t("add")} submitKind="create">
                {fields()}
              </GcsActionForm>
            </GcsAcpEditPanel>
          </div>
        </div>
        <p className="gcs-muted gcs-achHint">{t("rulesHelp")}</p>
        {rules.length === 0 ? (
          <p className="gcs-muted">{t("panel.classicEmpty")}</p>
        ) : (
          <ul className="gcs-ruleList__items gcs-achClassic">
            {rules.map((r) => {
              const badge = badgeName(r.badgeId);
              const each = r.trigger.startsWith("EACH_");
              return (
                <li key={r.id} className={`gcs-achClassic__row${r.enabled ? "" : " is-off"}`} aria-label={r.name} data-testid="gcs-acp-rule" data-rule={r.name}>
                  <GcsRuleToggle key={`${r.id}:${r.enabled}`} id={r.id} name={r.name} enabled={r.enabled} />
                  <span className="gcs-ruleList__text">
                    <strong>{r.name}</strong>
                    <span className="gcs-ruleList__sentence">{t(`triggers.${r.trigger as (typeof TRIGGERS)[number]}`)}</span>
                  </span>
                  <span className="gcs-achClassic__facts">
                    {!each && <span className="gcs-achChip">{t("panel.thresholdChip", { n: r.threshold })}</span>}
                    {r.points !== 0 && <span className="gcs-achChip gcs-achChip--acc">{t("panel.pointsChip", { n: r.points })}</span>}
                    {badge && <span className="gcs-achChip">{badge}</span>}
                  </span>
                  <GcsAcpEditPanel
                    title={r.name}
                    titleIcon={<GcsAcpTitleIcon name="fa-solid fa-scale-balanced" />}
                    testId="gcs-classic-rule-edit"
                    footer={
                      <GcsActionForm action={deleteRule.bind(null, r.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                        {null}
                      </GcsActionForm>
                    }
                  >
                    <GcsActionForm action={saveRule.bind(null, r.id)} submitLabel={t("save")} submitKind="save">
                      {fields(r)}
                    </GcsActionForm>
                  </GcsAcpEditPanel>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
