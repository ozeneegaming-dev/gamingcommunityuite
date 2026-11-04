import { faPlus, faRectangleAd } from "@fortawesome/free-solid-svg-icons";
import { ADS_ACP_SECTION, type GcsAdView } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { deleteAd, resetAdStats, saveAd } from "./actions";
import { GcsAdImageField } from "./GcsAdImageField";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.ads"))("title") };
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * ACP › Sistem › Promovare › Reclame: unitățile (imagine cu link sau HTML curățat), cu starea (activă / programată /
 * oprită), afișările, click-urile și rata lor. „Reclamă nouă” și „Editează” deschid panoul: conținutul, cine nu o vede
 * (ex. VIP), programarea; jos „Șterge”. Plasarea se face cu widget-ul „Reclamă” din „Editează pagina”.
 */
export default async function AcpAdsPage() {
  const panel = await requireAcpSection(ADS_ACP_SECTION);
  const { ads, acp, db } = services();
  const [t, format, units, groups, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.ads"),
    getFormatter(),
    ads.list(panel.actor),
    db.group.findMany({ where: { key: { not: "banned" } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, key: true } }),
    acp.can(panel.actor, ADS_ACP_SECTION, "edit"),
    acp.can(panel.actor, ADS_ACP_SECTION, "delete"),
  ]);
  const vipIds = groups.filter((g) => g.key.startsWith("vip_")).map((g) => g.id);
  const state = (u: GcsAdView) => (u.live ? "live" : !u.enabled ? "off" : u.endsAt && u.endsAt <= new Date() ? "ended" : "scheduled");

  const form = (u?: GcsAdView) => {
    const hidden = new Set(u?.hideGroups ?? vipIds);
    return (
      <GcsActionForm action={saveAd.bind(null, u?.id ?? null)} submitLabel={u ? t("save") : t("create")} submitKind={u ? "save" : "create"}>
        <fieldset className="gcs-formSec">
          <legend>{t("secBasics")}</legend>
          <div className="gcs-formGrid gcs-formGrid--2">
            <label className="gcs-field">
              {t("name")}
              <input className="gcs-input" name="name" required minLength={2} maxLength={80} defaultValue={u?.name ?? ""} />
            </label>
            <label className="gcs-field">
              {t("kind")}
              <select className="gcs-input" name="kind" defaultValue={u?.kind ?? "image"}>
                <option value="image">{t("kinds.image")}</option>
                <option value="html">{t("kinds.html")}</option>
              </select>
            </label>
          </div>
          <label className="gcs-toggleRow">
            <span>{t("enabled")}</span>
            <input type="checkbox" name="enabled" defaultChecked={u?.enabled ?? true} />
          </label>
        </fieldset>
        <fieldset className="gcs-formSec">
          <legend>{t("secImage")}</legend>
          <GcsAdImageField value={u?.imageUrl ?? ""} title={t("image")} preview={u?.name ?? t("image")} />
          <label className="gcs-field">
            {t("link")}
            <input className="gcs-input" name="linkUrl" type="url" defaultValue={u?.linkUrl ?? ""} placeholder="https://" />
          </label>
          <label className="gcs-field">
            {t("alt")}
            <input className="gcs-input" name="alt" maxLength={200} defaultValue={u?.alt ?? ""} />
          </label>
        </fieldset>
        <fieldset className="gcs-formSec">
          <legend>{t("secHtml")}</legend>
          <label className="gcs-field">
            {t("html")}
            <textarea className="gcs-input gcs-codeInput" name="html" rows={5} maxLength={20000} defaultValue={u?.html ?? ""} />
            <span className="gcs-field__hint">{t("htmlHint")}</span>
          </label>
        </fieldset>
        <fieldset className="gcs-formSec">
          <legend>{t("secAudience")}</legend>
          <p className="gcs-field__hint" style={{ margin: 0 }}>
            {t("hideHint")}
          </p>
          <div className="gcs-forumChecks__list">
            {groups.map((g) => (
              <label key={g.id} className="gcs-check">
                <input type="checkbox" name="hideGroup" value={g.id} defaultChecked={hidden.has(g.id)} />
                {g.name}
              </label>
            ))}
          </div>
          <div className="gcs-formGrid gcs-formGrid--2">
            <label className="gcs-field">
              {t("startsAt")}
              <input className="gcs-input" type="date" name="startsAt" defaultValue={ymd(u?.startsAt ?? null)} />
            </label>
            <label className="gcs-field">
              {t("endsAt")}
              <input className="gcs-input" type="date" name="endsAt" defaultValue={ymd(u?.endsAt ?? null)} />
            </label>
          </div>
        </fieldset>
      </GcsActionForm>
    );
  };

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-rectangle-ad"
        description={t("description")}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("add")} titleIcon={<GcsIconSvg icon={faRectangleAd} />} size="lg" testId="gcs-ad-new">
              {form()}
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <p className="gcs-sysHint gcs-sysHint--page">
        <GcsIcon name="fa-solid fa-circle-info" /> {t("placeHint")}
      </p>

      <GcsCard className="gcs-acpPanel">
        {units.length === 0 ? (
          <p className="gcs-acpList__empty gcs-sysEmpty">
            <GcsIcon name="fa-solid fa-rectangle-ad" /> {t("empty")}
          </p>
        ) : (
          <ul className="gcs-sysList" data-testid="gcs-ads-list">
            {units.map((u) => {
              const s = state(u);
              const ctr = u.impressions > 0 ? Math.round((u.clicks / u.impressions) * 1000) / 10 : 0;
              return (
                <li key={u.id} className="gcs-sysList__row" data-testid="gcs-ad-row" data-name={u.name}>
                  <span className="gcs-fileCell__thumb" aria-hidden="true">
                    {u.kind === "image" && u.imageUrl ? <img src={u.imageUrl} alt="" loading="lazy" /> : <GcsIcon name="fa-solid fa-code" />}
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{u.name}</strong>
                    <small>
                      {t(`kinds.${u.kind}`)} · {t("impressions", { count: u.impressions })} · {t("clicks", { count: u.clicks })}
                      {u.impressions > 0 && ` · ${format.number(ctr)}% CTR`}
                    </small>
                  </span>
                  <span className={`gcs-sysChip gcs-sysChip--${s === "live" ? "ok" : s === "scheduled" ? "warn" : "off"}`} data-state={s}>
                    {t(`states.${s}`)}
                  </span>
                  {canEdit && (
                    <GcsAcpEditPanel
                      title={u.name}
                      titleIcon={<GcsIconSvg icon={faRectangleAd} />}
                      size="lg"
                      testId="gcs-ad-edit"
                      footer={
                        <>
                          <GcsActionForm action={resetAdStats.bind(null, u.id)} submitLabel={t("resetStats")} submitKind="reset" variant="ghost" compact confirm={t("resetConfirm")}>
                            {null}
                          </GcsActionForm>
                          {canDelete && (
                            <GcsActionForm action={deleteAd.bind(null, u.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                              {null}
                            </GcsActionForm>
                          )}
                        </>
                      }
                    >
                      {form(u)}
                    </GcsAcpEditPanel>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </GcsCard>
    </>
  );
}
