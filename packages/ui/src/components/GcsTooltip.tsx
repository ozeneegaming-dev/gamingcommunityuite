"use client";

import { cloneElement, isValidElement, useId, useState, type FocusEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";

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

/**
 * Tooltip accesibil (spec etapa 5): apare la hover și la focus din tastatură, e legat de element prin
 * `aria-describedby` și dispare cu Escape.
 */
export function GcsTooltip({ content, children, side = "top", className }: GcsTooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!isValidElement(children)) return children;
  const props = children.props;
  const trigger = cloneElement(children, {
    "aria-describedby": [props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined,
    onMouseEnter: (e: MouseEvent) => {
      props.onMouseEnter?.(e);
      setOpen(true);
    },
    onMouseLeave: (e: MouseEvent) => {
      props.onMouseLeave?.(e);
      setOpen(false);
    },
    onFocus: (e: FocusEvent) => {
      props.onFocus?.(e);
      setOpen(true);
    },
    onBlur: (e: FocusEvent) => {
      props.onBlur?.(e);
      setOpen(false);
    },
  });
  return (
    <span
      className="gcs-tooltipWrap"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {trigger}
      {open && (
        <span role="tooltip" id={id} className={`gcs-tooltip gcs-tooltip--${side}${className ? ` ${className}` : ""}`}>
          {content}
        </span>
      )}
    </span>
  );
}
