"use client";

import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { positionTooltip, tooltipContainer } from "./tooltipPlace";

type TriggerProps = {
  "aria-describedby"?: string;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
};

export type GcsTooltipProps = {
  /** Textul tooltip-ului (sau un conținut scurt, ex. numele și descrierea unui badge). */
  content: ReactNode;
  /** Elementul pe care apare (un singur element care primește focus, ex. un buton sau un link). */
  children: ReactElement<TriggerProps>;
  side?: "top" | "bottom";
  /** O clasă în plus pentru bulă (ex. `gcs-tooltip--group`, tooltip-ul pastilelor de grup). */
  className?: string;
};

/** `useLayoutEffect` doar în browser (pe server avertizează). */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Tooltip-ul sistemului (unul singur pe tot site-ul, în orice temă): o bulă mică, închisă, cu săgeată și intrarea
 * înclinată. Apare la hover și la focus din tastatură, e legat de element prin `aria-describedby` și dispare cu Escape.
 * Bula stă în `<body>` (sau în dialogul modal deschis), cu poziție fixă: nu o taie nici meniurile deschise, nici
 * panourile cu `overflow`. Elementele simple (`title`, `data-tip`, butoanele doar cu iconiță) îl primesc automat prin
 * `GcsTooltipHost`.
 */
export function GcsTooltip({ content, children, side = "top", className }: GcsTooltipProps) {
  const id = useId();
  // Unde stă bula cât e deschisă (`null` = închisă): `<body>` sau dialogul modal care conține elementul.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const open = host !== null;
  const setOpen = (on: boolean, el?: Element) => setHost(on && el ? tooltipContainer(el) : null);
  const wrap = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  useIsoLayoutEffect(() => {
    if (open && wrap.current && bubble.current) positionTooltip(wrap.current, bubble.current, side);
  }, [open, side, content]);

  // La derulare sau redimensionare bula s-ar desprinde de element: se închide.
  useEffect(() => {
    if (!open) return;
    const close = () => setHost(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (!isValidElement(children)) return children;
  const props = children.props;
  const trigger = cloneElement(children, {
    "aria-describedby": [props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined,
    onMouseEnter: (e: MouseEvent) => {
      props.onMouseEnter?.(e);
      setOpen(true, e.currentTarget as Element);
    },
    onMouseLeave: (e: MouseEvent) => {
      props.onMouseLeave?.(e);
      setOpen(false);
    },
    onFocus: (e: FocusEvent) => {
      props.onFocus?.(e);
      setOpen(true, e.currentTarget as Element);
    },
    onBlur: (e: FocusEvent) => {
      props.onBlur?.(e);
      setOpen(false);
    },
  });
  return (
    <span
      ref={wrap}
      className="gcs-tooltipWrap"
      onKeyDown={(e) => {
        if (e.key === "Escape") setHost(null);
      }}
    >
      {trigger}
      {host &&
        createPortal(
          <span ref={bubble} role="tooltip" id={id} className={`gcs-tooltip gcs-tooltip--${side}${className ? ` ${className}` : ""}`}>
            {content}
          </span>,
          host,
        )}
    </span>
  );
}
