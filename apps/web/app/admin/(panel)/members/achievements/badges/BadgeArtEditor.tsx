"use client";

import { GcsBadgeArt, GcsIconPicker } from "@gcs/ui";
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
import { useEffect, useState } from "react";

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

export type BadgeArtEditorLabels = {
  preview: string;
  previewDark: string;
  previewLight: string;
  shape: string;
  shapes: Record<GcsBadgeShape, string>;
  tier: string;
  tiers: Record<GcsBadgeTier, string>;
  color: string;
  colorHint: string;
  colorPicker: string;
  icon: string;
  iconSearch: string;
  iconNone: string;
  iconNoResults: string;
  symbol: string;
  symbolHint: string;
  image: string;
  imageHint: string;
  removeImage: string;
};

/** Mostra unui nivel: gradientul metalului (sau culoarea badge-ului). */
function swatch(tier: GcsBadgeTier, color: string): string {
  if (tier === "custom") return `linear-gradient(135deg, #FFFFFF 0%, ${color} 45%, ${color} 70%, #000000 140%)`;
  const m = BADGE_METALS[tier];
  return `linear-gradient(135deg, ${m.hi} 0%, ${m.light} 25%, ${m.base} 55%, ${m.shade} 80%, ${m.band} 100%)`;
}

/**
 * Editorul insignei unui badge (specul 2026-10-07-insigne-grafice, §6.4): forma, nivelul, culoarea, iconița, textul
 * și imaginea proprie, cu previzualizarea live pe o scenă dublă (temă întunecată / deschisă) la 96, 32 și 24 px.
 * Câmpurile fac parte din formularul badge-ului (`artShape`, `artTier`, `artIcon`, `symbol`, `color`, `image`).
 */
export function BadgeArtEditor({ value, labels }: { value: BadgeArtEditorValue | null; labels: BadgeArtEditorLabels }) {
  const initial = resolveBadgeArt(value ?? { name: "?", color: "#F4B740", manual: true });
  const [shape, setShape] = useState<GcsBadgeShape>(initial.shape);
  const [tier, setTier] = useState<GcsBadgeTier>(initial.tier);
  const [color, setColor] = useState(value?.color ?? "#F4B740");
  const [icon, setIcon] = useState<string | null>(value?.artIcon ?? (value?.symbol?.startsWith("fa-") ? value.symbol : null) ?? (value ? null : "fa-solid fa-star"));
  const [symbol, setSymbol] = useState(value?.symbol && !value.symbol.startsWith("fa-") ? value.symbol : "");
  const [upload, setUpload] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  // Adresa temporară a fișierului ales se eliberează când se schimbă sau când editorul dispare.
  useEffect(() => () => {
    if (upload) URL.revokeObjectURL(upload);
  }, [upload]);

  const art = (s: GcsBadgeShape = shape) =>
    badgeArtUrl(resolveBadgeArt({ name: value?.name ?? "?", color: isBadgeColor(color) ? color : "#A1A7B4", symbol, artShape: s, artTier: tier, artIcon: icon }));
  const image = upload ?? (removeImage ? null : value?.image ?? null);
  const preview = { name: value?.name ?? "", art: art(), image };

  return (
    <div className="gcs-badgeEditor" data-testid="gcs-badge-editor">
      <div className="gcs-badgeStage" role="group" aria-label={labels.preview}>
        <div className="gcs-badgeStage__dark" aria-label={labels.previewDark}>
          <GcsBadgeArt badge={preview} size={96} data-testid="gcs-badge-preview" />
          <span className="gcs-badgeStage__small">
            <GcsBadgeArt badge={preview} size={32} decorative />
            <GcsBadgeArt badge={preview} size={24} decorative />
          </span>
        </div>
        <div className="gcs-badgeStage__light" aria-label={labels.previewLight}>
          <GcsBadgeArt badge={preview} size={96} decorative />
          <span className="gcs-badgeStage__small">
            <GcsBadgeArt badge={preview} size={32} decorative />
            <GcsBadgeArt badge={preview} size={24} decorative />
          </span>
        </div>
      </div>

      <div className="gcs-badgeEditor__options">
        <fieldset className="gcs-badgeChoices">
          <legend>{labels.shape}</legend>
          {GCS_BADGE_SHAPES.map((s) => (
            <label key={s} className="gcs-badgeChoice">
              <input type="radio" name="artShape" value={s} checked={shape === s} onChange={() => setShape(s)} />
              <GcsBadgeArt badge={{ name: "", art: art(s) }} size={48} decorative />
              {labels.shapes[s]}
            </label>
          ))}
        </fieldset>

        <fieldset className="gcs-badgeChoices">
          <legend>{labels.tier}</legend>
          {GCS_BADGE_TIERS.map((k) => (
            <label key={k} className="gcs-badgeChoice">
              <input type="radio" name="artTier" value={k} checked={tier === k} onChange={() => setTier(k)} />
              <span className="gcs-badgeSwatch" style={{ background: swatch(k, isBadgeColor(color) ? color : "#A1A7B4") }} aria-hidden="true" />
              {labels.tiers[k]}
            </label>
          ))}
        </fieldset>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="gcs-field" style={{ width: 150 }}>
            {labels.color}
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="gcs-input" name="color" value={color} onChange={(e) => setColor(e.target.value)} required pattern="#[0-9A-Fa-f]{6}" />
              <input
                type="color"
                aria-label={labels.colorPicker}
                value={isBadgeColor(color) ? color.toLowerCase() : "#a1a7b4"}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                style={{ width: 34, height: 34, padding: 0, border: 0, background: "none" }}
              />
            </span>
            <span className="gcs-field__hint">{labels.colorHint}</span>
          </label>
          <label className="gcs-field" style={{ width: 170 }}>
            {labels.symbol}
            <input className="gcs-input" name="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={24} />
            <span className="gcs-field__hint">{labels.symbolHint}</span>
          </label>
        </div>

        <div className="gcs-field">
          <span>{labels.icon}</span>
          <GcsIconPicker name="artIcon" value={icon} searchUrl="/api/icons/badges" onChange={setIcon} labels={{ search: labels.iconSearch, none: labels.iconNone, noResults: labels.iconNoResults }} />
        </div>

        <label className="gcs-field">
          {labels.image}
          <input
            name="image"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setUpload(file ? URL.createObjectURL(file) : null);
            }}
          />
          <span className="gcs-field__hint">{labels.imageHint}</span>
        </label>
        {value?.image && (
          <label className="gcs-check">
            <input type="checkbox" name="removeImage" checked={removeImage} onChange={(e) => setRemoveImage(e.target.checked)} />
            {labels.removeImage}
          </label>
        )}
      </div>
    </div>
  );
}
