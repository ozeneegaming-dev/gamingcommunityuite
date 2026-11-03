import { faSliders, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { REFERRAL_ACP_SECTION } from "@gcs/modules";
import { GcsButton, GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { deleteReferral, saveReferralConfig } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.referral"))("title") };
}

type Props = { searchParams: Promise<{ page?: string }> };

/**
 * ACP › Membri › Setări membri › Recomandări: totalurile, cei care au adus cei mai mulți membri și lista recomandărilor
 * (panoul fiecăreia: cine pe cine, starea, punctele, ștergerea). Panoul „Setări”: programul pornit, condițiile
 * calificării (postări, email confirmat), punctele și limita pe membru. Badge-urile pentru invitații se dau din
 * Realizări › Reguli (evenimentul „Recomandări”).
 */
export default async function AcpReferralPage({ searchParams }: Props) {
  const panel = await requireAcpSection(REFERRAL_ACP_SECTION);
  const sp = await searchParams;
  const { referrals, acp } = services();
  const [t, format, cfg, data, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.referral"),
    getFormatter(),
    referrals.config(),
    referrals.overview(panel.actor, Number(sp.page) || 1),
    acp.can(panel.actor, REFERRAL_ACP_SECTION, "edit"),
    acp.can(panel.actor, REFERRAL_ACP_SECTION, "delete"),
  ]);
  const tiles = [
    { key: "total", icon: "fa-solid fa-user-plus", value: data.total, label: t("tiles.total") },
    { key: "qualified", icon: "fa-solid fa-circle-check", value: data.qualified, label: t("tiles.qualified") },
    { key: "last30", icon: "fa-solid fa-calendar-days", value: data.last30, label: t("tiles.last30") },
  ];

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-user-plus"
        description={t("description")}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("settings")} variant="primary" buttonIcon={<GcsIconSvg icon={faSliders} />} title={t("settings")} titleIcon={<GcsIconSvg icon={faSliders} />} testId="gcs-referral-settings">
              <GcsActionForm action={saveReferralConfig} submitLabel={t("save")} submitKind="save">
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secProgram")}</legend>
                  <label className="gcs-toggleRow">
                    <span>
                      {t("cfg.enabled")}
                      <small className="gcs-achHint">{t("cfg.enabledHint")}</small>
                    </span>
                    <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} />
                  </label>
                </fieldset>
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secQualify")}</legend>
                  <label className="gcs-field">
                    {t("cfg.qualifyPosts")}
                    <input className="gcs-input" name="qualifyPosts" type="number" min={0} max={1000} defaultValue={cfg.qualifyPosts} required />
                    <span className="gcs-field__hint">{t("cfg.qualifyPostsHint")}</span>
                  </label>
                  <label className="gcs-toggleRow">
                    <span>{t("cfg.requireVerified")}</span>
                    <input type="checkbox" name="requireVerified" defaultChecked={cfg.requireVerified} />
                  </label>
                </fieldset>
                <fieldset className="gcs-formSec">
                  <legend>{t("cfg.secReward")}</legend>
                  <label className="gcs-field">
                    {t("cfg.rewardPoints")}
                    <input className="gcs-input" name="rewardPoints" type="number" min={0} max={10000} defaultValue={cfg.rewardPoints} required />
                  </label>
                  <label className="gcs-field">
                    {t("cfg.maxPerMember")}
                    <input className="gcs-input" name="maxPerMember" type="number" min={0} max={100000} defaultValue={cfg.maxPerMember} required />
                    <span className="gcs-field__hint">{t("cfg.maxHint")}</span>
                  </label>
                  <p className="gcs-field__hint" style={{ margin: 0 }}>
                    {t("cfg.badgesHint")} <Link href="/admin/members/achievements/rules">{t("cfg.badgesLink")}</Link>
                  </p>
                </fieldset>
              </GcsActionForm>
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <div className={`gcs-sysSummary gcs-sysSummary--${cfg.enabled ? "ok" : "down"}`} data-testid="gcs-referral-summary">
        <GcsIcon name={cfg.enabled ? "fa-solid fa-circle-check" : "fa-solid fa-circle-minus"} />
        <span>
          <strong>{cfg.enabled ? t("stateOn") : t("stateOff")}</strong>
          <small>
            {[cfg.qualifyPosts > 0 ? t("chipPosts", { count: cfg.qualifyPosts }) : t("chipJoin"), cfg.requireVerified ? t("chipVerified") : null, cfg.rewardPoints > 0 ? t("chipPoints", { points: cfg.rewardPoints }) : null]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </span>
      </div>

      <ul className="gcs-acpTiles gcs-sysTiles" data-testid="gcs-referral-tiles">
        {tiles.map((tile) => (
          <li key={tile.key} className="gcs-acpTile" data-tile={tile.key}>
            <div className="gcs-acpTile__inner">
              <span className="gcs-acpTile__icon" aria-hidden="true">
                <GcsIcon name={tile.icon} />
              </span>
              <span className="gcs-acpTile__value gcs-display">{format.number(tile.value)}</span>
              <span className="gcs-acpTile__label">{tile.label}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="gcs-sysGrid">
        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-referral-top">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-referral-top" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-ranking-star" /> {t("top")}
            </h2>
          </div>
          {data.top.length === 0 ? (
            <p className="gcs-acpList__empty gcs-sysEmpty">{t("empty")}</p>
          ) : (
            <ol className="gcs-sysList" data-testid="gcs-referral-top">
              {data.top.map((r, i) => (
                <li key={r.user?.id ?? i} className="gcs-sysList__row">
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{r.user ? <GcsMemberLink user={r.user} href={`/admin/members/${r.user.id}`} /> : t("deleted")}</strong>
                    <small>{t("topLine", { count: r.count, qualified: r.qualified })}</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </GcsCard>

        <GcsCard as="section" className="gcs-acpPanel" aria-labelledby="gcs-referral-list">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-referral-list" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-list" /> {t("list")}
            </h2>
            <span className="gcs-sysMuted">{t("total", { count: data.list.total })}</span>
          </div>
          {data.list.items.length === 0 ? (
            <p className="gcs-acpList__empty gcs-sysEmpty">{t("empty")}</p>
          ) : (
            <ul className="gcs-sysList" data-testid="gcs-referral-rows">
              {data.list.items.map((r) => (
                <li key={r.id} className="gcs-sysList__row" data-testid="gcs-referral-row" data-referred={r.referred?.name ?? ""}>
                  <span className="gcs-sysList__body">
                    <strong>
                      {r.referrer ? <GcsMemberLink user={r.referrer} href={`/admin/members/${r.referrer.id}`} /> : t("deleted")} <GcsIcon name="fa-solid fa-arrow-right" />{" "}
                      {r.referred ? <GcsMemberLink user={r.referred} href={`/admin/members/${r.referred.id}`} /> : t("deleted")}
                    </strong>
                    <small>
                      {format.relativeTime(r.createdAt)} · {t("posts", { count: r.referredPosts })}
                      {r.rewardedPoints > 0 && ` · ${t("chipPoints", { points: r.rewardedPoints })}`}
                    </small>
                  </span>
                  <span className={`gcs-sysChip gcs-sysChip--${r.qualifiedAt ? "ok" : "off"}`}>{r.qualifiedAt ? t("statusQualified") : t("statusPending")}</span>
                  {canDelete && (
                    <GcsAcpEditPanel label={t("open")} iconOnly buttonIcon={<GcsIcon name="fa-solid fa-ellipsis" />} title={t("detail")} titleIcon={<GcsIconSvg icon={faUserPlus} />} testId="gcs-referral-panel"
                      footer={
                        <GcsActionForm action={deleteReferral.bind(null, r.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                          {null}
                        </GcsActionForm>
                      }
                    >
                      <dl className="gcs-sysFacts">
                        <div>
                          <dt>{t("referrer")}</dt>
                          <dd>{r.referrer ? <GcsMemberLink user={r.referrer} href={`/admin/members/${r.referrer.id}`} /> : t("deleted")}</dd>
                        </div>
                        <div>
                          <dt>{t("referred")}</dt>
                          <dd>{r.referred ? <GcsMemberLink user={r.referred} href={`/admin/members/${r.referred.id}`} /> : t("deleted")}</dd>
                        </div>
                        <div>
                          <dt>{t("joined")}</dt>
                          <dd>{format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}</dd>
                        </div>
                        <div>
                          <dt>{t("state")}</dt>
                          <dd>{r.qualifiedAt ? t("qualifiedAt", { date: format.dateTime(r.qualifiedAt, { dateStyle: "medium" }) }) : t("statusPending")}</dd>
                        </div>
                      </dl>
                    </GcsAcpEditPanel>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.list.pages > 1 && (
            <nav className="gcs-memberList__pages" aria-label={t("pages")}>
              {data.list.page > 1 && (
                <GcsButton variant="ghost" size="sm" asChild>
                  <Link href={`/admin/members/settings/referral?page=${data.list.page - 1}`}>{t("prev")}</Link>
                </GcsButton>
              )}
              <span className="gcs-memberList__page">{t("page", { page: data.list.page, pages: data.list.pages })}</span>
              {data.list.page < data.list.pages && (
                <GcsButton variant="ghost" size="sm" asChild>
                  <Link href={`/admin/members/settings/referral?page=${data.list.page + 1}`}>{t("next")}</Link>
                </GcsButton>
              )}
            </nav>
          )}
        </GcsCard>
      </div>
    </>
  );
}
