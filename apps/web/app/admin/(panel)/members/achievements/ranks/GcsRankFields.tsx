"use client";

import { faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { GcsBadgeArt, GcsButton, GcsIconSvg } from "@gcs/ui";
import { badgeArtSrc, GCS_BADGE_SHAPES, isBadgeColor } from "@gcs/ui/badge-art";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { GcsIconInput, GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";

type Opt = { id: number; name: string };

/** Desenul implicit al unei trepte (din `rankEmblemArt`, calculat pe server): metalul, forma și culoarea. */
export type GcsRankTierArt = { tier: string; shape: string; color: string };

export type GcsRankFieldsValue = {
  name: string;
  icon: string | null;
  minPosts: number | null;
  minPoints: number | null;
  minReputation: number | null;
  match: string;
  criteria: { metric: string; min: number }[];
  emblemTier: string | null;
  emblemShape: string | null;
  emblemIcon: string | null;
  color: string | null;
  animated: boolean;
  /** Emblema proprie de acum (`/files/…`). */
  image: string | null;
  perkGroupId: number | null;
  perkBadgeId: number | null;
  perkNameStyleId: number | null;
};

export type GcsRankFieldsProps = {
  rank: GcsRankFieldsValue | null;
  /** Treapta din poziția rangului pe scară, folosită când treapta e „automat”. */
  autoTier: string;
  tiers: readonly string[];
  tierArt: Record<string, GcsRankTierArt>;
  metrics: { key: string; label: string; off: boolean }[];
  groups: Opt[];
  badges: Opt[];
  styles: Opt[];
};

/** Limita criteriilor unui rang (aceeași ca în `normalizeCriteria`). */
const MAX_CRITERIA = 10;
const FALLBACK_ICON = "fa-solid fa-chevron-up";

let rowSeq = 0;
const row = (metric = "", min = "") => ({ key: ++rowSeq, metric, min });

/**
 * Formularul unui rang din panoul de editare (Realizări v2), pe secțiuni: Praguri (postări, puncte, reputație,
 * „toate / oricare”, criteriile aplicațiilor adăugate pe rânduri), Emblema (forma, treapta, iconița, culoarea, animația,
 * emblema proprie, cu previzualizare live) și Avantaje. Câmpurile au numele citite de `saveRankV2`.
 */
export function GcsRankFields({ rank, autoTier, tiers, tierArt, metrics, groups, badges, styles }: GcsRankFieldsProps) {
  const t = useTranslations("acp.achievements");
  const ids = useId();
  const [name, setName] = useState(rank?.name ?? "");
  const [match, setMatch] = useState(rank?.match === "any" ? "any" : "all");
  const [criteria, setCriteria] = useState(() => (rank?.criteria ?? []).map((c) => row(c.metric, String(c.min))));
  const [tier, setTier] = useState(rank?.emblemTier ?? "");
  const [shape, setShape] = useState(rank?.emblemShape ?? "");
  const [icon, setIcon] = useState<string | null>(rank?.emblemIcon ?? null);
  const [color, setColor] = useState(rank?.color ?? "");
  const [animated, setAnimated] = useState(rank?.animated ?? false);
  const [upload, setUpload] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  // Adresa temporară a fișierului ales se eliberează când se schimbă sau când panoul se închide.
  useEffect(() => () => void (upload && URL.revokeObjectURL(upload)), [upload]);

  // Previzualizarea: aceeași rezolvare ca `rankEmblemArt` (treapta dă metalul, forma și culoarea implicite).
  const base = tierArt[tier || autoTier] ?? tierArt[tiers[0] ?? ""] ?? { tier: "custom", shape: "shield", color: "#A1A7B4" };
  const textIcon = rank?.icon?.startsWith("fa-") ? rank.icon : null;
  const art = badgeArtSrc({
    name: name.trim() || "?",
    color: isBadgeColor(color) ? color : base.color,
    artShape: shape || base.shape,
    artTier: base.tier,
    artIcon: icon ?? textIcon ?? FALLBACK_ICON,
    symbol: null,
    manual: false,
  });
  const existing = removeImage ? null : (rank?.image ?? null);
  const preview = { name: name.trim() || t("addRank"), art, image: upload ?? existing };
  const used = new Set(criteria.map((c) => c.metric).filter(Boolean));

  const select = (field: string, value: number | null, list: Opt[], label: string) => (
    <label className="gcs-field">
      {label}
      <select className="gcs-input" name={field} defaultValue={value ?? ""}>
        <option value="">{t("v2.none")}</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("panel.secThresholds")}</legend>
        <label className="gcs-field">
          {t("name")}
          <input className="gcs-input" name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </label>
        <div className="gcs-formGrid gcs-formGrid--3">
          {(["minPosts", "minPoints", "minReputation"] as const).map((k) => (
            <label key={k} className="gcs-field">
              {t(k)}
              <input className="gcs-input" name={k} type="number" min={0} placeholder="—" defaultValue={rank?.[k] ?? ""} />
            </label>
          ))}
        </div>
        <p className="gcs-achHint">{t("panel.thresholdsHint")}</p>
        <div className="gcs-field">
          <span id={`${ids}-match`}>{t("panel.matchLabel")}</span>
          <div className="gcs-achSeg" role="radiogroup" aria-labelledby={`${ids}-match`} data-testid="gcs-rank-match">
            {(["all", "any"] as const).map((m) => (
              <label key={m} className="gcs-achSeg__opt">
                <input type="radio" name="match" value={m} checked={match === m} onChange={() => setMatch(m)} />
                <span>{t(m === "all" ? "panel.matchAll" : "panel.matchAny")}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="gcs-field" role="group" aria-labelledby={`${ids}-crit`}>
          <span id={`${ids}-crit`}>{t("v2.criteria")}</span>
          {metrics.length === 0 ? (
            <p className="gcs-achHint">{t("panel.noMetrics")}</p>
          ) : (
            <>
              {criteria.map((c, i) => (
                <div key={c.key} className="gcs-achCrit" data-testid="gcs-rank-criterion">
                  <select
                    className="gcs-input"
                    name="criterionMetric"
                    aria-label={t("v2.criterionMetric", { n: i + 1 })}
                    value={c.metric}
                    onChange={(e) => setCriteria((list) => list.map((x) => (x.key === c.key ? { ...x, metric: e.target.value } : x)))}
                  >
                    <option value="">{t("v2.none")}</option>
                    {metrics.map((m) => (
                      <option key={m.key} value={m.key} disabled={m.key !== c.metric && used.has(m.key)}>
                        {m.off ? `${m.label} (${t("v2.appOff")})` : m.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="gcs-input"
                    name="criterionMin"
                    type="number"
                    min={0}
                    required={c.metric !== ""}
                    aria-label={t("v2.criterionMin", { n: i + 1 })}
                    value={c.min}
                    onChange={(e) => setCriteria((list) => list.map((x) => (x.key === c.key ? { ...x, min: e.target.value } : x)))}
                  />
                  <button type="button" className="gcs-iconBtn" aria-label={t("panel.removeCriterion", { n: i + 1 })} title={t("panel.removeCriterion", { n: i + 1 })} onClick={() => setCriteria((list) => list.filter((x) => x.key !== c.key))}>
                    <GcsIconSvg icon={faXmark} />
                  </button>
                </div>
              ))}
              <span>
                <GcsButton
                  variant="ghost"
                  size="sm"
                  icon={<GcsIconSvg icon={faPlus} />}
                  disabled={criteria.length >= Math.min(MAX_CRITERIA, metrics.length)}
                  onClick={() => setCriteria((list) => [...list, row(metrics.find((m) => !used.has(m.key))?.key ?? "")])}
                  data-testid="gcs-rank-add-criterion"
                >
                  {t("panel.addCriterion")}
                </GcsButton>
              </span>
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="gcs-formSec">
        <legend>{t("panel.secEmblem")}</legend>
        <div className="gcs-achPreview" role="group" aria-label={t("panel.emblemPreview")}>
          <span className={`gcs-rankEmblem${animated ? " gcs-rankEmblem--animated" : ""}`}>
            <GcsBadgeArt badge={preview} size={64} decorative data-testid="gcs-rank-preview" />
          </span>
          <GcsBadgeArt badge={preview} size={32} decorative />
          <GcsBadgeArt badge={preview} size={24} decorative />
          <strong className="gcs-achPreview__name">{preview.name}</strong>
        </div>
        <div className="gcs-formGrid">
          <label className="gcs-field">
            {t("art.shape")}
            <select className="gcs-input" name="emblemShape" value={shape} onChange={(e) => setShape(e.target.value)}>
              <option value="">{t("v2.auto")}</option>
              {GCS_BADGE_SHAPES.map((k) => (
                <option key={k} value={k}>
                  {t(`art.shapes.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="gcs-field">
            {t("v2.tier")}
            <select className="gcs-input" name="emblemTier" value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">{t("v2.auto")}</option>
              {tiers.map((k) => (
                <option key={k} value={k}>
                  {t(`v2.tiers.${k as "bronze"}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="gcs-field">
            <span>{t("art.icon")}</span>
            <GcsIconInput name="emblemIcon" value={icon} onChange={setIcon} testId="gcs-rank-icon" />
          </div>
          <label className="gcs-field">
            {t("color")}
            <span className="gcs-achColor">
              <input className="gcs-input" name="color" value={color} onChange={(e) => setColor(e.target.value)} placeholder={base.color} pattern="#[0-9A-Fa-f]{6}" maxLength={7} />
              <input
                type="color"
                aria-label={t("art.colorPicker")}
                value={(isBadgeColor(color) ? color : base.color).toLowerCase()}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
              />
            </span>
          </label>
          <label className="gcs-field">
            {t("panel.textIcon")}
            <input className="gcs-input" name="icon" defaultValue={rank?.icon ?? ""} maxLength={8} />
            <span className="gcs-field__hint">{t("panel.textIconHint")}</span>
          </label>
        </div>
        <label className="gcs-toggleRow">
          <span>{t("v2.animated")}</span>
          <input type="checkbox" name="animated" checked={animated} onChange={(e) => setAnimated(e.target.checked)} />
        </label>
        <div className="gcs-field">
          <span>{t("v2.emblemImage")}</span>
          <GcsUploadInput
            name="image"
            title={t("panel.emblemUploadTitle")}
            rules={UPLOAD_RULES.image(1)}
            current={existing ? { url: existing } : null}
            onFile={(file) => setUpload(file ? URL.createObjectURL(file) : null)}
            onRemove={() => {
              // „Scoate” pe un fișier abia ales îl renunță doar pe el; pe emblema salvată o scoate la salvare.
              if (!upload) setRemoveImage(true);
            }}
            testId="gcs-rank-image"
          />
          <span className="gcs-field__hint">{t("panel.emblemUploadHint")}</span>
          {removeImage && <input type="hidden" name="removeImage" value="on" />}
        </div>
      </fieldset>

      <fieldset className="gcs-formSec">
        <legend>{t("panel.secPerks")}</legend>
        <div className="gcs-formGrid">
          {select("perkGroupId", rank?.perkGroupId ?? null, groups, t("panel.perkGroup"))}
          {select("perkBadgeId", rank?.perkBadgeId ?? null, badges, t("panel.perkBadge"))}
          {styles.length > 0 && select("perkNameStyleId", rank?.perkNameStyleId ?? null, styles, t("panel.perkStyle"))}
        </div>
        <p className="gcs-achHint">{t("panel.perksHint")}</p>
      </fieldset>
    </>
  );
}
