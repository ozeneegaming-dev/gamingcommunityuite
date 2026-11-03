"use client";

import { GcsIconPicker, GcsUploadField, type GcsIconPickerProps, type GcsUploadFieldProps } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { iconPickerLabels, uploadLabels } from "./ui-labels";

/**
 * Câmpul de încărcare al sistemului cu textele din `ui.upload` (popupul cu tragere, verificări și previzualizare).
 * Se folosește direct din paginile server: `<GcsUploadInput name="badgeImage" title="…" rules={UPLOAD_RULES.emblem()} />`.
 */
export function GcsUploadInput(props: Omit<GcsUploadFieldProps, "labels">) {
  const t = useTranslations("ui");
  return <GcsUploadField {...props} labels={uploadLabels(t)} />;
}

/** Selectorul de iconițe (buton + popup) cu textele din `ui.iconPicker` și căutarea `/api/icons/search`. */
export function GcsIconInput(props: Omit<GcsIconPickerProps, "labels" | "searchUrl"> & { searchUrl?: string }) {
  const t = useTranslations("ui");
  return <GcsIconPicker {...props} searchUrl={props.searchUrl ?? "/api/icons/search"} labels={iconPickerLabels(t)} />;
}
