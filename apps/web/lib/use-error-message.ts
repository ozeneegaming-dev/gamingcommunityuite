"use client";

import type { GcsErrorPayload } from "@gcs/core";
import { useTranslations } from "next-intl";

/** Mesajul tradus pentru o eroare `GcsResult`: motivul (`params.reason`), erorile pe câmpuri sau codul general. */
export function useErrorMessage(): (error: GcsErrorPayload) => string {
  const t = useTranslations("errors");
  return (error) => {
    const reason = error.params?.reason;
    if (reason && t.has(`reasons.${reason}`)) return t(`reasons.${reason}`);
    const fieldCodes = Object.values(error.fields ?? {});
    if (fieldCodes.length > 0) {
      return fieldCodes.map((c) => (t.has(`fields.${c}`) ? t(`fields.${c}`) : c)).join(" · ");
    }
    return t.has(error.code) ? t(error.code) : error.code;
  };
}
