import type { GcsIconPickerProps, GcsUploadLabels, GcsUploadRules } from "@gcs/ui";

/**
 * Textele pieselor sistemului (popupul de încărcare, selectorul de iconițe), din spațiul de mesaje `ui`. Merg și pe
 * server (`getTranslations("ui")`), și în componentele client (`useTranslations("ui")`). Șabloanele cu `{w}`, `{max}`…
 * se citesc brute: le completează componenta.
 */
type T = { (key: string): string; raw(key: string): unknown };

const UPLOAD_KEYS = [
  "upload",
  "replace",
  "remove",
  "noImage",
  "noFile",
  "dropHere",
  "dropRelease",
  "or",
  "browse",
  "paste",
  "use",
  "chooseOther",
  "cancel",
  "close",
  "uploading",
  "rulesTypes",
  "rulesMax",
  "rulesMin",
  "rulesSquare",
  "okType",
  "okSize",
  "okDims",
  "okReal",
  "errType",
  "errSize",
  "errMin",
  "errMax",
  "errSquare",
  "errReal",
  "errUpload",
] as const satisfies readonly (keyof GcsUploadLabels)[];

export function uploadLabels(t: T): GcsUploadLabels {
  return Object.fromEntries(UPLOAD_KEYS.map((k) => [k, String(t.raw(`upload.${k}`))])) as GcsUploadLabels;
}

export function iconPickerLabels(t: T): GcsIconPickerProps["labels"] {
  const cats = ["popular", "gaming", "community", "staff", "tech", "rewards", "arrows", "brands"] as const;
  return {
    search: t("iconPicker.search"),
    none: t("iconPicker.none"),
    noResults: t("iconPicker.noResults"),
    choose: t("iconPicker.choose"),
    categories: Object.fromEntries(cats.map((c) => [c, t(`iconPicker.categories.${c}`)])),
  };
}

const MB = 1024 * 1024;

/** Regulile de încărcare folosite des (tipurile, mărimea, dimensiunile); serverul le verifică oricum din nou. */
export const UPLOAD_RULES = {
  /** Imaginile obișnuite ale site-ului (logo-uri, coperte, imaginile forumurilor). */
  image: (maxMb = 5, image: GcsUploadRules["image"] = {}): GcsUploadRules => ({
    accept: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    typesLabel: "PNG, JPG, WebP, GIF",
    maxBytes: maxMb * MB,
    image,
  }),
  /** Emblemele și iconițele (pot fi și SVG), pătrate. */
  emblem: (maxMb = 1, min = 64): GcsUploadRules => ({
    accept: ["image/png", "image/webp", "image/svg+xml", "image/gif"],
    typesLabel: "PNG, WebP, SVG, GIF",
    maxBytes: maxMb * MB,
    image: { minWidth: min, minHeight: min, square: true },
  }),
  /** O arhivă (pluginuri, pachete de importat). */
  zip: (maxMb = 50): GcsUploadRules => ({ accept: ["application/zip", "application/x-zip-compressed", ".zip"], typesLabel: "ZIP", maxBytes: maxMb * MB }),
  /** Un fișier JSON (exporturi de configurare). */
  json: (maxMb = 2): GcsUploadRules => ({ accept: ["application/json", ".json"], typesLabel: "JSON", maxBytes: maxMb * MB }),
} as const;
