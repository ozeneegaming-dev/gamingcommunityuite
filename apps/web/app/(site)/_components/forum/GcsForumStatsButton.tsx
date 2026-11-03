"use client";

import { faChartSimple } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg, positionTooltip } from "@gcs/ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Unde stă bula: în dialogul modal deschis care conține butonul, altfel în `<body>` (ca tooltip-ul sistemului). */
const container = (el: Element) => (el.closest("dialog[open]") as HTMLElement | null) ?? document.body;
/** Setarea temei „Statistici forum” (`data-gcs-stats` pe `<html>`): `hover` = bula și la hover / focus pe rând. */
const statsMode = () => document.documentElement.getAttribute("data-gcs-stats");

/**
 * Butonul pătrat al statisticilor unui forum (macheta CardRows) și bula cu contoarele. Bula e un tooltip al sistemului
 * (aceleași culori, săgeată și așezare sus / jos, ținută în ecran), pus în `<body>`: nu o taie caseta categoriei sau
 * cardurile din grilă. Se deschide la click (telefon, tastatură; `data-stats-open` pe rând) și se închide la click în
 * afară, cu Escape sau la derulare; cu setarea „Statistici forum: La hover”, apare și la hover / focus pe rând.
 */
export function GcsForumStatsButton({ label, bubbleId, children }: { label: string; bubbleId: string; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [onRow, setOnRow] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const visible = (open || onRow) && host !== null;

  useEffect(() => {
    if (ref.current) setHost(container(ref.current));
  }, []);

  // Hover / focus pe rând, doar cu setarea „La hover”.
  useEffect(() => {
    const row = ref.current?.closest(".gcs-forumRow");
    if (!row) return;
    let hovered = false;
    let focused = false;
    const sync = () => setOnRow(statsMode() === "hover" && (hovered || focused));
    const enter = () => ((hovered = true), sync());
    const leave = () => ((hovered = false), sync());
    const focusIn = () => ((focused = true), sync());
    const focusOut = (e: Event) => {
      if (!(e as FocusEvent).relatedTarget || !row.contains((e as FocusEvent).relatedTarget as Node)) ((focused = false), sync());
    };
    row.addEventListener("pointerenter", enter);
    row.addEventListener("pointerleave", leave);
    row.addEventListener("focusin", focusIn);
    row.addEventListener("focusout", focusOut);
    return () => {
      row.removeEventListener("pointerenter", enter);
      row.removeEventListener("pointerleave", leave);
      row.removeEventListener("focusin", focusIn);
      row.removeEventListener("focusout", focusOut);
    };
  }, []);

  useEffect(() => {
    const row = ref.current?.closest(".gcs-forumRow");
    row?.toggleAttribute("data-stats-open", open);
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  /*
   * Escape o închide (și pe cea de la hover, până când mouse-ul iese din rând). La derularea paginii sau a unei zone care
   * conține butonul, ori la redimensionare, bula s-ar desprinde de buton: se închide. Derularea altor zone (ex. un chat
   * din pagină) n-o atinge.
   */
  useEffect(() => {
    if (!visible) return;
    const close = () => {
      setOpen(false);
      setOnRow(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node) || e.target === document || e.target.contains(ref.current)) close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [visible]);

  useLayoutEffect(() => {
    if (visible && ref.current && bubble.current) positionTooltip(ref.current, bubble.current, "top");
  }, [visible]);

  return (
    <>
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
      {visible &&
        createPortal(
          <span ref={bubble} className="gcs-tooltip gcs-tooltip--top gcs-forumRow__bubble" id={bubbleId} role="note" data-testid="gcs-forum-bubble">
            {children}
          </span>,
          host,
        )}
    </>
  );
}
