"use client";

import { cloneElement, isValidElement, useId, useState, type FocusEvent, type MouseEvent, type ReactElement } from "react";

type TriggerProps = {
  "aria-describedby"?: string;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
};

export type GcsTooltipProps = {
  /** Textul tooltip-ului. */
  content: string;
  /** Elementul pe care apare (un singur element care primește focus, ex. un buton sau un link). */
  children: ReactElement<TriggerProps>;
  side?: "top" | "bottom";
};

/**
 * Tooltip accesibil (spec etapa 5): apare la hover și la focus din tastatură, e legat de element prin
 * `aria-describedby` și dispare cu Escape.
 */
export function GcsTooltip({ content, children, side = "top" }: GcsTooltipProps) {
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
        <span role="tooltip" id={id} className={`gcs-tooltip gcs-tooltip--${side}`}>
          {content}
        </span>
      )}
    </span>
  );
}
