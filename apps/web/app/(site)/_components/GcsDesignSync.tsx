"use client";

import { useEffect } from "react";

/** Clasele designelor de temă (vezi `designClass` din `lib/theme-preview`). */
const DESIGN_CLASSES = ["gcs-nova"] as const;

/**
 * Ține clasa designului de pe `<html>` în acord cu zona curentă. Layout-ul rădăcină o pune la prima randare, dar nu se
 * re-randează la navigarea fără reîncărcare: din site în ACP clasa trebuie scoasă (ACP-ul are designul lui), înapoi pe
 * site trebuie pusă la loc. Randat de layout-ul site-ului (cu designul temei) și de layout-urile ACP (`null`).
 */
export function GcsDesignSync({ design }: { design: string | null }) {
  useEffect(() => {
    const html = document.documentElement;
    for (const cls of DESIGN_CLASSES) html.classList.toggle(cls, cls === design);
  }, [design]);
  return null;
}
