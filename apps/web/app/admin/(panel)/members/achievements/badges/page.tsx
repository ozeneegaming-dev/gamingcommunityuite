import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { BADGES_ACP_SECTION } from "@gcs/modules";
import { GcsBadgeArt, GcsIconSvg } from "@gcs/ui";
import { badgeArtSrc } from "@gcs/ui/badge-art";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { deleteBadge, saveBadge } from "../actions";
import { BadgeArtEditor } from "./BadgeArtEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.achievements"))("badgesTitle") };
}

/**
 * ACP → Membri → Realizări → Badge-uri: grila insignelor (insigna, numele, cheia, punctele, manual / automat);
 * „Editează” pe un card și „Badge nou” din titlu deschid panoul badge-ului: datele de bază, aspectul insignei (formă,
 * nivel, culoare, iconiță sau text, cu previzualizare live) și imaginea proprie, cu „Șterge” jos.
 */
export default async function AcpBadgesPage() {
  await requireAcpSection(BADGES_ACP_SECTION);
  const t = await getTranslations("acp.achievements");
  const badges = await services().achievementAdmin.badges();

  const fields = (b?: (typeof badges)[number]) => (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("panel.secBasics")}</legend>
        <div className="gcs-formGrid gcs-formGrid--3">
          <label className="gcs-field">
            {t("key")}
            <input className="gcs-input" name="key" defaultValue={b?.key ?? ""} required pattern="[a-z0-9_]{2,40}" readOnly={Boolean(b)} />
            {!b && <span className="gcs-field__hint">{t("panel.keyHint")}</span>}
          </label>
          <label className="gcs-field">
            {t("name")}
            <input className="gcs-input" name="name" defaultValue={b?.name ?? ""} required maxLength={40} />
          </label>
          <label className="gcs-field">
            {t("points")}
            <input className="gcs-input" name="points" type="number" min={-1000} max={1000} defaultValue={b?.points ?? 0} required />
          </label>
        </div>
        <label className="gcs-field">
          {t("description")}
          <input className="gcs-input" name="description" defaultValue={b?.description ?? ""} maxLength={200} />
        </label>
        <label className="gcs-toggleRow">
          <span>
            {t("manual")}
            <small className="gcs-achHint">{t("panel.manualHint")}</small>
          </span>
          <input type="checkbox" name="manual" defaultChecked={b?.manual ?? true} />
        </label>
      </fieldset>
      <BadgeArtEditor
        value={
          b
            ? {
                name: b.name,
                color: b.color,
                symbol: b.symbol,
                manual: b.manual,
                artShape: b.artShape,
                artTier: b.artTier,
                artIcon: b.artIcon,
                image: b.imageAttachmentId ? `/files/${b.imageAttachmentId}` : null,
              }
            : null
        }
      />
    </>
  );

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-award"
        description={t("badgesHelp")}
        actions={
          <GcsAcpEditPanel label={t("addBadge")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("addBadge")} titleIcon={<GcsIconSvg icon={faPlus} />} size="lg" testId="gcs-badge-new">
            <GcsActionForm action={saveBadge.bind(null, null)} submitLabel={t("add")} submitKind="create">
              {fields()}
            </GcsActionForm>
          </GcsAcpEditPanel>
        }
      >
        {t("badgesTitle")}
      </GcsAcpTitle>
      {badges.length === 0 ? (
        <p className="gcs-card gcs-achEmpty">{t("panel.noBadges")}</p>
      ) : (
        <ul className="gcs-achBadgeGrid" aria-label={t("badgesTitle")} data-testid="gcs-badge-grid">
          {badges.map((b) => {
            const badge = { name: b.name, art: badgeArtSrc(b), image: b.imageAttachmentId ? `/files/${b.imageAttachmentId}` : null };
            return (
              <li key={b.id} className="gcs-card gcs-achBadge" aria-label={b.name} data-testid="gcs-acp-badge" data-badge={b.key}>
                <GcsBadgeArt badge={badge} size={64} decorative />
                <span className="gcs-achBadge__body">
                  <strong className="gcs-achBadge__name">{b.name}</strong>
                  <code className="gcs-achBadge__key">{b.key}</code>
                </span>
                <span className="gcs-achBadge__chips">
                  <span className="gcs-achChip">{t("panel.pointsChip", { n: b.points })}</span>
                  <span className={`gcs-achChip${b.manual ? "" : " gcs-achChip--acc"}`}>{b.manual ? t("panel.manualChip") : t("panel.autoChip")}</span>
                </span>
                <GcsAcpEditPanel
                  title={b.name}
                  titleIcon={<GcsBadgeArt badge={badge} size={24} decorative />}
                  size="lg"
                  testId="gcs-badge-edit"
                  footer={
                    <GcsActionForm action={deleteBadge.bind(null, b.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                      {null}
                    </GcsActionForm>
                  }
                >
                  <GcsActionForm action={saveBadge.bind(null, b.id)} submitLabel={t("save")} submitKind="save">
                    {fields(b)}
                  </GcsActionForm>
                </GcsAcpEditPanel>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
