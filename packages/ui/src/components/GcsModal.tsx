"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "../cx";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "../icons/svg";
import { GcsCloseProvider } from "./GcsDrawer";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type GcsModalProps = {
  title: string;
  /** Iconița din fața titlului (`<GcsIconSvg icon={faX} />`; componenta e client). */
  icon?: ReactNode;
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
/** Dialogurile deschise, în ordine: doar cel de deasupra răspunde la Escape și ține focusul (un popup într-un dialog). */
const openDialogs: symbol[] = [];

export function GcsModal({ title, icon, onClose, children, closeLabel, size = "md", className }: GcsModalProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const me = Symbol("gcs-modal");
    openDialogs.push(me);
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    const first = el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== me) return;
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
      openDialogs.splice(openDialogs.indexOf(me), 1);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <GcsCloseProvider value={{ close: () => close.current() }}>
    <div
      className="gcs-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx("gcs-modal__dialog", `gcs-modal__dialog--${size}`, className)}>
        <div className="gcs-modal__header">
          <h2 id={titleId} className="gcs-modal__title gcs-display">
            {icon && (
              <span className="gcs-modal__icon" aria-hidden="true">
                {icon}
              </span>
            )}
            {title}
          </h2>
          <button type="button" className="gcs-modal__close" aria-label={closeLabel} onClick={() => close.current()}>
            <GcsIconSvg icon={faXmark} />
          </button>
        </div>
        <div className="gcs-modal__body">{children}</div>
      </div>
    </div>
    </GcsCloseProvider>
  );
}
