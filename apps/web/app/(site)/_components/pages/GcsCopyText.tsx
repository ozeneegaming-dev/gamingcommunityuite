"use client";

import { GcsIcon } from "@/lib/pages-icons";
import { useTranslations } from "next-intl";
import { useState } from "react";

/** „Copiază” un text (codul unui config, adresa unui fișier din bibliotecă), cu „Copiat” câteva secunde. */
export function GcsCopyText({ text, label, testId }: { text: string; label?: string; testId?: string }) {
  const t = useTranslations("pages");
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      setDone(false);
    }
  }
  return (
    <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-pgCopy" onClick={() => void copy()} data-testid={testId}>
      <GcsIcon name={done ? "fa-solid fa-check" : "fa-regular fa-copy"} />
      <span aria-live="polite">{done ? t("copied") : (label ?? t("copy"))}</span>
    </button>
  );
}
