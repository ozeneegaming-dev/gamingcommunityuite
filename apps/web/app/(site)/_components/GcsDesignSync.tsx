"use client";

import { THEME_HTML_ATTRS, type GcsThemeHtmlAttrs } from "@gcs/core/themes";
import { useEffect } from "react";

/** Clasele designelor de temă (vezi `designClass` din `lib/theme-preview`). */
const DESIGN_CLASSES = ["gcs-nova"] as const;

/**
 * Ține clasa designului și atributele setărilor de sistem (`data-gcs-lists`, `data-gcs-loader`…) de pe `<html>` în
 * acord cu zona curentă. Layout-ul rădăcină le pune la prima randare, dar nu se re-randează la navigarea fără
 * reîncărcare: din site în ACP ele trebuie scoase (ACP-ul are designul lui), înapoi pe site trebuie puse la loc.
 * Randat de layout-ul site-ului (cu designul și atributele temei) și de layout-urile ACP (`null`).
 */
export function GcsDesignSync({ design, attrs = null }: { design: string | null; attrs?: GcsThemeHtmlAttrs | null }) {
  // Valorile, în ordinea din `THEME_HTML_ATTRS` (obiectul e nou la fiecare randare; textul nu).
  const key = attrs ? THEME_HTML_ATTRS.map((a) => attrs[a]).join("|") : "";
  useEffect(() => {
    const html = document.documentElement;
    for (const cls of DESIGN_CLASSES) html.classList.toggle(cls, cls === design);
    const values = key ? key.split("|") : [];
    THEME_HTML_ATTRS.forEach((a, i) => {
      const value = values[i];
      if (value) html.setAttribute(a, value);
      else html.removeAttribute(a);
    });
  }, [design, key]);
  return null;
}
