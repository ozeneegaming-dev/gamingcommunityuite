"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "../cx";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type GcsModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Textul butonului de închidere (pentru cititoarele de ecran). */
  closeLabel: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

/**
 * Dialog modal accesibil: focusul intră în dialog și nu iese cu Tab, Escape sau click pe fundal îl închide,
 * iar la închidere focusul revine pe elementul care l-a deschis. Pagina din spate nu se derulează cât e deschis.
 */
export function GcsModal({ title, onClose, children, closeLabel, size = "md", className }: GcsModalProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    const first = el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.hasAttribute("inert"));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="gcs-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx("gcs-modal__dialog", `gcs-modal__dialog--${size}`, className)}>
        <div className="gcs-modal__header">
          <h2 id={titleId} className="gcs-modal__title gcs-display">
            {title}
          </h2>
          <button type="button" className="gcs-modal__close" aria-label={closeLabel} onClick={() => close.current()}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="gcs-modal__body">{children}</div>
      </div>
    </div>
  );
}
