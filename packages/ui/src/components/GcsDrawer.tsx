"use client";

import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "../cx";
import { GcsIconSvg } from "../icons/svg";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Panoul (sau dialogul) deschis: formularele din el (ex. `GcsActionForm`) îl închid după o salvare reușită. */
const DrawerContext = createContext<{ close: () => void } | null>(null);
export const useGcsDrawer = () => useContext(DrawerContext);
/** Același context îl dau și dialogurile modale: un formular dintr-un popup îl închide după salvare. */
export const GcsCloseProvider = DrawerContext.Provider;

export type GcsDrawerProps = {
  title: ReactNode;
  /** Iconița din fața titlului (`<GcsIconSvg icon={faX} />` sau `<GcsIcon name="…" />`). */
  icon?: ReactNode;
  /** Ce stă în dreapta titlului (o stare, un buton „Duplică”). */
  aside?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Bara de jos, fixă (ex. „Șterge” în stânga); butonul de salvare al formularului principal se lipește deasupra ei. */
  footer?: ReactNode;
  closeLabel: string;
  size?: "md" | "lg";
  className?: string;
  testId?: string;
};

/**
 * Panoul de editare din dreapta (tiparul „listă + panou” din ACP): titlul sus, conținutul derulabil, bara de jos fixă.
 * Ca dialogul modal: focusul intră și rămâne în panou, Escape sau click pe fundal îl închide, focusul revine pe butonul
 * care l-a deschis, pagina din spate nu se derulează. Pe telefon ocupă tot ecranul.
 */
export function GcsDrawer({ title, icon, aside, onClose, children, footer, closeLabel, size = "md", className, testId }: GcsDrawerProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = panel.current;
    // Focusul pe primul câmp al formularului (nu pe butonul de închidere).
    (el?.querySelector<HTMLElement>('.gcs-drawer__body input:not([type="hidden"]):not([disabled]), .gcs-drawer__body select, .gcs-drawer__body textarea') ?? el)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      // Un dialog deschis peste panou (confirmarea, popupul de încărcare, chiar randat în panou) își tratează singur
      // tastele: Escape îl închide doar pe el, iar Tab rămâne în el.
      if (document.querySelector(".gcs-modal")) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
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
    <DrawerContext.Provider value={{ close: () => close.current() }}>
      <div
        className="gcs-drawer"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close.current();
        }}
      >
        <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx("gcs-drawer__panel", `gcs-drawer__panel--${size}`, className)} data-testid={testId}>
          <div className="gcs-drawer__head">
            {icon && (
              <span className="gcs-drawer__icon" aria-hidden="true">
                {icon}
              </span>
            )}
            <h2 id={titleId} className="gcs-drawer__title">
              {title}
            </h2>
            {aside}
            <button type="button" className="gcs-drawer__close" aria-label={closeLabel} onClick={() => close.current()}>
              <GcsIconSvg icon={faXmark} />
            </button>
          </div>
          <div className="gcs-drawer__body">{children}</div>
          {footer && <div className="gcs-drawer__foot">{footer}</div>}
        </div>
      </div>
    </DrawerContext.Provider>
  );
}
