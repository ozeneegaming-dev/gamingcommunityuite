"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { positionTooltip, tooltipContainer } from "./tooltipPlace";

/**
 * Elementele care primesc automat tooltip-ul sistemului: cele cu `data-tip` (textul lui), cele cu `title` (tooltip-ul
 * nativ e înlocuit cât timp bula e afișată) și butoanele / linkurile doar cu iconiță, după `aria-label`.
 */
const TARGET = "[data-tip], [title], button[aria-label], a[aria-label], [role='button'][aria-label]";
/** Zone fără tooltip-ul automat: componentele cu `GcsTooltip` propriu și cele care îl refuză explicit. */
const SKIP = "[data-gcs-tip-off], .gcs-tooltipWrap";

type Tip = { el: Element; text: string; host: HTMLElement };

/** Textul tooltip-ului automat pentru un element (sau `null` = nu primește). */
export function autoTipText(el: Element): string | null {
  // `title`-ul unui iframe îl descrie pentru cititoarele de ecran; nu e un tooltip.
  if (el.closest(SKIP) || el.tagName === "IFRAME") return null;
  const dataTip = el.getAttribute("data-tip")?.trim();
  if (dataTip) return dataTip;
  const title = (el.getAttribute("title") ?? el.getAttribute("data-gcs-title"))?.trim();
  if (title) return title;
  const label = el.getAttribute("aria-label")?.trim();
  // `aria-label` doar pe elementele fără text vizibil (butoane-iconiță, eventual cu o bulină cu un număr); un buton
  // cu text nu are nevoie de tooltip.
  if (label && /^[\d\s+.,k]*$/i.test((el.textContent ?? "").trim())) return label;
  return null;
}

/**
 * Gazda tooltip-urilor automate (o singură instanță, în layout-ul rădăcină): la hover cu mouse-ul și la focus din
 * tastatură pe un element țintă, arată bula sistemului (aceeași ca `GcsTooltip`). Bula stă în `<body>` sau în dialogul
 * modal deschis, deci merge și în meniurile deschise. Atributul `title` e mutat în `data-gcs-title` cât timp bula e
 * afișată (fără tooltip-ul nativ dublu) și pus la loc după.
 */
export function GcsTooltipHost() {
  const id = useId();
  const [tip, setTip] = useState<Tip | null>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let current: Element | null = null;
    const restore = (el: Element | null) => {
      if (!el) return;
      const saved = el.getAttribute("data-gcs-title");
      if (saved !== null) {
        el.setAttribute("title", saved);
        el.removeAttribute("data-gcs-title");
      }
      const described = el.getAttribute("aria-describedby");
      if (described) {
        const rest = described.split(" ").filter((x) => x !== id).join(" ");
        if (rest) el.setAttribute("aria-describedby", rest);
        else el.removeAttribute("aria-describedby");
      }
    };
    const hide = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      restore(current);
      current = null;
      setTip(null);
    };
    const show = (el: Element, delay: number) => {
      const text = autoTipText(el);
      if (!text || el === current) return;
      hide();
      current = el;
      // Fără tooltip-ul nativ dublu; textul rămâne descrierea elementului (legată de bulă).
      const title = el.getAttribute("title");
      if (title !== null) {
        el.setAttribute("data-gcs-title", title);
        el.removeAttribute("title");
        el.setAttribute("aria-describedby", [el.getAttribute("aria-describedby"), id].filter(Boolean).join(" "));
      }
      timer.current = setTimeout(() => {
        if (current === el && el.isConnected) setTip({ el, text, host: tooltipContainer(el) });
      }, delay);
    };
    const target = (node: EventTarget | null) => (node instanceof Element ? node.closest(TARGET) : null);

    const onOver = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      const el = target(e.target);
      if (el && autoTipText(el)) show(el, 120);
    };
    const onOut = (e: PointerEvent) => {
      if (!current) return;
      const to = e.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      if (e.target instanceof Node && current.contains(e.target)) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = target(e.target);
      if (el && el === e.target && el.matches(":focus-visible") && autoTipText(el)) show(el, 0);
    };
    const onBlur = (e: FocusEvent) => {
      if (current && e.target === current) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", onBlur, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", onBlur, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [id]);

  useLayoutEffect(() => {
    if (tip && bubble.current) positionTooltip(tip.el, bubble.current, "top");
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <span ref={bubble} role="tooltip" id={id} className="gcs-tooltip gcs-tooltip--top" data-testid="gcs-auto-tooltip">
      {tip.text}
    </span>,
    tip.host,
  );
}
