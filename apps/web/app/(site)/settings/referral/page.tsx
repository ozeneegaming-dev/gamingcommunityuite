import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { SETTINGS_ICONS } from "../../_components/settings/sections";
import { GcsReferralLink } from "./GcsReferralLink";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.referral") };
}

/**
 * Setări → Invită prieteni (Recomandări): linkul personal, ce trebuie să facă cei aduși ca invitația să conteze și
 * punctele primite, apoi cei aduși până acum (calificați sau încă nu).
 */
export default async function ReferralSettingsPage() {
  const actor = await currentActor();
  const { referrals } = services();
  const [t, format, cfg, mine] = await Promise.all([getTranslations("settings.referral"), getFormatter(), referrals.config(), referrals.mine(actor.userId!)]);
  return (
    <div className="gcs-referral" data-testid="gcs-referral">
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.referral} className="gcs-hIcon" />
        {t("title")}
      </h2>
      {!cfg.enabled ? (
        <p className="gcs-muted" data-testid="gcs-referral-off">
          {t("off")}
        </p>
      ) : (
        <>
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("hint")}
          </p>
          <GcsReferralLink path={`/r/${actor.userId}`} />
          <ul className="gcs-referral__rules">
            <li>
              <GcsIcon name="fa-solid fa-pen" /> {cfg.qualifyPosts > 0 ? t("rulePosts", { count: cfg.qualifyPosts }) : t("ruleJoin")}
            </li>
            {cfg.requireVerified && (
              <li>
                <GcsIcon name="fa-solid fa-envelope-circle-check" /> {t("ruleVerified")}
              </li>
            )}
            {cfg.rewardPoints > 0 && (
              <li>
                <GcsIcon name="fa-solid fa-star" /> {t("rulePoints", { points: cfg.rewardPoints })}
              </li>
            )}
          </ul>
        </>
      )}
      <div className="gcs-referral__stats" data-testid="gcs-referral-stats">
        <span>
          <strong className="gcs-display">{format.number(mine.total)}</strong> {t("invited")}
        </span>
        <span>
          <strong className="gcs-display">{format.number(mine.qualified)}</strong> {t("qualified")}
        </span>
      </div>
      {mine.recent.length > 0 && (
        <ul className="gcs-sysList gcs-card" data-testid="gcs-referral-list">
          {mine.recent.map((r) => (
            <li key={r.id} className="gcs-sysList__row">
              <span className="gcs-sysList__body">
                <strong>{r.referred ? <GcsMemberLink user={r.referred} /> : t("deleted")}</strong>
                <small>{format.relativeTime(r.createdAt)}</small>
              </span>
              <span className={`gcs-sysChip gcs-sysChip--${r.qualifiedAt ? "ok" : "off"}`}>{r.qualifiedAt ? t("statusQualified") : t("statusPending")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
