"use client";

import { GcsBadgeArt } from "@gcs/ui";
import {
  BADGE_METALS,
  badgeArtUrl,
  GCS_BADGE_SHAPES,
  GCS_BADGE_TIERS,
  isBadgeColor,
  resolveBadgeArt,
  type GcsBadgeShape,
  type GcsBadgeTier,
} from "@gcs/ui/badge-art";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { GcsIconInput, GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";

export type BadgeArtEditorValue = {
  name: string;
  color: string;
  symbol: string | null;
  manual: boolean;
  artShape: string | null;
  artTier: string | null;
  artIcon: string | null;
  /** Imaginea proprie existentă (`/files/…`). */
  image: string | null;
};

/** Mostra unui nivel: gradientul metalului (sau culoarea badge-ului). */
function swatch(tier: GcsBadgeTier, color: string): string {
  if (tier === "custom") return `linear-gradient(135deg, #FFFFFF 0%, ${color} 45%, ${color} 70%, #000000 140%)`;
  const m = BADGE_METALS[tier];
  return `linear-gradient(135deg, ${m.hi} 0%, ${m.light} 25%, ${m.base} 55%, ${m.shade} 80%, ${m.band} 100%)`;
}

/**
 * Editorul insignei unui badge (specul 2026-10-07-insigne-grafice, §6.4), în panoul badge-ului, pe două secțiuni:
 * „Aspect” (forma, nivelul, culoarea, textul și iconița din selectorul sistemului, cu previzualizarea live pe o scenă
 * dublă întunecat / deschis la 96, 32 și 24 px) și „Imagine proprie” (popupul de încărcare al sistemului). Câmpurile
 * fac parte din formularul badge-ului (`artShape`, `artTier`, `artIcon`, `symbol`, `color`, `image`, `removeImage`).
 */
export function BadgeArtEditor({ value }: { value: BadgeArtEditorValue | null }) {
  const t = useTranslations("acp.achievements");
  const initial = resolveBadgeArt(value ?? { name: "?", color: "#F4B740", manual: true });
  const [shape, setShape] = useState<GcsBadgeShape>(initial.shape);
  const [tier, setTier] = useState<GcsBadgeTier>(initial.tier);
  const [color, setColor] = useState(value?.color ?? "#F4B740");
  const [icon, setIcon] = useState<string | null>(value?.artIcon ?? (value?.symbol?.startsWith("fa-") ? value.symbol : null) ?? (value ? null : "fa-solid fa-star"));
  const [symbol, setSymbol] = useState(value?.symbol && !value.symbol.startsWith("fa-") ? value.symbol : "");
  const [upload, setUpload] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  // Adresa temporară a fișierului ales se eliberează când se schimbă sau când editorul dispare.
  useEffect(
    () => () => {
      if (upload) URL.revokeObjectURL(upload);
    },
    [upload],
  );

  const safeColor = isBadgeColor(color) ? color : "#A1A7B4";
  const art = (s: GcsBadgeShape = shape) => badgeArtUrl(resolveBadgeArt({ name: value?.name ?? "?", color: safeColor, symbol, artShape: s, artTier: tier, artIcon: icon }));
  const existing = removeImage ? null : (value?.image ?? null);
  const preview = { name: value?.name ?? "", art: art(), image: upload ?? existing };

  return (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("panel.secLook")}</legend>
        <div className="gcs-badgeEditor" data-testid="gcs-badge-editor">
          <div className="gcs-badgeStage" role="group" aria-label={t("art.preview")}>
            <div className="gcs-badgeStage__dark" aria-label={t("art.previewDark")}>
              <GcsBadgeArt badge={preview} size={96} data-testid="gcs-badge-preview" />
              <span className="gcs-badgeStage__small">
                <GcsBadgeArt badge={preview} size={32} decorative />
                <GcsBadgeArt badge={preview} size={24} decorative />
              </span>
            </div>
            <div className="gcs-badgeStage__light" aria-label={t("art.previewLight")}>
              <GcsBadgeArt badge={preview} size={96} decorative />
              <span className="gcs-badgeStage__small">
                <GcsBadgeArt badge={preview} size={32} decorative />
                <GcsBadgeArt badge={preview} size={24} decorative />
              </span>
            </div>
          </div>

          <div className="gcs-badgeEditor__options">
            <fieldset className="gcs-badgeChoices">
              <legend>{t("art.shape")}</legend>
              {GCS_BADGE_SHAPES.map((s) => (
                <label key={s} className="gcs-badgeChoice">
                  <input type="radio" name="artShape" value={s} checked={shape === s} onChange={() => setShape(s)} />
                  <GcsBadgeArt badge={{ name: "", art: art(s) }} size={48} decorative />
                  {t(`art.shapes.${s}`)}
                </label>
              ))}
            </fieldset>

            <fieldset className="gcs-badgeChoices">
              <legend>{t("art.tier")}</legend>
              {GCS_BADGE_TIERS.map((k) => (
                <label key={k} className="gcs-badgeChoice">
                  <input type="radio" name="artTier" value={k} checked={tier === k} onChange={() => setTier(k)} />
                  <span className="gcs-badgeSwatch" style={{ background: swatch(k, safeColor) }} aria-hidden="true" />
                  {t(`art.tiers.${k}`)}
                </label>
              ))}
            </fieldset>
          </div>
        </div>

        <div className="gcs-formGrid">
          <div className="gcs-field">
            <span>{t("art.icon")}</span>
            <GcsIconInput name="artIcon" value={icon} onChange={setIcon} testId="gcs-badge-icon" />
          </div>
          <label className="gcs-field">
            {t("symbol")}
            <input className="gcs-input" name="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={24} />
            <span className="gcs-field__hint">{t("art.symbolHint")}</span>
          </label>
          <label className="gcs-field">
            {t("color")}
            <span className="gcs-achColor">
              <input className="gcs-input" name="color" value={color} onChange={(e) => setColor(e.target.value)} required pattern="#[0-9A-Fa-f]{6}" maxLength={7} />
              <input type="color" aria-label={t("art.colorPicker")} value={safeColor.toLowerCase()} onChange={(e) => setColor(e.target.value.toUpperCase())} />
            </span>
            <span className="gcs-field__hint">{t("art.colorHint")}</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="gcs-formSec">
        <legend>{t("panel.secImage")}</legend>
        <GcsUploadInput
          name="image"
          title={t("panel.badgeUploadTitle")}
          rules={UPLOAD_RULES.image(1)}
          current={existing ? { url: existing } : null}
          onFile={(file) => setUpload(file ? URL.createObjectURL(file) : null)}
          onRemove={() => {
            // „Scoate” pe un fișier abia ales îl renunță doar pe el; pe imaginea salvată o scoate la salvare.
            if (!upload) setRemoveImage(true);
          }}
          testId="gcs-badge-image"
        />
        <p className="gcs-achHint">{t("panel.badgeImageHint")}</p>
        {removeImage && <input type="hidden" name="removeImage" value="on" />}
      </fieldset>
    </>
  );
}
