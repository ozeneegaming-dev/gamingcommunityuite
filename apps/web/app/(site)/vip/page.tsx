import { VIP_INTRO_SETTING, type GcsVipBenefit } from "@gcs/modules";
import { GcsBadge, GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { currentActor } from "@/lib/actor";
import { forumHref } from "@/lib/forum-urls";
import { pluginHookHtml } from "@/lib/plugins";
import { services } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("vipPage"))("title") };
}

const DAY = 86_400_000;

/**
 * `/vip`: planurile VIP (grupurile VIP din ACP) cu ce primești, numele tău randat cu stilul planului și butonul de
 * contact (sau de plată, când există magazinul). Viewer-ul VIP își vede sus planul și expirarea.
 */
export default async function VipPage() {
  const { apps, vipPublic, settings, profileQueries } = services();
  if (!(await apps.enabled("vip"))) notFound();
  const [t, tAll, format, actor] = await Promise.all([getTranslations("vipPage"), getTranslations(), getFormatter(), currentActor()]);
  const [plans, mine, intro, me] = await Promise.all([
    vipPublic.plans(actor),
    vipPublic.mine(actor),
    settings.get<string>(VIP_INTRO_SETTING),
    actor.userId ? profileQueries.userDisplays([actor.userId]).then((m) => m.get(actor.userId!) ?? null) : Promise.resolve(null),
  ]);
  const sample = me?.name ?? t("sampleName");
  // Punctul de extensie `vip.page` (ex. Studio VIP: personalizarea profilului), sub planuri.
  const pluginBlocks = await pluginHookHtml("vip.page", { plans: plans.length });
  const benefit = (b: GcsVipBenefit) => {
    const label = tAll.has(b.labelKey) ? tAll(b.labelKey) : b.key;
    if (b.value === true) return label;
    return t("limit", { label, value: b.value === -1 ? t("unlimited") : format.number(b.value) });
  };
  const expiry = (iso: string | null) => {
    if (!iso) return t("mine.permanent");
    const at = new Date(iso);
    return t("mine.expires", { date: format.dateTime(at, { dateStyle: "long" }), days: Math.max(0, Math.ceil((at.getTime() - Date.now()) / DAY)) });
  };
  const planStyle = (color: string | null) => (color ? ({ "--gcs-plan": color } as CSSProperties) : undefined);

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-crown" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc" style={{ whiteSpace: "pre-line" }}>
            {intro.trim() || t("lead")}
          </p>
        </div>
      </header>

      {mine && (
        <GcsCard as="section" className="gcs-vipMine" style={planStyle(plans.find((p) => p.groupId === mine.groupId)?.color ?? null)} aria-label={t("mine.label")} data-testid="gcs-vip-mine">
          <GcsIcon name="fa-solid fa-gem" className="gcs-hIcon" />
          <span>
            {t("mine.label")}: <span className={`gcs-vipMine__plan gcs-name--${mine.key}`}>{mine.name}</span>
          </span>
          <span className="gcs-muted">{expiry(mine.expiresAt)}</span>
        </GcsCard>
      )}

      {plans.length === 0 ? (
        <GcsCard>
          <p className="gcs-emptyState" data-testid="gcs-vip-empty">
            <GcsIcon name="fa-regular fa-gem" className="gcs-emptyIcon" />
            {t("empty")}
          </p>
        </GcsCard>
      ) : (
        <div className="gcs-vipPlans">
          {plans.map((plan) => {
            const isMine = mine?.groupId === plan.groupId;
            return (
              <GcsCard
                as="article"
                key={plan.groupId}
                className={`gcs-vipPlan${isMine ? " gcs-vipPlan--mine" : ""}`}
                style={planStyle(plan.color)}
                aria-labelledby={`gcs-vip-plan-${plan.groupId}`}
                data-testid="gcs-vip-plan"
                data-plan={plan.key}
              >
                <header className="gcs-vipPlan__head">
                  <span className="gcs-vipPlan__icon" aria-hidden="true">
                    <GcsIcon name={plan.icon ?? "fa-solid fa-gem"} />
                  </span>
                  <h2 id={`gcs-vip-plan-${plan.groupId}`} className="gcs-display gcs-vipPlan__title">
                    {plan.name}
                  </h2>
                  {isMine && <GcsBadge tone="vip">{t("yourPlan")}</GcsBadge>}
                </header>
                <p className="gcs-vipPlan__preview">
                  {t("preview")}
                  <span className={`gcs-vipPlan__sample gcs-name--${plan.key}`}>{sample}</span>
                </p>
                <ul className="gcs-vipPlan__benefits" aria-label={t("benefits")}>
                  {plan.benefits.map((b) => (
                    <li key={b.key}>
                      <GcsIcon name="fa-solid fa-check" className="gcs-vipPlan__check" />
                      <span>{benefit(b)}</span>
                    </li>
                  ))}
                  {plan.forums.length > 0 && (
                    <li>
                      <GcsIcon name="fa-solid fa-check" className="gcs-vipPlan__check" />
                      <span>
                        {t("forums")}{" "}
                        {plan.forums.map((f, i) => (
                          <span key={f.id}>
                            {i > 0 && ", "}
                            <Link href={forumHref(f)}>{f.name}</Link>
                          </span>
                        ))}
                      </span>
                    </li>
                  )}
                  {plan.nameStyles > 0 && (
                    <li>
                      <GcsIcon name="fa-solid fa-check" className="gcs-vipPlan__check" />
                      <span>{t("nameStyles", { count: plan.nameStyles })}</span>
                    </li>
                  )}
                  {plan.frames > 0 && (
                    <li>
                      <GcsIcon name="fa-solid fa-check" className="gcs-vipPlan__check" />
                      <span>{t("frames", { count: plan.frames })}</span>
                    </li>
                  )}
                </ul>
                <p className="gcs-vipPlan__terms">{plan.action.kind === "checkout" ? t("termsCheckout") : t("terms")}</p>
                <GcsButton
                  variant={isMine ? "ghost" : "primary"}
                  asChild
                  icon={<GcsIcon name={plan.action.kind === "checkout" ? "fa-solid fa-cart-shopping" : "fa-solid fa-envelope"} />}
                >
                  <Link href={plan.action.href} data-testid="gcs-vip-action">
                    {plan.action.kind === "checkout" ? t("buy") : t("contact")}
                  </Link>
                </GcsButton>
              </GcsCard>
            );
          })}
        </div>
      )}
      {pluginBlocks.length > 0 && (
        <div className="gcs-pluginHook gcs-vipPluginBlocks" data-hook="vip.page">
          {pluginBlocks.map((html, i) => (
            // HTML-ul pluginului, trecut prin sanitizer (listă albă) de gazda pluginurilor.
            <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </div>
      )}
    </>
  );
}
