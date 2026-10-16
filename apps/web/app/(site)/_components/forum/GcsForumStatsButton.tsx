"use client";

import { faChartSimple } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useEffect, useRef, useState } from "react";

/**
 * Butonul pătrat al statisticilor unui forum (macheta CardRows): deschide / închide bula cu contoarele (`data-stats-open`
 * pe rând), pentru telefon și tastatură; se închide la click în afară și cu Escape. Cu setarea „Statistici forum: La
 * hover”, bula apare și la hover / focus pe rând (doar din CSS).
 */
export function GcsForumStatsButton({ label, bubbleId }: { label: string; bubbleId: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const row = ref.current?.closest(".gcs-forumRow");
    row?.toggleAttribute("data-stats-open", open);
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.parentElement?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <button
      ref={ref}
      type="button"
      className="gcs-forumRow__statsBtn"
      aria-label={label}
      aria-expanded={open}
      aria-controls={bubbleId}
      // Bula e chiar tooltip-ul butonului: fără tooltip-ul automat peste ea.
      data-gcs-tip-off=""
      onClick={() => setOpen((v) => !v)}
      data-testid="gcs-forum-stats-btn"
    >
      <GcsIconSvg icon={faChartSimple} />
    </button>
  );
}
