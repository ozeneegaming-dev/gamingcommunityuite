import { BADGES_ACP_SECTION } from "@gcs/modules";
import { GcsBadgeArt, GcsCard } from "@gcs/ui";
import { badgeArtSrc, GCS_BADGE_SHAPES, GCS_BADGE_TIERS } from "@gcs/ui/badge-art";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { deleteBadge, saveBadge } from "../actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../_components/GcsAcpTitle";
import { BadgeArtEditor, type BadgeArtEditorLabels } from "./BadgeArtEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.achievements"))("badgesTitle") };
}

/**
 * ACP → Membri → Realizări → Badge-uri: insigna (formă, nivel, culoare, iconiță sau text, imagine proprie, cu
 * previzualizare live), manual/automat și punctele primite odată cu badge-ul.
 */
export default async function AcpBadgesPage() {
  await requireAcpSection(BADGES_ACP_SECTION);
  const t = await getTranslations("acp.achievements");
  const badges = await services().achievementAdmin.badges();

  const artLabels: BadgeArtEditorLabels = {
    preview: t("art.preview"),
    previewDark: t("art.previewDark"),
    previewLight: t("art.previewLight"),
    shape: t("art.shape"),
    shapes: Object.fromEntries(GCS_BADGE_SHAPES.map((k) => [k, t(`art.shapes.${k}`)])) as BadgeArtEditorLabels["shapes"],
    tier: t("art.tier"),
    tiers: Object.fromEntries(GCS_BADGE_TIERS.map((k) => [k, t(`art.tiers.${k}`)])) as BadgeArtEditorLabels["tiers"],
    color: t("color"),
    colorHint: t("art.colorHint"),
    colorPicker: t("art.colorPicker"),
    icon: t("art.icon"),
    iconSearch: t("art.iconSearch"),
    iconNone: t("art.iconNone"),
    iconNoResults: t("art.iconNoResults"),
    symbol: t("symbol"),
    symbolHint: t("art.symbolHint"),
    image: t("art.image"),
    imageHint: t("art.imageHint"),
    removeImage: t("art.removeImage"),
  };

  const fields = (b?: (typeof badges)[number]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="gcs-field" style={{ width: 140 }}>
          {t("key")}
          <input className="gcs-input" name="key" defaultValue={b?.key ?? ""} required pattern="[a-z0-9_]{2,40}" readOnly={Boolean(b)} />
        </label>
        <label className="gcs-field" style={{ width: 180 }}>
          {t("name")}
          <input className="gcs-input" name="name" defaultValue={b?.name ?? ""} required maxLength={40} />
        </label>
        <label className="gcs-field" style={{ width: 90 }}>
          {t("points")}
          <input className="gcs-input" name="points" type="number" min={-1000} max={1000} defaultValue={b?.points ?? 0} required />
        </label>
        <label className="gcs-field" style={{ flex: "1 1 220px" }}>
          {t("description")}
          <input className="gcs-input" name="description" defaultValue={b?.description ?? ""} maxLength={200} />
        </label>
        <label className="gcs-check">
          <input type="checkbox" name="manual" defaultChecked={b?.manual ?? true} />
          {t("manual")}
        </label>
      </div>
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
        labels={artLabels}
      />
    </div>
  );

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-award">
        {t("badgesTitle")}
      </GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("badgesHelp")}
      </p>
      {badges.map((b) => (
        <GcsCard key={b.id} as="section" aria-label={b.name} style={{ padding: 16, display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }} data-testid="gcs-acp-badge">
          <GcsBadgeArt badge={{ name: b.name, art: badgeArtSrc(b), image: b.imageAttachmentId ? `/files/${b.imageAttachmentId}` : null }} size={64} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <GcsActionForm action={saveBadge.bind(null, b.id)} submitLabel={t("save")} submitKind="save">
              {fields(b)}
            </GcsActionForm>
            <GcsActionForm action={deleteBadge.bind(null, b.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
              {null}
            </GcsActionForm>
          </div>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-badge-new" style={{ padding: 16 }}>
        <h2 id="gcs-badge-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          <GcsAcpTitleIcon name="fa-solid fa-plus" />
          {t("addBadge")}
        </h2>
        <GcsActionForm action={saveBadge.bind(null, null)} submitLabel={t("add")} submitKind="create">
          {fields()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
