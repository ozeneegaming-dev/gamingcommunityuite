import type { GcsForumExtField } from "@gcs/core";
import { GcsIconPicker } from "@gcs/ui";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { iconPickerLabels } from "@/lib/ui-labels";
import { GcsExtGradientField, GcsExtImageField, type GcsExtImageUpload } from "./GcsExtImageField";

type Translate = Awaited<ReturnType<typeof getTranslations>>;
const label = (t: Translate, key: string) => (t.has(key as never) ? t(key as never) : key);

/**
 * Câmpurile unui tab contribuit de o extensie (Forum v2 / Aspect forumuri), în formularul ACP al forumului sau în pagina
 * de aspect a unui widget: text, număr, comutator, alegere, culoare, gradient, iconiță și imagine (încărcată pe loc).
 */
export async function GcsExtFields({
  fields,
  values,
  options,
  upload,
}: {
  fields: readonly GcsForumExtField[];
  values: Record<string, unknown>;
  options: Record<string, { value: string; label: string }[]>;
  upload: Omit<GcsExtImageUpload, "field">;
}) {
  const [tAll, tui, ta] = await Promise.all([getTranslations(), getTranslations("ui"), getTranslations("acp.aspect")]);
  const iconLabels = iconPickerLabels(tui);
  const imageLabels = { upload: ta("image.upload"), replace: ta("image.replace"), remove: ta("image.remove"), uploading: ta("image.uploading"), preview: ta("image.preview") };
  const gradientLabels = { from: ta("gradient.from"), to: ta("gradient.to"), angle: ta("gradient.angle"), none: ta("gradient.none") };

  function ExtField({ field, value, list }: { field: GcsForumExtField; value: unknown; list: { value: string; label: string }[] }): ReactNode {
    const id = `gcs-ext-${field.key}`;
    const hint = field.hintKey ? <span className="gcs-muted gcs-acpHint">{label(tAll, field.hintKey)}</span> : null;
    const name = label(tAll, field.labelKey);
    switch (field.type) {
      case "toggle":
        return (
          <label className="gcs-check">
            <input type="checkbox" name={field.key} defaultChecked={value === true} data-testid={id} />
            {name}
            {hint}
          </label>
        );
      case "textarea":
        return (
          <label className="gcs-field" htmlFor={id}>
            {name}
            <textarea id={id} className="gcs-input" name={field.key} maxLength={field.maxLength} rows={3} defaultValue={typeof value === "string" ? value : ""} />
            {hint}
          </label>
        );
      case "number":
        return (
          <label className="gcs-field" htmlFor={id}>
            {name}
            <input id={id} className="gcs-input" type="number" name={field.key} min={field.min} max={field.max} step={field.step ?? 1} defaultValue={typeof value === "number" ? value : field.min} data-testid={id} />
            {hint}
          </label>
        );
      case "select": {
        const choices = field.options ? field.options.map((o) => ({ value: o.value, label: label(tAll, o.labelKey) })) : list;
        return (
          <label className="gcs-field" htmlFor={id}>
            {name}
            <select id={id} className="gcs-input" name={field.key} defaultValue={typeof value === "string" ? value : ""} data-testid={id}>
              {!field.options && <option value="">—</option>}
              {choices.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {hint}
          </label>
        );
      }
      case "color":
        return (
          <label className="gcs-field" htmlFor={id}>
            {name}
            <input id={id} className="gcs-input" name={field.key} defaultValue={typeof value === "string" ? value : ""} placeholder="#RRGGBB" pattern="#[0-9A-Fa-f]{6}" maxLength={7} data-testid={id} />
            {hint}
          </label>
        );
      case "gradient":
        return (
          <div className="gcs-field" role="group" aria-label={name}>
            <span>{name}</span>
            <GcsExtGradientField name={field.key} value={typeof value === "string" ? value : ""} labels={gradientLabels} testId={id} />
            {hint}
          </div>
        );
      case "image":
        return (
          <div className="gcs-field" role="group" aria-label={name}>
            <span>{name}</span>
            <GcsExtImageField
              name={field.key}
              value={typeof value === "string" ? value : ""}
              upload={{ ...upload, field: field.key }}
              labels={imageLabels}
              title={name}
              maxKb={field.maxKb}
              hint={ta("image.hint", { kb: field.maxKb, px: field.maxSide })}
              testId={id}
            />
            {hint}
          </div>
        );
      case "icon":
        return (
          <div className="gcs-field" role="group" aria-label={name}>
            <span>{name}</span>
            <GcsIconPicker name={field.key} value={typeof value === "string" && value ? value : null} searchUrl="/api/icons/search" labels={iconLabels} testId={id} />
            {hint}
          </div>
        );
      default:
        return (
          <label className="gcs-field" htmlFor={id}>
            {name}
            <input id={id} className="gcs-input" name={field.key} maxLength={field.maxLength} defaultValue={typeof value === "string" ? value : ""} data-testid={id} />
            {hint}
          </label>
        );
    }
  }

  return (
    <>
      {fields.map((field) => (
        <ExtField key={field.key} field={field} value={values[field.key]} list={options[field.key] ?? []} />
      ))}
    </>
  );
}
