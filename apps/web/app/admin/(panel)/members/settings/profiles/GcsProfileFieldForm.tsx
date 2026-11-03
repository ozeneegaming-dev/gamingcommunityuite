"use client";

import { faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { GcsIconInput } from "@/lib/ui-inputs";

export const PROFILE_FIELD_TYPES = ["TEXT", "TEXTAREA", "URL", "NUMBER", "SELECT", "IMAGE_SELECT", "SERVER_SELECT"] as const;
type FieldType = (typeof PROFILE_FIELD_TYPES)[number];

export type GcsProfileFieldFormData = {
  key: string;
  label: string;
  type: FieldType;
  maxLength: number;
  helper: string;
  groupId: number | null;
  section: "ABOUT" | "GAMES";
  visibility: "PUBLIC" | "MEMBERS" | "STAFF";
  icon: string | null;
  required: boolean;
  showOnCard: boolean;
  showInPostbit: boolean;
  options: string[];
  optionImages: Record<string, string>;
  linkTemplate: string | null;
};

type Props = {
  /** Câmpul editat; `null` = câmp nou. */
  field: GcsProfileFieldFormData | null;
  groups: { id: number; label: string }[];
};

type OptionRow = { uid: number; value: string; image: string };

/** O imagine de opțiune acceptată de server: un fișier al site-ului sau o adresă https (doar ca previzualizare aici). */
const IMAGE_URL = /^(?:\/files\/[A-Za-z0-9_-]{1,40}|https:\/\/\S{1,300})$/;

/**
 * Formularul unui câmp de profil din panoul de editare, pe secțiuni: De bază, Unde apare, Valori (doar la „Listă” și
 * „Select cu imagini”) și Link (doar la „Text”). Numele câmpurilor sunt cele citite de `saveProfileField`.
 */
export function GcsProfileFieldForm({ field, groups }: Props) {
  const t = useTranslations("acp.profiles");
  const id = useId();
  const [type, setType] = useState<FieldType>(field?.type ?? "TEXT");
  const withOptions = type === "SELECT" || type === "IMAGE_SELECT";
  const withImages = type === "IMAGE_SELECT";

  // Cel puțin două rânduri (o listă cere minimum două opțiuni); `uid` ține cheia rândului stabilă la ștergeri.
  const [options, setOptions] = useState<OptionRow[]>(() => {
    const list = (field?.options ?? []).map((o, i) => ({ uid: i, value: o, image: field?.optionImages[o] ?? "" }));
    while (list.length < 2) list.push({ uid: list.length, value: "", image: "" });
    return list;
  });
  const update = (uid: number, patch: Partial<OptionRow>) => setOptions((list) => list.map((o) => (o.uid === uid ? { ...o, ...patch } : o)));
  const add = () => setOptions((list) => [...list, { uid: Math.max(-1, ...list.map((o) => o.uid)) + 1, value: "", image: "" }]);

  const optionsValue = options.map((o) => o.value.trim()).filter(Boolean).join("\n");
  const imagesValue = options
    .filter((o) => o.value.trim() && o.image.trim())
    .map((o) => `${o.value.trim()} = ${o.image.trim()}`)
    .join("\n");

  return (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("form.basics")}</legend>
        <div className="gcs-formGrid">
          <label className="gcs-field">
            {t("form.label")}
            <input className="gcs-input" name="label" defaultValue={field?.label ?? ""} required maxLength={60} data-testid="gcs-acp-field-label" />
          </label>
          <label className="gcs-field">
            {t("form.key")}
            <input
              className="gcs-input gcs-acpProf__mono"
              name="key"
              defaultValue={field?.key ?? ""}
              required
              pattern="[a-z0-9_]{2,40}"
              readOnly={Boolean(field)}
              aria-describedby={`${id}-key`}
              data-testid="gcs-acp-field-key"
            />
            <span id={`${id}-key`} className="gcs-field__hint">
              {field ? t("form.keyLocked") : t("form.keyHint")}
            </span>
          </label>
          <label className="gcs-field">
            {t("form.type")}
            <select className="gcs-input" name="type" value={type} onChange={(e) => setType(e.target.value as FieldType)} data-testid="gcs-acp-field-type">
              {PROFILE_FIELD_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`types.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="gcs-field">
            {t("maxLength")}
            <input className="gcs-input" name="maxLength" type="number" min={1} max={5000} defaultValue={field?.maxLength ?? 200} />
          </label>
          <label className="gcs-field gcs-formGrid__wide">
            {t("form.helper")}
            <input className="gcs-input" name="helper" defaultValue={field?.helper ?? ""} maxLength={300} placeholder={t("fieldHelperHint")} />
          </label>
        </div>
      </fieldset>

      <fieldset className="gcs-formSec">
        <legend>{t("form.placement")}</legend>
        <div className="gcs-formGrid">
          <label className="gcs-field">
            {t("form.group")}
            <select className="gcs-input" name="groupId" defaultValue={field?.groupId ? String(field.groupId) : ""} data-testid="gcs-acp-field-group">
              <option value="">{t("groups.none")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="gcs-field">
            {t("form.section")}
            <select className="gcs-input" name="section" defaultValue={field?.section ?? "ABOUT"} data-testid="gcs-acp-field-section">
              <option value="ABOUT">{t("sections.ABOUT")}</option>
              <option value="GAMES">{t("sections.GAMES")}</option>
            </select>
          </label>
          <label className="gcs-field">
            {t("visibility")}
            <select className="gcs-input" name="visibility" defaultValue={field?.visibility ?? "PUBLIC"} data-testid="gcs-acp-field-visibility">
              {(["PUBLIC", "MEMBERS", "STAFF"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`visibilities.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="gcs-field" role="group" aria-label={t("form.icon")}>
            <span>{t("form.icon")}</span>
            <GcsIconInput name="icon" value={field?.icon ?? null} testId="gcs-acp-field-icon" />
          </div>
        </div>
        <label className="gcs-toggleRow">
          <span>{t("required")}</span>
          <input type="checkbox" role="switch" className="gcs-switch" name="required" defaultChecked={field?.required ?? false} />
        </label>
        <label className="gcs-toggleRow">
          <span>{t("form.showOnCard")}</span>
          <input type="checkbox" role="switch" className="gcs-switch" name="showOnCard" defaultChecked={field?.showOnCard ?? false} />
        </label>
        <label className="gcs-toggleRow">
          <span>{t("form.showInPostbit")}</span>
          <input type="checkbox" role="switch" className="gcs-switch" name="showInPostbit" defaultChecked={field?.showInPostbit ?? false} />
        </label>
      </fieldset>

      {withOptions && (
        <fieldset className="gcs-formSec" data-testid="gcs-acp-field-options">
          <legend>{t("form.values")}</legend>
          <p className="gcs-field__hint" style={{ margin: 0 }}>
            {withImages ? t("form.valuesImagesHint") : t("form.valuesHint")}
          </p>
          <input type="hidden" name="options" value={optionsValue} />
          {withImages && <input type="hidden" name="optionImages" value={imagesValue} />}
          <ol className="gcs-acpProf__options">
            {options.map((o, i) => (
              <li key={o.uid} className={withImages ? "gcs-acpProf__option gcs-acpProf__option--image" : "gcs-acpProf__option"}>
                <input
                  className="gcs-input"
                  value={o.value}
                  maxLength={60}
                  onChange={(e) => update(o.uid, { value: e.target.value })}
                  placeholder={t("form.optionPlaceholder", { n: i + 1 })}
                  aria-label={t("form.optionLabel", { n: i + 1 })}
                  data-testid="gcs-acp-field-option"
                />
                {withImages && (
                  <span className="gcs-acpProf__optionImage">
                    <span className="gcs-acpProf__thumb" aria-hidden="true">
                      {IMAGE_URL.test(o.image.trim()) && <img src={o.image.trim()} alt="" loading="lazy" />}
                    </span>
                    <input
                      className="gcs-input"
                      value={o.image}
                      onChange={(e) => update(o.uid, { image: e.target.value })}
                      placeholder="https://… / /files/…"
                      aria-label={t("form.optionImageLabel", { n: i + 1 })}
                    />
                  </span>
                )}
                <button
                  type="button"
                  className="gcs-iconBtn"
                  disabled={options.length <= 2}
                  aria-label={t("form.optionRemove", { n: i + 1 })}
                  title={t("form.optionRemove", { n: i + 1 })}
                  onClick={() => setOptions((list) => list.filter((x) => x.uid !== o.uid))}
                >
                  <GcsIconSvg icon={faXmark} />
                </button>
              </li>
            ))}
          </ol>
          <div>
            <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faPlus} />} disabled={options.length >= 50} onClick={add}>
              {t("form.optionAdd")}
            </GcsButton>
          </div>
        </fieldset>
      )}

      {type === "TEXT" && (
        <fieldset className="gcs-formSec">
          <legend>
            {t("form.link")} <span className="gcs-acpProf__optional">{t("form.optional")}</span>
          </legend>
          <label className="gcs-field">
            <span className="gcs-srOnly">{t("form.linkTemplate")}</span>
            <input className="gcs-input" name="linkTemplate" defaultValue={field?.linkTemplate ?? ""} placeholder="https://x.com/{handle}" aria-describedby={`${id}-link`} data-testid="gcs-acp-field-template" />
            <span id={`${id}-link`} className="gcs-field__hint">
              {t("form.linkHint")}
            </span>
          </label>
        </fieldset>
      )}
    </>
  );
}
